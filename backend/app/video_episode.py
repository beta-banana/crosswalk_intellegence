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
    _phase_metrics,
    _safety_violations,
)
from .adaptive_control import SimulatedController


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


# Prepared recordings stay in the project next to their CV JSON. The short ids
# are stable API/UI identifiers; the original folder names are kept untouched.
VIDEO_EPISODES = (
    VideoEpisode(
        id=VIDEO_ID,
        name="Дневная запись",
        description="Дневные условия: основной эпизод с активным движением пешеходов по переходу",
        json_filename="video_and_json/НА 3/result_crosswalk.json",
        video_filename="video_and_json/НА 3/result_crosswalk_web.mp4",
        period="День",
        tone="day",
    ),
    VideoEpisode(
        id="morning",
        name="Утренняя запись",
        description="Утренние условия: естественное освещение и меняющаяся интенсивность потока",
        json_filename="video_and_json/НА 2/result_crosswalk.json",
        video_filename="video_and_json/НА 2/result_crosswalk_web.mp4",
        period="Утро",
        tone="morning",
    ),
    VideoEpisode(
        id="night",
        name="Ночная запись",
        description="Низкая освещённость: проверка распознавания транспорта и пешеходов ночью",
        json_filename="video_and_json/НА/result_crosswalk.json",
        video_filename="video_and_json/НА/result_crosswalk_web.mp4",
        period="Ночь",
        tone="night",
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
            phases[second] = "vehicle_yellow"
        for second in range(all_red_start, start):
            phases[second] = "all_red_to_pedestrian"
        for second in range(start, end + 1):
            phases[second] = "pedestrian_walk"
        for second in range(end + 1, min(len(rows), end + 1 + 6)):
            phases[second] = "pedestrian_clearance"
        for second in range(end + 7, min(len(rows), end + 7 + ALL_RED_SECONDS)):
            phases[second] = "all_red_to_vehicle"

    reasons = {
        "vehicle_green": "По записи пешеходы не находятся на проезжей части",
        "vehicle_yellow": "На записи начинается подготовка к пешеходной фазе",
        "all_red_to_pedestrian": "Защитный интервал перед выходом пешеходов",
        "pedestrian_walk": "На записи подтверждено устойчивое движение по переходу",
        "pedestrian_clearance": "Расчётное время освобождения перехода",
        "all_red_to_vehicle": "Защитный интервал после освобождения перехода",
    }
    display_reasons = [reasons[phase] for phase in phases]
    event_text = {
        "vehicle_green": "По записи проезд открыт транспорту",
        "vehicle_yellow": "Начало предупреждающей фазы по записи",
        "all_red_to_pedestrian": "Защитный интервал перед переходом по записи",
        "pedestrian_walk": "На записи началось устойчивое движение пешеходов",
        "pedestrian_clearance": "Расчётное освобождение перехода",
        "all_red_to_vehicle": "Переход освобождён, защитный интервал",
    }
    events = [
        {"time": second, "type": "phase", "text": event_text[phase], "phase": phase}
        for second, phase in enumerate(phases)
        if second > 0 and phase != phases[second - 1]
    ]
    return phases, display_reasons, events


def _run(rows: list[dict], config: Config, fixed: bool) -> dict:
    """Replay aggregate CV through the preset cycle; it cannot drive adaptation."""
    controller = SimulatedController({
        "vehicle_yellow": WARNING_SECONDS,
        "all_red_to_pedestrian": ALL_RED_SECONDS,
        "pedestrian_walk": 12,
        "pedestrian_clearance": config.pedestrian_clearance,
        "all_red_to_vehicle": ALL_RED_SECONDS,
    }, config.min_vehicle_green, FALLBACK_VEHICLE_SECONDS)
    waits: list[int] = []
    pending_since: int | None = None
    switches = 0
    first_pedestrian_green = None
    frames: list[dict] = []
    events: list[dict] = []

    for second, observed in enumerate(rows):
        healthy = observed["camera_ok"]
        mode = "fixed" if fixed else "fallback"
        waiting = observed["waiting"] if healthy else None
        on_road = observed["on_road"] if healthy else None
        flow_first = max(0, second - FLOW_WINDOW_SECONDS + 1)
        flow = (2 * sum(row["new_vehicles"] or 0 for row in rows[flow_first:second + 1])) if healthy else None
        clear_first = second - CLEAR_ROAD_SECONDS + 1
        clear_gap = healthy and clear_first >= 0 and all(
            row["camera_ok"] and row["vehicles"] == 0
            for row in rows[clear_first:second + 1]
        )

        if healthy and waiting and pending_since is None:
            pending_since = second
        before = controller.read_phase(second)
        state = controller.advance(second, request=False, fallback=True)
        phase = state.phase
        if phase != before.phase:
            switches += 1
            events.append({"time": second, "type": "phase", "text": f"Резервный цикл: {phase}", "phase": phase})
            if phase == "pedestrian_walk" and first_pedestrian_green is None:
                first_pedestrian_green = second
            if phase == "pedestrian_walk" and pending_since is not None:
                waits.append(second - pending_since)
                pending_since = None
        reason = "Запись без track_id и участка плотности: работает резервный фиксированный цикл"

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
            "waiting_seconds": second - pending_since if pending_since is not None else 0,
            "timestamp_s": second, "phase_elapsed_s": state.elapsed_s,
            "n_waiting": None, "wait_s": None, "vehicles_in_segment": None,
            "k": None, "k_ref": config.k_ref, "weight": None, "priority": None,
            "request_pending": False,
            "data_quality": "camera_unavailable" if not healthy else "aggregate_replay_only",
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
        "unserved_requests": int(pending_since is not None),
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
    return {
        "scenario_id": scenario_id,
        "scenario": video_scenario(scenario_id),
        "config": config.model_dump(),
        **adaptive,
        "display_events": display_events,
        "baseline": baseline["summary"],
        "modeled_wait_difference": None,
        "recommendation": "Запись содержит только секундные агрегаты без track_id, геометрии участка и состояния контроллера. Адаптивные решения отключены; показан резервный цикл.",
        "disclaimer": "CV-наблюдения получены из готовой видеозаписи. Модельные сигналы рассчитаны фиксированным циклом, реальные фазы не измерялись. Ожидание оценочное; сравнение режимов по этой записи невозможно.",
    }
