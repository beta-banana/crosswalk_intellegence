"""Deterministic demonstration of a pedestrian crossing controller.

All observations come from the scenarios below. There is no video processing,
hardware connection, or claim that these timings fit a real intersection.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field


FLOW_WINDOW_SECONDS = 30
CLEAR_ROAD_SECONDS = 5
WARNING_SECONDS = 3
ALL_RED_SECONDS = 2
FALLBACK_VEHICLE_SECONDS = 30


class PhasePlan(BaseModel):
    vehicle_green: int = Field(30, ge=5, le=90)
    warning: int = Field(3, ge=3, le=10)
    all_red_to_ped: int = Field(2, ge=2, le=10)
    pedestrian_green: int = Field(12, ge=8, le=60)
    all_red_to_vehicle: int = Field(2, ge=2, le=10)


class Config(BaseModel):
    control_mode: Literal["adaptive", "manual"] = "adaptive"
    phase_plan: PhasePlan = Field(default_factory=PhasePlan)
    min_vehicle_green: int = Field(10, ge=5, le=40)
    low_flow_threshold: int = Field(24, ge=0, le=30)
    group_threshold: int = Field(5, ge=2, le=10)
    max_single_wait: int = Field(20, ge=20, le=90)
    max_group_wait: int = Field(15, ge=15, le=60)
    pedestrian_green: int = Field(8, ge=8, le=30)


@dataclass(frozen=True)
class Request:
    start: int
    end: int
    people: int


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
    Scenario("normal", "Обычное движение", "Умеренный поток и одиночный запрос", 90, "normal", (4, 13, 29, 47, 56, 72, 83), (Request(10, 50, 1), Request(61, 88, 2))),
    Scenario("rush", "Час пик", "Плотный поток, ожидание до безопасного окна", 110, "busy", tuple(range(2, 87, 3)), (Request(8, 60, 2),)),
    Scenario("group", "Большая группа пешеходов", "Группа из 7 человек получает приоритет", 90, "group", (3, 6, 9, 12, 15, 18, 23, 30, 39, 51, 65, 77), (Request(8, 62, 7),)),
    Scenario("empty", "Свободная дорога", "Свободная дорога и быстрый отклик", 70, "clear", (), (Request(3, 50, 1),)),
    Scenario("failure", "Отказ камеры", "Потеря изображения и резервный цикл", 90, "fault", (4, 11, 19, 50, 62, 76), (Request(9, 62, 1),), (30, 75)),
)

SCENARIOS = [
    {"id": s.id, "name": s.name, "description": s.description, "duration": s.duration,
     "tone": s.tone, "kind": "simulation"}
    for s in SCENARIO_DATA
]
SCENARIOS_BY_ID = {s.id: s for s in SCENARIO_DATA}
PHASE_ORDER = ("vehicle_green", "warning", "all_red_to_ped", "pedestrian_green", "all_red_to_vehicle")


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
    minimums = {"warning": WARNING_SECONDS, "all_red_to_ped": ALL_RED_SECONDS,
                "pedestrian_green": 8, "all_red_to_vehicle": ALL_RED_SECONDS}
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


def _phase_duration(phase: str, mode: str, config: Config) -> int:
    if mode == "manual":
        return getattr(config.phase_plan, phase)
    if phase == "vehicle_green":
        return FALLBACK_VEHICLE_SECONDS if mode in ("fixed", "fallback") else config.min_vehicle_green
    if phase == "pedestrian_green":
        return 12 if mode in ("fixed", "fallback") else config.pedestrian_green
    return WARNING_SECONDS if phase == "warning" else ALL_RED_SECONDS


def _run(scenario: Scenario, config: Config, fixed: bool = False) -> dict:
    phase = "vehicle_green"
    phase_since = 0
    pending: list[int] = []
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

        # A detected request remains latched until a pedestrian green phase.
        # Ending a mock observation window must never silently erase it.
        if healthy:
            for index, request in enumerate(scenario.requests):
                if request.start <= second < request.end and index not in pending and index not in served:
                    pending.append(index)
                    events.append({"time": second, "type": "request", "text":
                                   "Обнаружена группа пешеходов" if request.people >= config.group_threshold
                                   else "Обнаружен пешеходный запрос"})

        elapsed = second - phase_since
        next_phase = None
        next_reason = None
        reason = "Автомобилям открыт проезд"

        if phase == "vehicle_green":
            minimum = _phase_duration(phase, mode, config)
            if elapsed >= minimum:
                if mode == "fallback":
                    next_phase, next_reason = "warning", "Резервный цикл: автомобильная фаза завершена"
                elif mode == "fixed":
                    next_phase, next_reason = "warning", "Фиксированный цикл: автомобильная фаза завершена"
                elif mode == "manual":
                    next_phase, next_reason = "warning", "Ручной план: автомобильная фаза завершена"
                elif pending:
                    oldest_wait = second - min(scenario.requests[i].start for i in pending)
                    group = any(scenario.requests[i].people >= config.group_threshold for i in pending)
                    wait_limit = config.max_group_wait if group else config.max_single_wait
                    if clear_gap:
                        next_phase, next_reason = "warning", "Свободная дорога подтверждена за 5 секунд"
                    elif oldest_wait >= wait_limit - WARNING_SECONDS - ALL_RED_SECONDS:
                        next_phase, next_reason = "warning", "Приоритет группы: предел ожидания" if group else "Предел ожидания пешехода"
                    elif group and oldest_wait >= 8:
                        next_phase, next_reason = "warning", "Приоритет группы пешеходов"
                    elif not group and flow <= config.low_flow_threshold and oldest_wait >= 5:
                        next_phase, next_reason = "warning", "Низкая интенсивность потока за предыдущие 30 секунд"
            if not next_phase:
                if mode == "fallback":
                    reason = "Камера недоступна: работает резервный цикл"
                elif mode == "fixed":
                    reason = "Автомобилям открыт проезд по фиксированному циклу"
                elif mode == "manual":
                    reason = "Автомобилям открыт проезд по ручному плану"
                elif pending:
                    reason = "Ожидание минимальной автомобильной фазы" if elapsed < minimum else "Ожидание безопасного окна в потоке"
        elif phase == "warning":
            reason = "Предупреждение: завершение автомобильной фазы"
            if elapsed >= _phase_duration(phase, mode, config):
                next_phase, next_reason = "all_red_to_ped", "Защитный интервал: все сигналы запрещающие"
        elif phase == "all_red_to_ped":
            reason = "Защитный интервал перед переходом"
            if elapsed >= _phase_duration(phase, mode, config):
                next_phase, next_reason = "pedestrian_green", "Пешеходная фаза включена после защитного интервала"
        elif phase == "pedestrian_green":
            reason = "Пешеходам открыт переход"
            if elapsed >= _phase_duration(phase, mode, config):
                next_phase, next_reason = "all_red_to_vehicle", "Защитный интервал перед проездом"
        else:
            reason = "Защитный интервал перед проездом"
            if elapsed >= _phase_duration(phase, mode, config):
                next_phase, next_reason = "vehicle_green", "Автомобильная фаза восстановлена"

        if next_phase:
            phase, phase_since, reason = next_phase, second, next_reason
            switches += 1
            events.append({"time": second, "type": "phase", "text": reason, "phase": phase})
            if phase == "pedestrian_green" and first_pedestrian_green is None:
                first_pedestrian_green = second

        if phase == "pedestrian_green" and pending:
            for index in pending:
                waits.append(second - scenario.requests[index].start)
                served.add(index)
            pending.clear()

        if scenario.camera_outage:
            if second == scenario.camera_outage[0]:
                events.append({"time": second, "type": "fault", "text": "Камера недоступна. Включён резервный цикл"})
            elif second == scenario.camera_outage[1]:
                events.append({"time": second, "type": "recovery", "text": "Изображение восстановлено. Адаптивный режим доступен"})

        frames.append({
            "time": second, "phase": phase, "mode": mode, "healthy": healthy,
            "vehicles": observed["vehicles"] if healthy else None,
            "vehicle_positions": observed["vehicle_positions"] if healthy else [],
            "pedestrians": observed["pedestrians"] if healthy else None,
            "flow_per_min": flow if healthy else None,
            "clear_gap": clear_gap,
            "waiting_seconds": second - min(scenario.requests[i].start for i in pending) if pending else 0,
            "reason": reason,
        })

    observed_frames = [frame for frame in frames if frame["healthy"]]
    flows = [frame["flow_per_min"] for frame in observed_frames]
    vehicles_in_zone = [frame["vehicles"] for frame in observed_frames]
    summary = {
        "vehicles": len(scenario.arrivals),
        "pedestrians": sum(r.people for r in scenario.requests),
        "peak_pedestrians": max(r.people for r in scenario.requests),
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
