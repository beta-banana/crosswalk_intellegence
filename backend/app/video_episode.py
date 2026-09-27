"""Dashboard report calculated from the per-second CV demonstration file."""

from __future__ import annotations

import json
from pathlib import Path

from .simulation import (
    ALL_RED_SECONDS,
    CLEAR_ROAD_SECONDS,
    FALLBACK_VEHICLE_SECONDS,
    FLOW_WINDOW_SECONDS,
    WARNING_SECONDS,
    Config,
    PHASE_ORDER,
    _safety_violations,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]
JSON_PATH = PROJECT_ROOT / "result_crosswalk.json"
VIDEO_PATH = PROJECT_ROOT / "result_crosswalk_web.mp4"
VIDEO_ID = "video"


def load_observations() -> list[dict]:
    rows = json.loads(JSON_PATH.read_text(encoding="utf-8"))["seconds"]
    if not isinstance(rows, list) or not rows:
        raise ValueError("Файл наблюдений компьютерного зрения не содержит данных")
    expected = {"camera_ok", "vehicles", "new_vehicles", "waiting", "new_pedestrians", "on_road"}
    for second, row in enumerate(rows):
        if not isinstance(row, dict) or set(row) != expected or type(row["camera_ok"]) is not bool:
            raise ValueError(f"Некорректные данные компьютерного зрения на секунде {second}")
        values = (row[key] for key in expected - {"camera_ok"})
        if row["camera_ok"] and any(type(value) is not int or value < 0 for value in values):
            raise ValueError(f"Некорректные счётчики компьютерного зрения на секунде {second}")
        if not row["camera_ok"] and any(value is not None for value in values):
            raise ValueError(f"Недоступные счётчики должны быть пустыми на секунде {second}")
    return rows


def video_scenario() -> dict:
    return {
        "id": VIDEO_ID,
        "name": "Видео перехода",
        "description": "Запись модуля компьютерного зрения и посекундные данные наблюдений",
        "duration": len(load_observations()),
        "tone": "video",
    }


def _run(rows: list[dict], config: Config, fixed: bool) -> dict:
    phase = "vehicle_green"
    phase_since = 0
    pending: list[int] = []
    waits: list[int] = []
    switches = 0
    first_pedestrian_green = None
    frames: list[dict] = []
    events: list[dict] = []

    for second, observed in enumerate(rows):
        healthy = observed["camera_ok"]
        mode = "fallback" if not healthy else "fixed" if fixed else config.control_mode
        waiting = observed["waiting"] if healthy else None
        on_road = observed["on_road"] if healthy else None
        flow_first = max(0, second - FLOW_WINDOW_SECONDS + 1)
        flow = (2 * sum(row["new_vehicles"] or 0 for row in rows[flow_first:second + 1])) if healthy else None
        clear_first = second - CLEAR_ROAD_SECONDS + 1
        clear_gap = healthy and clear_first >= 0 and all(
            row["camera_ok"] and row["vehicles"] == 0
            for row in rows[clear_first:second + 1]
        )

        previous_waiting = rows[second - 1]["waiting"] if second else 0
        if healthy and waiting and not previous_waiting:
            pending.append(second)
            events.append({"time": second, "type": "request", "text": "Обнаружен пешеходный запрос"})

        elapsed = second - phase_since
        next_phase = None
        reason = "Автомобилям открыт проезд"
        if phase == "vehicle_green":
            minimum = (FALLBACK_VEHICLE_SECONDS if mode in ("fixed", "fallback")
                       else config.phase_plan.vehicle_green if mode == "manual"
                       else config.min_vehicle_green)
            if elapsed >= minimum:
                if mode in ("fixed", "manual", "fallback"):
                    next_phase = "warning"
                    reason = "Автомобильная фаза завершена по плану"
                elif pending:
                    oldest_wait = second - pending[0]
                    group = waiting is not None and waiting >= config.group_threshold
                    limit = config.max_group_wait if group else config.max_single_wait
                    if clear_gap:
                        next_phase, reason = "warning", "Свободная дорога подтверждена за 5 секунд"
                    elif oldest_wait >= limit - WARNING_SECONDS - ALL_RED_SECONDS:
                        next_phase, reason = "warning", "Предел ожидания пешеходов"
                    elif flow is not None and flow <= config.low_flow_threshold and oldest_wait >= 5:
                        next_phase, reason = "warning", "Низкая интенсивность транспорта"
                    elif group and oldest_wait >= 8:
                        next_phase, reason = "warning", "Приоритет группы пешеходов"
            if not next_phase and pending:
                reason = "Ожидание безопасного окна для пешеходов"
        elif phase == "warning":
            reason = "Предупреждение перед остановкой транспорта"
            if elapsed >= (config.phase_plan.warning if mode == "manual" else WARNING_SECONDS):
                next_phase, reason = "all_red_to_ped", "Защитный интервал: все сигналы красные"
        elif phase == "all_red_to_ped":
            reason = "Защитный интервал перед переходом"
            if elapsed >= (config.phase_plan.all_red_to_ped if mode == "manual" else ALL_RED_SECONDS):
                next_phase, reason = "pedestrian_green", "Пешеходам открыт переход"
        elif phase == "pedestrian_green":
            reason = "Пешеходы переходят дорогу" if on_road else "Пешеходам открыт переход"
            minimum = (12 if mode in ("fixed", "fallback") else config.phase_plan.pedestrian_green
                       if mode == "manual" else config.pedestrian_green)
            if elapsed >= minimum and (on_road == 0 or on_road is None):
                next_phase, reason = "all_red_to_vehicle", "Проезжая часть освобождена"
        else:
            reason = "Защитный интервал перед проездом"
            if elapsed >= (config.phase_plan.all_red_to_vehicle if mode == "manual" else ALL_RED_SECONDS):
                next_phase, reason = "vehicle_green", "Автомобилям открыт проезд"

        if next_phase:
            assert next_phase == PHASE_ORDER[(PHASE_ORDER.index(phase) + 1) % len(PHASE_ORDER)]
            phase, phase_since = next_phase, second
            switches += 1
            events.append({"time": second, "type": "phase", "text": reason, "phase": phase})
            if phase == "pedestrian_green" and first_pedestrian_green is None:
                first_pedestrian_green = second

        if phase == "pedestrian_green" and pending:
            waits.extend(second - started for started in pending)
            pending.clear()

        frames.append({
            "time": second,
            "phase": phase,
            "mode": mode,
            "healthy": healthy,
            "vehicles": observed["vehicles"],
            "vehicle_positions": [],
            "pedestrians": waiting,
            "on_road": on_road,
            "flow_per_min": flow,
            "clear_gap": clear_gap,
            "waiting_seconds": second - pending[0] if pending else 0,
            "reason": reason,
        })

    healthy_frames = [frame for frame in frames if frame["healthy"]]
    flows = [frame["flow_per_min"] for frame in healthy_frames]
    vehicles = [frame["vehicles"] for frame in healthy_frames]
    summary = {
        "vehicles": sum(row["new_vehicles"] or 0 for row in rows),
        "pedestrians": sum(row["new_pedestrians"] or 0 for row in rows),
        "peak_pedestrians": max((row["waiting"] or 0 for row in rows), default=0),
        "mean_flow_per_min": round(sum(flows) / len(flows), 1) if flows else None,
        "peak_flow_per_min": max(flows) if flows else None,
        "mean_vehicles_in_zone": round(sum(vehicles) / len(vehicles), 1) if vehicles else None,
        "peak_vehicles_in_zone": max(vehicles) if vehicles else None,
        "mean_wait": round(sum(waits) / len(waits), 1) if waits else None,
        "max_wait": max(waits) if waits else None,
        "first_pedestrian_green": first_pedestrian_green,
        "phase_switches": switches,
        "served_requests": len(waits),
        "unserved_requests": len(pending),
        "camera_uptime": round(100 * len(healthy_frames) / len(frames), 1),
        "safety_violations": _safety_violations(frames),
    }
    return {"frames": frames, "events": events, "summary": summary}


def simulate_video(config: Config) -> dict:
    rows = load_observations()
    adaptive = _run(rows, config, fixed=False)
    baseline = _run(rows, config, fixed=True)
    adaptive_wait = adaptive["summary"]["mean_wait"]
    baseline_wait = baseline["summary"]["mean_wait"]
    both_served = not adaptive["summary"]["unserved_requests"] and not baseline["summary"]["unserved_requests"]
    difference = round(baseline_wait - adaptive_wait, 1) if both_served and adaptive_wait is not None and baseline_wait is not None else None
    return {
        "scenario_id": VIDEO_ID,
        "scenario": video_scenario(),
        "config": config.model_dump(),
        **adaptive,
        "baseline": baseline["summary"],
        "modeled_wait_difference": difference,
        "recommendation": "Показания CV из JSON обновляются синхронно с видео; фазы рассчитывает виртуальный контроллер.",
        "disclaimer": "Демонстрационные наблюдения оценены по видео. Фазы и сравнение циклов смоделированы.",
    }
