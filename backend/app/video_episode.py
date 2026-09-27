"""Dashboard report calculated from the per-second CV demonstration file."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .simulation import (
    ALL_RED_SECONDS,
    CLEAR_ROAD_SECONDS,
    FALLBACK_VEHICLE_SECONDS,
    FLOW_WINDOW_SECONDS,
    WARNING_SECONDS,
    Config,
    PHASE_ORDER,
    _phase_metrics,
    _safety_violations,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]
VIDEO_ID = "video"
OBSERVED_CROSSING_MIN_SECONDS = 5


@dataclass(frozen=True)
class VideoEpisode:
    id: str
    name: str
    description: str
    json_filename: str
    video_filename: str
    period: str
    tone: str = "video"

    @property
    def json_path(self) -> Path:
        return PROJECT_ROOT / self.json_filename

    @property
    def video_path(self) -> Path:
        return PROJECT_ROOT / self.video_filename


# To add another preprocessed recording, place its MP4 and JSON in the project
# root and add one entry here. No upload endpoint is required for the demo.
VIDEO_EPISODES = (
    VideoEpisode(
        id=VIDEO_ID,
        name="Переход · запись CV",
        description="Новая обработанная запись и синхронные посекундные наблюдения",
        json_filename="video_and_json/result_crosswalk.json",
        video_filename="video_and_json/result_crosswalk_web.mp4",
        period="Текущий ролик",
    ),
)
VIDEO_EPISODES_BY_ID = {episode.id: episode for episode in VIDEO_EPISODES}
# Backward-compatible paths for scripts that still import the original names.
JSON_PATH = VIDEO_EPISODES_BY_ID[VIDEO_ID].json_path
VIDEO_PATH = VIDEO_EPISODES_BY_ID[VIDEO_ID].video_path


def get_video_episode(scenario_id: str = VIDEO_ID) -> VideoEpisode:
    episode = VIDEO_EPISODES_BY_ID.get(scenario_id)
    if episode is None:
        raise ValueError("Неизвестный видеоэпизод")
    return episode


def is_video_scenario(scenario_id: str) -> bool:
    return scenario_id in VIDEO_EPISODES_BY_ID


def load_observations(scenario_id: str = VIDEO_ID) -> list[dict]:
    episode = get_video_episode(scenario_id)
    rows = json.loads(episode.json_path.read_text(encoding="utf-8"))["seconds"]
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


def video_scenario(scenario_id: str = VIDEO_ID) -> dict:
    episode = get_video_episode(scenario_id)
    return {
        "id": episode.id,
        "name": episode.name,
        "description": episode.description,
        "duration": len(load_observations(episode.id)),
        "tone": episode.tone,
        "kind": "video",
        "period": episode.period,
        "video_url": f"/api/videos/{episode.id}",
    }


def video_scenarios() -> list[dict]:
    return [video_scenario(episode.id) for episode in VIDEO_EPISODES]


def video_path(scenario_id: str = VIDEO_ID) -> Path:
    return get_video_episode(scenario_id).video_path


def _observed_phase_overlay(rows: list[dict]) -> tuple[list[str], list[str], list[dict]]:
    """Reconstruct the phase visible on a recording from sustained crossing activity.

    Short `on_road` bursts are treated as CV noise. This display-only timeline is
    intentionally separate from the counterfactual controller simulation.
    """
    phases = ["vehicle_green"] * len(rows)
    crossing_runs: list[tuple[int, int]] = []
    run_start = None
    for second in range(len(rows) + 1):
        active = second < len(rows) and rows[second]["camera_ok"] and (rows[second]["on_road"] or 0) > 0
        if active and run_start is None:
            run_start = second
        elif not active and run_start is not None:
            if second - run_start >= OBSERVED_CROSSING_MIN_SECONDS:
                crossing_runs.append((run_start, second - 1))
            run_start = None

    for start, end in crossing_runs:
        warning_start = max(0, start - WARNING_SECONDS - ALL_RED_SECONDS)
        all_red_start = max(warning_start, start - ALL_RED_SECONDS)
        for second in range(warning_start, all_red_start):
            phases[second] = "warning"
        for second in range(all_red_start, start):
            phases[second] = "all_red_to_ped"
        for second in range(start, end + 1):
            phases[second] = "pedestrian_green"
        for second in range(end + 1, min(len(rows), end + 1 + ALL_RED_SECONDS)):
            phases[second] = "all_red_to_vehicle"

    reasons = {
        "vehicle_green": "По записи пешеходы не находятся на проезжей части",
        "warning": "На записи начинается подготовка к пешеходной фазе",
        "all_red_to_ped": "Защитный интервал перед выходом пешеходов",
        "pedestrian_green": "На записи подтверждено устойчивое движение по переходу",
        "all_red_to_vehicle": "Защитный интервал после освобождения перехода",
    }
    display_reasons = [reasons[phase] for phase in phases]
    event_text = {
        "vehicle_green": "По записи проезд открыт транспорту",
        "warning": "Начало предупреждающей фазы по записи",
        "all_red_to_ped": "Защитный интервал перед переходом по записи",
        "pedestrian_green": "На записи началось устойчивое движение пешеходов",
        "all_red_to_vehicle": "Переход освобождён, защитный интервал",
    }
    events = [
        {"time": second, "type": "phase", "text": event_text[phase], "phase": phase}
        for second, phase in enumerate(phases)
        if second > 0 and phase != phases[second - 1]
    ]
    return phases, display_reasons, events


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
        new_queue = healthy and waiting and not previous_waiting
        queue_remains_after_service = (
            healthy and waiting and not pending and phase == "all_red_to_vehicle"
        )
        if new_queue or queue_remains_after_service:
            pending.append(second)
            text = "Очередь сохраняется после пешеходной фазы" if queue_remains_after_service else "Обнаружен пешеходный запрос"
            events.append({"time": second, "type": "request", "text": text})

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
                    elif group and oldest_wait >= 8:
                        next_phase, reason = "warning", "Приоритет группы пешеходов"
                    elif not group and flow is not None and flow <= config.low_flow_threshold and oldest_wait >= 5:
                        next_phase, reason = "warning", "Низкая интенсивность транспорта"
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
        **_phase_metrics(frames),
    }
    return {"frames": frames, "events": events, "summary": summary}


def simulate_video(config: Config, scenario_id: str = VIDEO_ID) -> dict:
    rows = load_observations(scenario_id)
    adaptive = _run(rows, config, fixed=False)
    baseline = _run(rows, config, fixed=True)
    display_phases, display_reasons, display_events = _observed_phase_overlay(rows)
    for frame, phase, reason in zip(adaptive["frames"], display_phases, display_reasons):
        frame["display_phase"] = phase
        frame["display_reason"] = reason
    adaptive_wait = adaptive["summary"]["mean_wait"]
    baseline_wait = baseline["summary"]["mean_wait"]
    comparable = (
        adaptive["summary"]["served_requests"] == baseline["summary"]["served_requests"] > 0
        and adaptive["summary"]["unserved_requests"] == baseline["summary"]["unserved_requests"]
    )
    difference = round(baseline_wait - adaptive_wait, 1) if comparable and adaptive_wait is not None and baseline_wait is not None else None
    return {
        "scenario_id": scenario_id,
        "scenario": video_scenario(scenario_id),
        "config": config.model_dump(),
        **adaptive,
        "display_events": display_events,
        "baseline": baseline["summary"],
        "modeled_wait_difference": difference,
        "recommendation": "Наблюдения обновляются синхронно с обработанным видео; фазы рассчитывает виртуальный контроллер.",
        "disclaimer": "Это повторное воспроизведение наблюдений. Решения и сравнение циклов являются модельной оценкой, а не результатом управления реальным светофором. Запросы, начавшиеся у конца записи и не успевшие завершиться, не входят в сравнение среднего ожидания.",
    }
