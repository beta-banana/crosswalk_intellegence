# Smart Crossing Video MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local app that analyzes a prepared video up to 120 seconds, replays safe pedestrian-crossing phase decisions in chronological order, and explains recommendations for that episode.

**Architecture:** Video decoding and tracking produce timestamped observations. An event aggregator converts tracks into vehicle arrivals and pedestrian requests; a deterministic controller produces a phase timeline; a report builder and local web UI expose evidence, statistics, and recommendations. No real signal hardware is controlled.

**Tech Stack:** Python 3.11+, OpenCV, Ultralytics YOLO with ByteTrack, FastAPI with Jinja2 and plain browser JavaScript, SQLite, pytest. Keep a CPU path; record tested dependency versions during implementation. Use [Ultralytics tracking](https://docs.ultralytics.com/modes/track) and [FastAPI file uploads](https://fastapi.tiangolo.com/tutorial/request-files/) as API references.

**Spec:** `docs/superpowers/specs/2026-09-26-smart-crossing-video-analysis-design.md`

## Global Constraints

- MVP input is a prepared video no longer than 120 seconds with visible pedestrian waiting and vehicle approach zones.
- Decisions at `t` use only observations at or before `t`; processing can be offline, but phase logic cannot look ahead.
- Default rolling window is 30 seconds, updated each second; compare 15 and 45 seconds on the chosen demo clips.
- Virtual-controller defaults from the spec: minimum car green 15 s; low flow ≤6 vehicles/min; low-flow delay ≤5 s; single/group pedestrian wait targets 45/30 s; group threshold 5; car warning 3 s; all-red before and after pedestrian green 2 s; pedestrian green 12 s; fallback car green 30 s.
- Lost or untrustworthy video is never interpreted as an empty road. No conflicting green outputs.
- Video-based results describe the observed episode, not measured road-wide improvement; raw video stays local.
- Keep one Python app and SQLite. No cloud, microservices, custom model training, or real controller integration.

## Review Focus

1. Corrupt or 121-second upload: reject it with an actionable message rather than a partial report (Task 1 test).
2. A second upload after a first one: reset tracker and event state, so IDs and pending requests cannot leak (Tasks 2 and 3 tests).
3. A person or vehicle visible over many frames: count one request or line crossing per track, not one per frame (Task 3 test).
4. Frozen/blank video: mark data invalid and enter fallback, never trigger the empty-road rule (Tasks 1 and 4 tests).
5. A group or high-flow request near a phase boundary: respect clearance and wait bounds without simultaneous green (Task 4 test).

## File map

- `pyproject.toml`: runtime and test dependencies, package entry point.
- `src/smart_crossing/__init__.py`, `types.py`: package marker, shared immutable data types, zones, and virtual timing defaults.
- `src/smart_crossing/video.py`: upload validation, frame decoding, frame-health status.
- `src/smart_crossing/vision.py`: YOLO/ByteTrack adapter; outputs tracked boxes independently per upload.
- `src/smart_crossing/events.py`: zone membership, line crossings, pedestrian requests, rolling traffic observations.
- `src/smart_crossing/controller.py`: deterministic phase state machine and fallback.
- `src/smart_crossing/report.py`: statistics and evidence-linked recommendation rules.
- `src/smart_crossing/pipeline.py`: chronological orchestration and cached observations for parameter replay.
- `src/smart_crossing/storage.py`: SQLite report/config persistence.
- `src/smart_crossing/web.py`, `templates/`, `static/`: local upload, bundled example selector, configuration, progress, video overlays, result timeline.
- `tests/`: focused unit and HTTP integration tests; `demo_assets/README.md` records video provenance and manual truth markers; validated demo clips are bundled with the app.
- `docs/camera-layout.md`: two-camera deployment sketch and assumptions.

## Task 0: Source and verify demonstration footage (about 2 hours; before feature work)

Codex owns this task. Candidate files have been downloaded to `demo_assets/videos/`; their sources, dimensions, hashes, and visual-review status are in `demo_assets/README.md`. Start with the 55-second single-pedestrian clip and 21-second group clip. The 40-second overhead and 28-second signal clips are reserves. These are candidates, not prevalidated CV examples.

- [ ] **Step 1: Verify footage and provenance.** Recheck the [Pexels license](https://www.pexels.com/license/) and source pages, decode every selected file, and record author, URL, duration, resolution, SHA-256, and allowed app use. Keep attribution visible in the demo UI and documentation. Never imply the creators endorse the project.
- [ ] **Step 2: Mark ground truth manually.** For each selected clip, record normalized wait/approach/crossing zones and line endpoints; mark at least two vehicle line crossings, one sustained pedestrian request, group size ≥5 where claimed, and any genuine ≥5-second clear approach. Do not infer an empty-road interval from a sparse contact sheet.
- [ ] **Step 3: Run an early detector smoke test** on representative frames and a short sequence as soon as Task 2's adapter exists. Verify that the expected people and vehicles are detected and tracks remain usable. Replace a candidate promptly if the labels cannot be measured reliably; do not use a hard-coded event trace as evidence of CV.
- [ ] **Step 4: Prepare delivery files.** Select the smallest quality that still passes the detector check, compress if useful, and bundle those tested files with the application for offline use. Keep the downloaded originals ignored by Git. Build a clearly labeled fault example from a selected clip by inserting ≥3 seconds of black/frozen frames, and record this edit in provenance. The app must offer bundled examples as well as normal upload.
- [ ] **Step 5: Gate acceptance.** Have at least one normal clip with visible waiting zone and vehicle approach, a separate group example if needed, and a fault example. If a five-second clear approach is absent, find an additional genuine clip or omit that live-video claim and demonstrate the controller rule through tests only. Record exact video timestamps before final rehearsal.

This sourcing task is part of the build, not a dependency delegated to the team. Do the manual review before feature work, then complete detector validation and bundling at the indicated points.

### Task 1: Video intake and shared contracts (about 3 hours)

**Files:** Create `pyproject.toml`, `.gitignore`, `src/smart_crossing/__init__.py`, `src/smart_crossing/types.py`, `src/smart_crossing/video.py`, `tests/test_video.py`.

**Interfaces:** `validate_video(path: Path) -> VideoInfo` raises `InvalidVideo` on rejected inputs; `iter_frames(path: Path) -> Iterator[FrameSample]`. `VideoInfo(duration_s: float, width: int, height: int, fps: float)`; `FrameSample(t_s: float, image: np.ndarray, healthy: bool)`. `Zones` stores normalized wait/approach/crossing polygons and two endpoints for the vehicle count line; reject coordinates outside `[0, 1]`. Immutable `Config` fields/defaults: `min_car_green_s=15`, `low_flow_per_min=6`, `low_flow_delay_s=5`, `max_wait_single_s=45`, `max_wait_group_s=30`, `group_threshold=5`, `car_warning_s=3`, `all_red_s=2`, `ped_green_s=12`, `fallback_car_green_s=30`, `flow_window_s=30`, `empty_gap_s=5`. Reject negative or zero phase durations.

- [ ] **Step 1: Write failing tests** `test_rejects_corrupt_and_over_120_seconds` (`validate_video` raises `InvalidVideo` for both files), `test_decodes_monotonic_timestamps` (`all(b.t_s > a.t_s for a, b in pairwise(samples))`), `test_marks_three_seconds_of_blank_or_identical_frames_unhealthy` (`samples[-1].healthy is False`), `test_rejects_out_of_range_zones` (`Zones(...)` raises `ValueError`), and `test_rejects_invalid_phase_durations` (`Config(ped_green_s=0)` raises `ValueError`). Generate tiny local test videos with OpenCV, including a 121-second metadata fixture.
- [ ] **Step 2: Confirm red** with `python -m pytest tests/test_video.py -q`; expected: imports or assertions fail.
- [ ] **Step 3: Implement the listed interfaces** with OpenCV video I/O and explicit upload errors. A healthy static scene must not be confused with an unreadable file; mark repeated frames unhealthy only after 3 seconds of exact repetition. Use decoded timestamps and reject non-monotonic or zero-rate files.
- [ ] **Step 4: Confirm green** with the same command; expected: all Task 1 tests pass.
- [ ] **Step 5: Commit** only Task 1 files with `feat: validate crossing video inputs`.

### Task 2: Per-video detection and tracking (about 4 hours)

**Files:** Create `src/smart_crossing/vision.py`, `tests/test_vision.py`; modify `src/smart_crossing/types.py`.

**Interfaces:** `TrackedObject(track_id: int, kind: Literal["person", "vehicle"], box_xyxy: tuple[float, float, float, float], confidence: float)` and `FrameDetections(t_s: float, objects: tuple[TrackedObject, ...], healthy: bool)` in `types.py`; `VisionEngine(model_path: Path, model_factory: Callable[[Path], object] | None = None).analyze(frame: FrameSample) -> FrameDetections`; `VisionEngine.reset() -> None`. The pipeline creates or resets the engine for each upload. Map detector class IDs to person/vehicle; ignore all other classes.

- [ ] **Step 1: Write failing tests** `test_maps_person_and_vehicle_tracks` (`[(o.track_id, o.kind) for o in result.objects] == [(1, "person"), (2, "vehicle")]`), `test_ignores_untracked_or_other_classes` (`result.objects == ()`), and `test_new_video_resets_tracker_ids` (second engine's first ID is 1). Inject a fake model returning Ultralytics-shaped boxes.
- [ ] **Step 2: Confirm red** with `python -m pytest tests/test_vision.py -q`.
- [ ] **Step 3: Implement the adapter** using the locally cached `yolo26n.pt` model and `YOLO(...).track(frame, persist=True, tracker="bytetrack.yaml")` for consecutive frames of one video. Reset by creating a new model/tracker instance per upload; keep `ultralytics` import inside the adapter so unit tests do not download weights. Cache weights before the demo, so analysis works without internet.
- [ ] **Step 4: Confirm green** with the same command, then run one frame from the chosen demo clip using locally cached weights; expected: person/vehicle boxes or a documented unsuitable clip.
- [ ] **Step 5: Commit** Task 2 files with `feat: track pedestrians and vehicles`.

### Task 3: Events and traffic window (about 3 hours)

**Files:** Create `src/smart_crossing/events.py`, `tests/test_events.py`; modify `src/smart_crossing/types.py`.

**Interfaces:** `SecondObservation(t_s: int, vehicle_arrivals: int, vehicles_visible: int, waiting_track_ids: frozenset[int], group_size: int, flow_per_min: float, road_empty_5s: bool, video_ok: bool, warming_up: bool)` in `types.py`; `EventAggregator(zones: Zones, window_s: int = 30).add(frame: FrameDetections) -> list[SecondObservation]`. Aggregate on video seconds, count each vehicle track once on line crossing, expose waiting IDs after 2 seconds in the wait zone, and compute flow only from past arrivals. During the first 30 seconds divide count by observed elapsed window, not a full 30 seconds, and set `warming_up=True`. Keep waiting IDs independent of the chosen signal policy so parameter replay can reuse them.

- [ ] **Step 1: Write failing tests** `test_line_crossing_counted_once` (`sum(x.vehicle_arrivals for x in seconds) == 1` for one crossing track), `test_waiting_requires_two_seconds_and_group_is_five` (waiting IDs empty at 1 s, five IDs at 2 s), `test_window_uses_only_past_30_seconds` (an arrival at 31 s does not affect flow at 30 s), `test_warmup_uses_elapsed_denominator` (one arrival in 10 s yields 6 vehicles/min and `warming_up=True`), and `test_invalid_video_is_not_empty_road` (`video_ok is False and road_empty_5s is False`). A new aggregator must start with zero arrivals and no waiting IDs.
- [ ] **Step 2: Confirm red** with `python -m pytest tests/test_events.py -q`.
- [ ] **Step 3: Implement the listed aggregator** with a bounded deque of second buckets and normalized point-in-polygon/line-crossing helpers; emit one observation per elapsed video second.
- [ ] **Step 4: Confirm green** with the same command; expected: all event tests pass.
- [ ] **Step 5: Commit** Task 3 files with `feat: aggregate crossing events`.

### Task 4: Virtual signal controller (about 4 hours)

**Files:** Create `src/smart_crossing/controller.py`, `tests/test_controller.py`; modify `src/smart_crossing/types.py`.

**Interfaces:** `Phase` enum with `CAR_GREEN`, `CAR_WARNING`, `ALL_RED_TO_PED`, `PED_GREEN`, `ALL_RED_TO_CAR`; `PhaseDecision(t_s: int, phase: Phase, reason: str, pending_since_s: int | None)` in `types.py`; `Controller(config: Config).tick(obs: SecondObservation) -> PhaseDecision`. `Controller` starts in `CAR_GREEN` at `t=0`; a pending request persists until served. The controller remembers track IDs served by its own pedestrian phases and ignores them until they leave the waiting zone; this makes replay with a different Config independent of the event aggregator. `video_ok=False` enters fallback using the spec's 30-second car-green cycle and fixed clearances.

- [ ] **Step 1: Write failing tests** `test_empty_road_serves_after_minimum_green` (request at 0 s gives `PED_GREEN` at 20 s), `test_low_flow_waits_at_most_five_seconds_after_eligibility` (warning starts by 20 s), `test_group_begins_ped_green_by_30_seconds_when_feasible` (`PED_GREEN` by 30 s), `test_single_request_begins_by_45_seconds_when_feasible` (`PED_GREEN` by 45 s), `test_served_tracks_do_not_request_again_until_exit` (same ID creates one service), `test_no_conflicting_green_or_skipped_clearance` (3 warning seconds and 2 all-red seconds before pedestrian green), and `test_camera_failure_runs_fallback_not_empty_road` (failure at 10 s does not use reason `empty_road`). Include a request near a phase boundary.
- [ ] **Step 2: Confirm red** with `python -m pytest tests/test_controller.py -q`.
- [ ] **Step 3: Implement the state machine** using second timestamps, the Config defaults, and trigger deadlines 5 seconds before the pedestrian-green wait targets. At high flow wait for a confirmed 5-second gap or the deadline; at low flow trigger within 5 seconds after minimum car green; group uses the shorter deadline and counts only unserved waiting IDs. On fault during car green, keep that car phase until 30 seconds from its start (or transition immediately if already older); on fault during pedestrian green, complete 12 seconds and the 2-second all-red before a new fallback car cycle.
- [ ] **Step 4: Confirm green** with the same command; expected: every safety and wait-bound assertion passes.
- [ ] **Step 5: Commit** Task 4 files with `feat: replay safe crossing phases`.

### Task 5: Report and chronological pipeline (about 3 hours)

**Files:** Create `src/smart_crossing/report.py`, `src/smart_crossing/pipeline.py`, `tests/test_pipeline.py`; modify `src/smart_crossing/types.py`.

**Interfaces:** `AnalysisReport` in `types.py` contains `observations: tuple[SecondObservation, ...]`, `decisions: tuple[PhaseDecision, ...]`, `tracks: tuple[FrameDetections, ...]`, `totals: dict[str, int | float]`, `quality_intervals: tuple[tuple[float, float], ...]`, `recommendations: tuple[str, ...]`, and `config: Config`. `analyze_video(path: Path, zones: Zones, config: Config, model_path: Path, vision_factory: Callable[[Path], VisionEngine] | None = None) -> AnalysisReport`; `replay(base: AnalysisReport, config: Config) -> AnalysisReport` reuses the base report's observations and overlay data after parameter edits. Report rules cite exact video times and metrics.

- [ ] **Step 1: Write failing tests** `test_pipeline_never_feeds_future_observation` (a vehicle arriving at 31 s cannot change decision at 30 s), `test_replay_changes_phases_without_rerunning_detector` (phase timeline changes while fake detector call count stays fixed), `test_recommendation_cites_observed_time_and_counts` (text carries event time and count), and `test_unhealthy_segment_limits_recommendation` (quality warning appears and no numeric improvement claim). Use a fake vision engine and a two-minute event sequence.
- [ ] **Step 2: Confirm red** with `python -m pytest tests/test_pipeline.py -q`.
- [ ] **Step 3: Implement orchestration and report rules**; feed each emitted second to the controller in timestamp order. Recommendations are limited to observed free-road waiting, group waiting, or insufficient video quality. Label any fixed-cycle comparison as a model estimate, never observed improvement.
- [ ] **Step 4: Confirm green** with the same command; expected: all pipeline tests pass.
- [ ] **Step 5: Commit** Task 5 files with `feat: explain video-based phase decisions`.

### Task 6: Local upload and result UI (about 3 hours)

**Files:** Create `src/smart_crossing/storage.py`, `src/smart_crossing/web.py`, `src/smart_crossing/templates/index.html`, `src/smart_crossing/templates/result.html`, `src/smart_crossing/static/app.js`, `src/smart_crossing/static/style.css`, `tests/test_web.py`.

**Interfaces:** `POST /analyze` accepts a multipart video plus zone/config JSON and returns a local report ID after analysis; the home page also offers packaged demo clips with their prepared zone profiles, using the same analysis pipeline. `GET /reports/{id}` renders results; `GET /reports/{id}/data` returns structured evidence for charts and overlays; `GET /reports/{id}/video` streams the local upload or bundled clip for playback; `POST /reports/{id}/replay` recalculates phases with changed Config. `ReportStore.save(report: AnalysisReport) -> str` and `.load(report_id: str) -> AnalysisReport` persist report JSON and configuration in SQLite. Keep user-uploaded video in local temporary storage only while the result page needs playback.

- [ ] **Step 1: Write failing HTTP tests** `test_rejects_bad_upload_with_message` (4xx plus readable error), `test_upload_creates_report_and_result_page` (success ID and result HTTP 200), `test_bundled_example_uses_same_pipeline` (bundled clip is selectable and report cites its source), `test_result_contains_timeline_stats_and_reason` (report JSON has all three and video route streams bytes), and `test_replay_changes_config_without_detector_call` (new phase times, unchanged detector call count). Use FastAPI TestClient and a stub pipeline.
- [ ] **Step 2: Confirm red** with `python -m pytest tests/test_web.py -q`.
- [ ] **Step 3: Implement storage and UI**. Offer bundled examples and normal upload. Use a prepared zone profile per example, with editable normalized coordinates shown over the preview. Show a busy state during synchronous processing, then raw video with canvas box/zone overlays, flow chart, phase timeline, reasons, statistics, quality markers, source credit, and 1–2 recommendations. Do not add login, cloud upload, or a generic dashboard framework.
- [ ] **Step 4: Confirm green** with the same command; expected: all HTTP tests pass and result page loads in a local browser.
- [ ] **Step 5: Commit** Task 6 files with `feat: present crossing analysis locally`.

### Task 7: Demo rehearsal and deployment note (about 2 hours)

**Files:** Create `docs/camera-layout.md`, `docs/demo-runbook.md`, `README.md`; update `demo_assets/README.md`.

**Interfaces:** No new runtime API. The runbook gives exact local launch, packaged example selection, clip paths, expected timestamps, and fallback evidence. The layout note shows two cameras on existing supports, wait/approach coverage, count line, occlusion and night-light limitations, plus what must be verified on a real controller and embedded PC.

- [ ] **Step 1: Record a failing acceptance checklist** in `docs/demo-runbook.md`: normal clip must yield boxes, counts, 2–3 explained decisions, recommendation, and stats; failure clip must yield fallback, never empty-road acceleration. Record the manual truth markers from preflight.
- [ ] **Step 2: Run `python -m pytest -q` and the full local upload flow**; mark any failed checklist item with observed output, not a promise.
- [ ] **Step 3: Fix only defects blocking the checklist**, add camera-layout and launch instructions, and record processing time, model name, Python version, and memory on the demo laptop. Smoke-test application startup in a Linux environment if one is available; state clearly whether that test ran. Do not claim embedded-PC performance from laptop or container measurements.
- [ ] **Step 4: Repeat the full upload and bundled-example flows and test suite offline**; expected: all tests pass and selected clips produce the specified evidence without editing results by hand.
- [ ] **Step 5: Commit** docs and necessary fixes with `docs: prepare crossing MVP demonstration`.

## 24-hour cut line

Task 0 plus Tasks 1–5 form the functional core. Task 6 may use a plain but readable result page if time tightens; preserve upload, bundled example selection, phase timeline, reasons, and statistics before styling. Task 7 reserves final rehearsal time. If CV on a chosen video is unreliable, report that limitation and improve the footage or zones; do not substitute hard-coded detections while claiming the video was analyzed.
