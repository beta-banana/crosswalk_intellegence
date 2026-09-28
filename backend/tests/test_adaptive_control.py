from math import isclose

import pytest

from app.adaptive_control import (
    AdaptivePriority, PHASE_ORDER, PhaseDriver, PhaseState, SimulatedController, TrackedObservation,
    diagnostic_flow_density,
)


def sample(t, people=("p",), cars=(), healthy=True):
    return TrackedObservation(t, frozenset(people), frozenset(cars), healthy)


@pytest.mark.parametrize("cars,people,threshold", [
    (0, 1, 0), (1, 1, 45), (1, 2, 0),
    (3, 1, 67.5), (3, 4, 0),
])
def test_density_weight_and_bounded_wait(cars, people, threshold):
    policy = AdaptivePriority(segment_length_km=0.1, k_ref=10, t_max_s=90,
                              density_window_s=20)
    car_ids = tuple(range(cars))
    people_ids = tuple(range(people))
    first = policy.update(sample(0, people_ids, car_ids))
    assert first.k == 10 * cars
    assert isclose(first.weight, 1 / (1 + cars))
    if threshold:
        assert not first.request_pending
        for t in range(1, int(threshold)):
            assert not policy.update(sample(t, people_ids, car_ids)).request_pending
        # Fractional monotonic timestamps allow the exact 67.5 s boundary.
        assert policy.update(sample(threshold, people_ids, car_ids)).request_pending
    else:
        assert first.request_pending


def test_short_id_loss_duplicate_banks_departure_and_new_cohort():
    policy = AdaptivePriority(segment_length_km=0.1, k_ref=10)
    policy.update(sample(0, ("a",), (1,)))
    missing = policy.update(sample(1, (), (1,)))
    assert missing.n_waiting == 1 and missing.wait_s == 1
    returned = policy.update(TrackedObservation.from_zones(2, {"a"}, {"a"}, {1}))
    assert returned.n_waiting == 1 and returned.wait_s == 2
    policy.update(sample(3, ("a",), ()))
    assert policy.pedestrian_walk_started() == {"a"}
    assert policy.update(sample(4, ("a", "b"), ())).n_waiting == 1
    policy.update(sample(5, (), ()))
    policy.update(sample(6, (), ()))
    assert policy.update(sample(7, (), ())).n_waiting == 0


def test_latch_survives_density_change_but_confirmed_departure_cancels():
    policy = AdaptivePriority(segment_length_km=0.1, k_ref=10)
    assert policy.update(sample(0, ("a",), ())).request_pending
    assert policy.update(sample(1, ("a",), range(10))).request_pending
    assert policy.update(sample(2, (), range(10))).request_pending
    assert policy.update(sample(3, (), range(10))).request_pending
    assert not policy.update(sample(4, (), range(10))).request_pending


def test_frame_gap_and_camera_outage_block_new_decisions():
    policy = AdaptivePriority(segment_length_km=0.1, k_ref=10)
    policy.update(sample(0, (), (1,)))
    assert policy.update(sample(4, ("a",), ())).quality == "stale_stream"
    assert policy.update(sample(5, ("a",), (), False)).quality == "camera_unavailable"
    recovered = policy.update(sample(6, ("a",), (1,)))
    assert recovered.quality == "ok" and recovered.k == 10


def test_controller_enforces_phase_order_and_durations_even_in_dense_flow():
    durations = dict(vehicle_yellow=3, all_red_to_pedestrian=2,
                     pedestrian_walk=8, pedestrian_clearance=6,
                     all_red_to_vehicle=2)
    controller = SimulatedController(durations, min_vehicle_green=10)
    timeline = [controller.advance(t, request=True, fallback=False).phase for t in range(40)]
    runs = [(phase, timeline.index(phase)) for phase in PHASE_ORDER]
    assert runs == list(zip(PHASE_ORDER, (0, 10, 13, 15, 23, 29)))
    assert timeline[31] == "vehicle_green"
    assert controller.advance(61, request=False, fallback=True).phase == "vehicle_yellow"


def test_flow_density_is_diagnostic_only_and_rejects_bad_windows():
    assert isclose(diagnostic_flow_density(crossings=2, interval_s=20,
        segment_length_km=0.1, travel_time_hours=[0.01, 0.01], same_window=True), 36)
    for kwargs in ({"same_window": False}, {"stopped_queue": True},
                   {"travel_time_hours": [0]}, {"crossings": 0}):
        inputs = dict(crossings=2, interval_s=20, segment_length_km=0.1,
                      travel_time_hours=[0.01], same_window=True)
        assert diagnostic_flow_density(**(inputs | kwargs)) is None


def test_missing_or_stale_controller_phase_hands_off_to_preset_cycle():
    class Adapter:
        phase = None
        last_call = None

        def read_phase(self, timestamp_s):
            return self.phase

        def advance(self, timestamp_s, request, fallback):
            self.last_call = request, fallback
            return PhaseState("vehicle_green", 0, timestamp_s)

    adapter = Adapter()
    driver = PhaseDriver(adapter)
    driver.step(10, request=True, camera_ok=True)
    assert adapter.last_call == (False, True)
    adapter.phase = PhaseState("vehicle_green", 10, 5)
    driver.step(10, request=True, camera_ok=True)
    assert adapter.last_call == (False, True)
    adapter.phase = PhaseState("vehicle_green", 10, 10)
    driver.step(10, request=True, camera_ok=False)
    assert adapter.last_call == (False, True)
    driver.step(10, request=True, camera_ok=True)
    assert adapter.last_call == (True, False)
