"""Deterministic demonstration of a pedestrian crossing controller.

All observations come from the scenarios below. There is no video processing,
hardware connection, or claim that these timings fit a real intersection.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .adaptive_control import AdaptivePriority, PHASE_ORDER, PhaseDriver, SimulatedController, TrackedObservation


FLOW_WINDOW_SECONDS = 30
CLEAR_ROAD_SECONDS = 5
WARNING_SECONDS = 3
ALL_RED_SECONDS = 2
FALLBACK_VEHICLE_SECONDS = 30
DEMO_APPROACH_SPEED_KMH = 50  # nominal travel speed for synthetic segment occupancy


class PhasePlan(BaseModel):
    vehicle_green: int = Field(30, ge=5, le=90)
    warning: int = Field(3, ge=3, le=10)
    all_red_to_ped: int = Field(2, ge=2, le=10)
    pedestrian_green: int = Field(12, ge=8, le=60)
    pedestrian_clearance: int = Field(6, ge=3, le=60)
    all_red_to_vehicle: int = Field(2, ge=2, le=10)


class Config(BaseModel):
    model_config = ConfigDict(extra="forbid")
    control_mode: Literal["adaptive", "manual"] = "adaptive"
    phase_plan: PhasePlan = Field(default_factory=PhasePlan)
    min_vehicle_green: int = Field(10, ge=5, le=40)
    pedestrian_green: int = Field(8, ge=8, le=30)
    pedestrian_clearance: int = Field(6, ge=3, le=60)
    segment_length_km: float = Field(0.1, gt=0, le=2)
    k_ref: float = Field(20, gt=0, le=500)
    t_max_s: float = Field(90, gt=0, le=600)
    density_window_s: float = Field(20, gt=0, le=120)




class TrafficProfile(BaseModel):
    vehicle_rate: int = Field(45, ge=0, le=120, description="Vehicles per minute before day adjustment")
    pedestrian_rate: int = Field(30, ge=0, le=60, description="Pedestrians per minute before day adjustment")
    time_of_day: Literal["morning", "day", "evening", "night"] = "day"
    day_type: Literal["weekday", "weekend", "holiday"] = "weekday"


DEMAND_MULTIPLIERS = {
    "weekday": {"morning": (1.35, 1.15), "day": (1.0, 1.0),
                "evening": (1.25, 1.2), "night": (0.65, 0.75)},
    "weekend": {"morning": (0.65, 0.7), "day": (0.85, 1.2),
                "evening": (1.05, 1.3), "night": (0.7, 0.8)},
    "holiday": {"morning": (0.55, 0.8), "day": (0.75, 1.35),
                "evening": (0.85, 1.4), "night": (0.65, 0.9)},
}


def _scheduled_arrivals(rate: float, duration: int) -> tuple[int, ...]:
    """Distribute demand reproducibly across one-second simulation steps."""
    arrivals: list[int] = []
    balance = 0.0
    for second in range(1, duration + 1):
        balance += rate / 60
        while balance >= 1 - 1e-9:
            arrivals.append(second)
            balance -= 1
    return tuple(arrivals)


def _profiled_arrivals(*periods: tuple[int, float]) -> tuple[int, ...]:
    """Join deterministic periods with different arrival rates."""
    elapsed = 0
    arrivals: list[int] = []
    for duration, rate in periods:
        arrivals.extend(elapsed + second for second in _scheduled_arrivals(rate, duration))
        elapsed += duration
    return tuple(arrivals)


@dataclass(frozen=True)
class Request:
    start: int
    end: int
    people: int
    side: Literal["south", "north"] = "south"


@dataclass(frozen=True)
class Scenario:
    id: str
    name: str
    description: str
    duration: int
    tone: str
    arrivals: tuple[int, ...]
    requests: tuple[Request, ...]
    camera_outage: tuple[int, int] | None = None


SCENARIO_DATA = (
    Scenario("normal", "Обычное движение", "Умеренный поток, две группы у перехода", 90, "normal", _scheduled_arrivals(32, 90), (Request(10, 75, 2, "south"), Request(60, 91, 3, "north"))),
    Scenario("rush", "Час пик", "Плотный поток с усилением в середине эпизода", 110, "busy", _profiled_arrivals((25, 90), (60, 115), (25, 90)), (Request(8, 109, 2, "south"), Request(45, 109, 3, "north"))),
    Scenario("group", "Большая группа пешеходов", "Девять человек вместе ожидают на одном тротуаре", 90, "group", _scheduled_arrivals(45, 90), (Request(8, 70, 9, "south"),)),
    Scenario("empty", "Свободная дорога", "Свободная дорога и быстрый отклик", 70, "clear", (), (Request(3, 50, 1, "south"),)),
    Scenario("failure", "Отказ камеры", "Умеренный поток, потеря изображения и резервный цикл", 90, "fault", _scheduled_arrivals(30, 90), (Request(9, 80, 2, "north"),), (30, 75)),
)

SCENARIOS = [
    {"id": s.id, "name": s.name, "description": s.description, "duration": s.duration,
     "tone": s.tone, "kind": "simulation"}
    for s in SCENARIO_DATA
]
SCENARIOS_BY_ID = {s.id: s for s in SCENARIO_DATA}

def _durations(config: Config, mode: str) -> dict[str, int]:
    plan = config.phase_plan
    return {
        "vehicle_yellow": plan.warning if mode == "manual" else WARNING_SECONDS,
        "all_red_to_pedestrian": plan.all_red_to_ped if mode == "manual" else ALL_RED_SECONDS,
        "pedestrian_walk": plan.pedestrian_green if mode == "manual" else config.pedestrian_green,
        "pedestrian_clearance": plan.pedestrian_clearance if mode == "manual" else config.pedestrian_clearance,
        "all_red_to_vehicle": plan.all_red_to_vehicle if mode == "manual" else ALL_RED_SECONDS,
    }


def _observation(scenario: Scenario, second: int) -> dict:
    cars = [arrival for arrival in scenario.arrivals if arrival <= second < arrival + 5]
    outage = scenario.camera_outage
    camera_healthy = outage is None or not (outage[0] <= second < outage[1])
    return {
        "healthy": camera_healthy,
        "vehicles": len(cars),
        "vehicle_positions": [round((second - arrival + 1) / 6, 3) for arrival in cars],
        "pedestrians": sum(r.people for r in scenario.requests if r.start <= second < r.end),
    }


def _traffic_flow(scenario: Scenario, second: int) -> int:
    """Count arrivals in the preceding 30 one-second slots, scaled to a minute."""
    first = max(0, second - FLOW_WINDOW_SECONDS + 1)
    return 2 * sum(first <= arrival <= second for arrival in scenario.arrivals)


def _clear_road(scenario: Scenario, second: int) -> bool:
    if second < CLEAR_ROAD_SECONDS - 1:
        return False
    return all(
        _observation(scenario, previous)["vehicles"] == 0
        for previous in range(second - CLEAR_ROAD_SECONDS + 1, second + 1)
    )


def _safety_violations(frames: list[dict]) -> int:
    """Check completed phase runs for order and protective durations."""
    runs: list[tuple[str, int]] = []
    for frame in frames:
        phase = frame["phase"]
        if runs and runs[-1][0] == phase:
            runs[-1] = (phase, runs[-1][1] + 1)
        else:
            runs.append((phase, 1))
    violations = 0
    minimums = {"vehicle_yellow": WARNING_SECONDS, "all_red_to_pedestrian": ALL_RED_SECONDS,
                "pedestrian_walk": 8, "pedestrian_clearance": 3,
                "all_red_to_vehicle": ALL_RED_SECONDS}
    for index, (phase, length) in enumerate(runs[:-1]):
        next_phase = runs[index + 1][0]
        if next_phase != PHASE_ORDER[(PHASE_ORDER.index(phase) + 1) % len(PHASE_ORDER)]:
            violations += 1
        if length < minimums.get(phase, 0):
            violations += 1
    return violations


def _phase_metrics(frames: list[dict]) -> dict:
    """Return transparent timing metrics without pretending to model vehicle delay."""
    total_seconds = len(frames)
    vehicle_green_seconds = sum(frame["phase"] == "vehicle_green" for frame in frames)
    return {
        "vehicle_green_seconds": vehicle_green_seconds,
        "vehicle_closed_seconds": total_seconds - vehicle_green_seconds,
        "vehicle_green_share": round(100 * vehicle_green_seconds / total_seconds, 1)
        if total_seconds else None,
    }


def _run(scenario: Scenario, config: Config, fixed: bool = False) -> dict:
    mode_config = "manual" if config.control_mode == "manual" and not fixed else "adaptive"
    durations = _durations(config, mode_config)
    if fixed:
        durations["pedestrian_walk"] = 12
    controller = SimulatedController(durations,
        config.phase_plan.vehicle_green if mode_config == "manual" else config.min_vehicle_green,
        config.phase_plan.vehicle_green if mode_config == "manual" else FALLBACK_VEHICLE_SECONDS)
    driver = PhaseDriver(controller)
    priority = AdaptivePriority(segment_length_km=config.segment_length_km,
        k_ref=config.k_ref, t_max_s=config.t_max_s,
        density_window_s=config.density_window_s)
    served: set[int] = set()
    waits: list[int] = []
    frames: list[dict] = []
    events: list[dict] = []
    first_pedestrian_green = None
    switches = 0

    for second in range(scenario.duration + 1):
        observed = _observation(scenario, second)
        healthy = observed["healthy"]
        mode = "fallback" if not healthy else "fixed" if fixed else config.control_mode
        flow = _traffic_flow(scenario, second)
        clear_gap = healthy and _clear_road(scenario, second)
        waiting_ids = frozenset((index, person) for index, request in enumerate(scenario.requests)
                                if request.start <= second < request.end
                                for person in range(request.people)) if healthy else frozenset()
        segment_travel_s = 3600 * config.segment_length_km / DEMO_APPROACH_SPEED_KMH
        cars = frozenset(index for index, arrival in enumerate(scenario.arrivals)
                         if arrival <= second < arrival + segment_travel_s) if healthy else frozenset()
        decision = priority.update(TrackedObservation(second, waiting_ids, cars, healthy))
        before = controller.read_phase(second)
        phase_state, _ = driver.step(second,
            request=(decision.request_pending if mode == "adaptive" else mode == "manual"),
            camera_ok=mode not in ("fixed", "fallback"))
        phase = phase_state.phase
        if phase != before.phase:
            switches += 1
            events.append({"time": second, "type": "phase", "text": f"Фаза: {phase}", "phase": phase})
            if phase == "pedestrian_walk" and first_pedestrian_green is None:
                first_pedestrian_green = second
            if phase == "pedestrian_walk":
                for index, _ in priority.pedestrian_walk_started():
                    if index not in served:
                        waits.append(second - scenario.requests[index].start)
                        served.add(index)
        if mode == "adaptive" and decision.request_pending:
            if second == 0 or not frames[-1]["request_pending"]:
                events.append({"time": second, "type": "request", "text": "Адаптивный запрос пешеходной фазы"})
        reason = ("Резервный цикл: недоступны данные камеры" if mode == "fallback"
                  else "Фиксированный цикл" if mode == "fixed"
                  else "Ручной план" if mode == "manual"
                  else "Запрос пешеходной фазы сохранён" if decision.request_pending
                  else "Расчёт приоритета по плотности и ожиданию")

        if scenario.camera_outage:
            if second == scenario.camera_outage[0]:
                events.append({"time": second, "type": "fault", "text": "Камера недоступна. Включён резервный цикл"})
            elif second == scenario.camera_outage[1]:
                events.append({"time": second, "type": "recovery", "text": "Изображение восстановлено. Адаптивный режим доступен"})

        frames.append({
            "time": second, "phase": phase, "mode": mode, "healthy": healthy,
            "new_vehicles": sum(arrival == second for arrival in scenario.arrivals),
            "new_pedestrians": sum(request.people for request in scenario.requests if request.start == second),
            "pedestrian_groups": [{"count": request.people, "side": request.side}
                                  for request in scenario.requests if request.start == second],
            "vehicles": observed["vehicles"] if healthy else None,
            "vehicle_positions": observed["vehicle_positions"] if healthy else [],
            "pedestrians": observed["pedestrians"] if healthy else None,
            "flow_per_min": flow if healthy else None,
            "clear_gap": clear_gap,
            "waiting_seconds": round(decision.wait_s or 0, 2),
            "timestamp_s": second, "phase_elapsed_s": phase_state.elapsed_s,
            "n_waiting": decision.n_waiting, "wait_s": decision.wait_s,
            "vehicles_in_segment": decision.vehicles_in_segment,
            "k": round(decision.k, 3) if decision.k is not None else None,
            "k_ref": decision.k_ref,
            "weight": round(decision.weight, 4) if decision.weight is not None else None,
            "priority": round(decision.priority, 4) if decision.priority is not None else None,
            "request_pending": priority.request_pending if mode == "adaptive" else False,
            "data_quality": decision.quality if driver.last_quality == "ok" else driver.last_quality,
            "reason": reason,
        })

    observed_frames = [frame for frame in frames if frame["healthy"]]
    flows = [frame["flow_per_min"] for frame in observed_frames]
    vehicles_in_zone = [frame["vehicles"] for frame in observed_frames]
    summary = {
        "vehicles": len(scenario.arrivals),
        "pedestrians": sum(r.people for r in scenario.requests),
        "peak_pedestrians": max((r.people for r in scenario.requests), default=0),
        "mean_flow_per_min": round(sum(flows) / len(flows), 1) if flows else None,
        "peak_flow_per_min": max(flows) if flows else None,
        "mean_vehicles_in_zone": round(sum(vehicles_in_zone) / len(vehicles_in_zone), 1) if vehicles_in_zone else None,
        "peak_vehicles_in_zone": max(vehicles_in_zone) if vehicles_in_zone else None,
        "mean_wait": round(sum(waits) / len(waits), 1) if waits else None,
        "max_wait": max(waits) if waits else None,
        "first_pedestrian_green": first_pedestrian_green,
        "phase_switches": switches,
        "served_requests": len(served),
        "unserved_requests": len(scenario.requests) - len(served),
        "camera_uptime": round(100 * sum(frame["healthy"] for frame in frames) / len(frames), 1),
        "safety_violations": _safety_violations(frames),
        **_phase_metrics(frames),
    }
    return {"frames": frames, "events": events, "summary": summary}


def simulate(scenario_id: str, config: Config) -> dict:
    scenario = SCENARIOS_BY_ID.get(scenario_id)
    if scenario is None:
        raise ValueError("Unknown scenario")
    adaptive = _run(scenario, config)
    baseline = _run(scenario, config, fixed=True)
    adaptive_wait = adaptive["summary"]["mean_wait"]
    baseline_wait = baseline["summary"]["mean_wait"]
    both_served = not adaptive["summary"]["unserved_requests"] and not baseline["summary"]["unserved_requests"]
    difference = round(baseline_wait - adaptive_wait, 1) if both_served and adaptive_wait is not None and baseline_wait is not None else None

    recommendations = {
        "normal": "Тридцатисекундное окно потока помогает объяснить момент переключения.",
        "rush": "При плотном потоке запрос сохраняется до пешеходной фазы, даже после окончания окна наблюдения.",
        "group": "Группа получает приоритет без сокращения защитных интервалов.",
        "empty": "На пустой дороге переход открывается после минимальной автомобильной фазы и пяти секунд без машин.",
        "failure": "При потере изображения контроллер использует резервный цикл до восстановления камеры.",
    }
    return {
        "scenario_id": scenario.id,
        "scenario": next(item for item in SCENARIOS if item["id"] == scenario.id),
        "config": config.model_dump(),
        **adaptive,
        "baseline": baseline["summary"],
        "modeled_wait_difference": difference,
        "recommendation": recommendations[scenario.id],
        "disclaimer": "Демонстрационная симуляция. Сравнение циклов относится только к выбранному эпизоду.",
    }


def simulate_custom(profile: TrafficProfile, config: Config) -> dict:
    duration = 120
    vehicle_factor, pedestrian_factor = DEMAND_MULTIPLIERS[profile.day_type][profile.time_of_day]
    vehicle_rate = round(profile.vehicle_rate * vehicle_factor, 2)
    pedestrian_rate = round(profile.pedestrian_rate * pedestrian_factor, 2)
    arrivals = _scheduled_arrivals(vehicle_rate, duration)
    pedestrians = _scheduled_arrivals(pedestrian_rate, duration)
    scenario = Scenario(
        "custom", "Пользовательский поток", "Потоки заданы в интерфейсе", duration, "custom",
        arrivals, tuple(Request(second, min(duration + 1, second + 30), 1,
                                "south" if index % 2 == 0 else "north")
                        for index, second in enumerate(pedestrians)),
    )
    result = _run(scenario, config)
    baseline = _run(scenario, config, fixed=True)
    return {
        "scenario_id": "custom",
        "scenario": {"id": "custom", "name": scenario.name, "description": scenario.description,
                     "duration": duration, "tone": "custom", "kind": "simulation"},
        "config": config.model_dump(),
        "profile": {**profile.model_dump(), "effective_vehicle_rate": vehicle_rate,
                    "effective_pedestrian_rate": pedestrian_rate},
        **result,
        "baseline": baseline["summary"],
        "modeled_wait_difference": None,
        "recommendation": "Потоки рассчитаны по выбранной интенсивности, времени суток и типу дня.",
        "disclaimer": "Схематичная демонстрация на синтетических потоках, не прогноз реального объекта.",
    }
