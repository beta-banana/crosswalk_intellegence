"""Adaptive request policy and a hardware-independent crossing controller.

Observations are already tracked and assigned to calibrated zones upstream.  A
completed, aggregate CV report cannot be passed to this policy as live input.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from math import isfinite
from typing import Hashable, Protocol


PHASE_ORDER = (
    "vehicle_green", "vehicle_yellow", "all_red_to_pedestrian",
    "pedestrian_walk", "pedestrian_clearance", "all_red_to_vehicle",
)


@dataclass(frozen=True)
class PhaseState:
    phase: str
    elapsed_s: float
    timestamp_s: float


class ControllerAdapter(Protocol):
    """Boundary to a signal controller; hardware command protocol is site specific."""

    def read_phase(self, timestamp_s: float) -> PhaseState | None: ...

    def advance(self, timestamp_s: float, request: bool, fallback: bool) -> PhaseState: ...


class PhaseDriver:
    """Only a fresh controller state may authorize an adaptive phase request."""

    def __init__(self, adapter: ControllerAdapter, max_phase_age_s: float = 2):
        self.adapter = adapter
        self.max_phase_age_s = max_phase_age_s
        self.last_quality = "ok"

    def step(self, timestamp_s: float, request: bool, camera_ok: bool) -> tuple[PhaseState, bool]:
        phase = self.adapter.read_phase(timestamp_s)
        phase_valid = (phase is not None and phase.phase in PHASE_ORDER
                       and isfinite(phase.elapsed_s) and phase.elapsed_s >= 0
                       and isfinite(phase.timestamp_s)
                       and 0 <= timestamp_s - phase.timestamp_s <= self.max_phase_age_s)
        self.last_quality = "camera_unavailable" if not camera_ok else "ok" if phase_valid else "stale_phase"
        fallback = not camera_ok or not phase_valid
        return self.adapter.advance(timestamp_s, request and not fallback, fallback), fallback


class SimulatedController:
    """Deterministic phase adapter for replay, testing, and the 3D demo."""

    def __init__(self, durations: dict[str, float], min_vehicle_green: float,
                 fallback_vehicle_green: float = 30):
        self.durations = durations
        self.min_vehicle_green = min_vehicle_green
        self.fallback_vehicle_green = fallback_vehicle_green
        self.phase = "vehicle_green"
        self.since = 0.0

    def read_phase(self, timestamp_s: float) -> PhaseState:
        return PhaseState(self.phase, timestamp_s - self.since, timestamp_s)

    def advance(self, timestamp_s: float, request: bool, fallback: bool) -> PhaseState:
        state = self.read_phase(timestamp_s)
        if self.phase == "vehicle_green":
            transition = (state.elapsed_s >= self.fallback_vehicle_green if fallback
                          else request and state.elapsed_s >= self.min_vehicle_green)
        else:
            transition = state.elapsed_s >= self.durations[self.phase]
        if transition:
            self.phase = PHASE_ORDER[(PHASE_ORDER.index(self.phase) + 1) % len(PHASE_ORDER)]
            self.since = timestamp_s
        return self.read_phase(timestamp_s)


@dataclass(frozen=True)
class TrackedObservation:
    timestamp_s: float
    waiting_ids: frozenset[Hashable]
    vehicle_segment_ids: frozenset[Hashable]
    camera_ok: bool = True

    @classmethod
    def from_zones(cls, timestamp_s: float, left_waiting_ids: set[Hashable],
                   right_waiting_ids: set[Hashable], vehicle_segment_ids: set[Hashable],
                   camera_ok: bool = True) -> "TrackedObservation":
        return cls(timestamp_s, frozenset(left_waiting_ids | right_waiting_ids),
                   frozenset(vehicle_segment_ids), camera_ok)


@dataclass(frozen=True)
class PriorityDecision:
    timestamp_s: float
    n_waiting: int | None
    wait_s: float | None
    vehicles_in_segment: int | None
    k: float | None
    k_ref: float
    weight: float | None
    priority: float | None
    request_pending: bool
    quality: str


class AdaptivePriority:
    def __init__(self, *, segment_length_km: float, k_ref: float, t_max_s: float = 90,
                 density_window_s: float = 20, id_grace_s: float = 2,
                 max_gap_s: float = 2):
        if min(segment_length_km, k_ref, t_max_s, density_window_s) <= 0:
            raise ValueError("Geometry, reference density and time limits must be positive")
        self.segment_length_km = segment_length_km
        self.k_ref = k_ref
        self.t_max_s = t_max_s
        self.density_window_s = density_window_s
        self.id_grace_s = id_grace_s
        self.max_gap_s = max_gap_s
        self.people: dict[Hashable, tuple[float, float]] = {}
        self.served: set[Hashable] = set()
        self.density_samples: deque[tuple[float, int]] = deque()
        self.last_timestamp: float | None = None
        self.request_pending = False

    def pedestrian_walk_started(self) -> set[Hashable]:
        """Serve the waiting cohort once; later arrivals can form a new request."""
        cohort = set(self.people) - self.served
        self.served.update(cohort)
        self.request_pending = False
        return cohort

    def update(self, observation: TrackedObservation) -> PriorityDecision:
        now = observation.timestamp_s
        if not isfinite(now) or (self.last_timestamp is not None and now <= self.last_timestamp):
            raise ValueError("Observation timestamps must increase monotonically")
        gap = self.last_timestamp is not None and now - self.last_timestamp > self.max_gap_s
        self.last_timestamp = now
        if not observation.camera_ok or gap:
            self.density_samples.clear()
            return PriorityDecision(now, None, None, None, None, self.k_ref, None, None,
                                    self.request_pending, "camera_unavailable" if not observation.camera_ok else "stale_stream")

        # The upstream tracker confirms entry. One track ID seen on both banks
        # still denotes one person. Short gaps retain its original entry time.
        for person_id in observation.waiting_ids:
            entered, _ = self.people.get(person_id, (now, now))
            self.people[person_id] = (entered, now)
        for person_id, (_, last_seen) in list(self.people.items()):
            if now - last_seen > self.id_grace_s:
                del self.people[person_id]
                self.served.discard(person_id)

        count = len(observation.vehicle_segment_ids)
        self.density_samples.append((now, count))
        while self.density_samples and now - self.density_samples[0][0] >= self.density_window_s:
            self.density_samples.popleft()
        k = (sum(value for _, value in self.density_samples) /
             len(self.density_samples) / self.segment_length_km)
        outstanding = [entered for person_id, (entered, _) in self.people.items()
                       if person_id not in self.served]
        n_waiting = len(outstanding)
        wait_s = max(0.0, now - min(outstanding)) if outstanding else 0.0
        weight = 1 / (1 + k / self.k_ref)
        priority = n_waiting * weight + wait_s / self.t_max_s if n_waiting else 0.0
        if n_waiting and priority >= 1 - 1e-12:
            self.request_pending = True
        elif not outstanding:
            # All unserved tracks have been absent beyond the grace interval.
            self.request_pending = False
        return PriorityDecision(now, n_waiting, wait_s, count, k, self.k_ref,
                                weight, priority, self.request_pending, "ok")


def diagnostic_flow_density(*, crossings: int, interval_s: float,
                            segment_length_km: float, travel_time_hours: list[float],
                            same_window: bool, stopped_queue: bool = False) -> float | None:
    """Optional q/v_space cross-check, never an input to adaptive decisions."""
    if (not same_window or stopped_queue or crossings <= 0 or interval_s <= 0
            or segment_length_km <= 0 or not travel_time_hours
            or any(not isfinite(t) or t <= 0 for t in travel_time_hours)):
        return None
    v_space = len(travel_time_hours) * segment_length_km / sum(travel_time_hours)
    return (3600 * crossings / interval_s) / v_space if isfinite(v_space) and v_space > 0 else None
