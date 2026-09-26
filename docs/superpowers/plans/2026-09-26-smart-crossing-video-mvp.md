# Smart Crossing Video MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Analyze a prepared video of up to 120 seconds, reproduce causal signal decisions, and show an evidence-linked recommendation and a model comparison with a fixed cycle.

**Architecture:** One causal pipeline consumes timestamped frames from `FrameSource`: detection and tracking → crossing events → rolling flow estimate → safe phase controller → visible result. The MVP implements `PreparedVideoSource` for repeatable offline demonstrations; a future live camera/RTSP source can provide the same frame contract without changing downstream logic. `Detector` is a narrow adapter point for the colleagues' video module when its output schema arrives. A separate fixed-cycle controller receives the same observed arrivals and requests for a clearly labeled model comparison.

**Tech Stack:** Python 3.11+, OpenCV, a locally cached lightweight Ultralytics YOLO model with ByteTrack, FastAPI/Jinja2, plain JavaScript/CSS, SQLite, pytest. Keep a CPU path and run the final app without internet. API references: [Ultralytics tracking](https://docs.ultralytics.com/modes/track), [FastAPI uploads](https://fastapi.tiangolo.com/tutorial/request-files/).

**Spec:** `docs/superpowers/specs/2026-09-26-smart-crossing-video-analysis-design.md`

## Global Constraints

- Prepared-video mode is the MVP frame source, not a separate algorithm. Frames must be processed in timestamp order; a decision at `t` sees no later frame.
- The production direction is live camera/RTSP through the same `FrameSource` contract. Do not build streaming, reconnect loops, message brokers, or RTSP configuration during this MVP.
- Source candidates and provenance are recorded in `demo_assets/README.md`; candidates are not yet validated CV examples. Bundled examples and ordinary video upload must use the same pipeline.
- Default policy: rolling 30-second traffic window, updated each second; five-second healthy empty-road check; car green minimum 15 s; low flow ≤6 vehicles/min with delay ≤5 s; pedestrian wait targets 45 s single and 30 s group; group threshold 5; car warning 3 s; all-red 2 s; pedestrian green 12 s; fallback car green 30 s.
- Missing, blank, frozen, or untrustworthy video never means zero traffic. Conflicting green signals and skipped clearances are forbidden.
- The current CV MVP identifies people and ordinary vehicle classes only. Visual similarity to emergency transport does not trigger priority. Reserve optional `vehicle_subtype` and `priority_input` in the event contract for a later verified priority policy; do not implement that policy now.
- All benefits and delays compared with a fixed cycle are conditional model results for the analyzed episode, never measured improvement in real road capacity.
- A full run in an available Linux environment is a required completion gate. Embedded-PC throughput remains unverified without that device.

## Review Focus

1. Corrupt or >120-second upload: reject it clearly before producing a report (Task 2).
2. Tracker/event state across consecutive videos: reset per source, so IDs and waiting requests do not leak (Tasks 2–3).
3. Healthy empty road versus source failure: only healthy absence of vehicles can accelerate pedestrian service (Tasks 3–4).
4. Group or high flow near a phase boundary: preserve min green, warning, all-red and pedestrian clearance, with zero conflicting greens (Task 4).
5. Window/baseline comparison: run on identical observed events, report conditional metrics and zero safety violations, and never call them measured road gains (Task 5).

## File map

- `pyproject.toml`, `src/smart_crossing/types.py`: dependencies, immutable frame/event/configuration contracts.
- `src/smart_crossing/source.py`: `FrameSource` and prepared-video implementation; the only frame-input boundary.
- `src/smart_crossing/vision.py`: person/vehicle tracking for one source at a time.
- `src/smart_crossing/events.py`: zones, unique counts, pedestrian requests, flow windows and video quality.
- `src/smart_crossing/controller.py`: adaptive phase state machine and fallback.
- `src/smart_crossing/pipeline.py`, `src/smart_crossing/preview.py`: early end-to-end runner and immediately visible HTML result.
- `src/smart_crossing/baseline.py`, `src/smart_crossing/evaluation.py`, `src/smart_crossing/report.py`: fixed cycle, policy metrics and recommendations.
- `src/smart_crossing/storage.py`, `src/smart_crossing/web.py`, `templates/`, `static/`: upload, bundled examples, replay, overlays, timeline and statistics.
- `tests/`: focused safety/unit/HTTP checks. `docs/camera-layout.md` and `docs/demo-runbook.md`: equipment concept and judged demonstration.

## Task 0: Candidate footage, camera layout and Linux target (about 1 hour)

Candidate Pexels clips already exist under ignored `demo_assets/videos/`; the 55-second crossing and 21-second group clips are the first candidates. This task does not certify their CV quality.

- [ ] **Step 1: Select a Linux test environment now** (container, VM or accessible Linux host) and record the exact run command in `docs/demo-runbook.md`. If none is available, provision one before the final gate; a macOS-only run cannot complete this plan.
- [ ] **Step 2: Create `docs/camera-layout.md` now**, not at the end. Show two cameras on existing standard supports: one covers both waiting zones and the crossing, the other covers vehicle approaches and the count line. Mark fields of view, mounting assumptions, occluded areas, night/lighting limits and which observations become invalid if either camera fails. The single wide-angle MVP clip is explicitly a demo approximation of that coverage.
- [ ] **Step 3: Quickly inspect the two candidate clips** and record approximate waiting/approach/crossing zones and count-line endpoints in `demo_assets/README.md`. Preserve source links, authors and license notes. Do detailed hand labeling during Tasks 2–3; replace a clip if the detector cannot support its intended scenario.

### Task 1: Minimal video-to-visible-result slice (about 5 hours)

**Files:** Create `pyproject.toml`, `src/smart_crossing/__init__.py`, `types.py`, `source.py`, `vision.py`, `events.py`, `controller.py`, `pipeline.py`, `preview.py`, and `tests/test_vertical_slice.py`. The first implementations are deliberately narrow and are strengthened in Tasks 2–4.

**Interfaces:** `FrameSource.frames() -> Iterator[FrameSample]` and `.info() -> VideoInfo`; `PreparedVideoSource(path: Path)` is the only implementation. `FrameSample(t_s: float, image: np.ndarray, healthy: bool)`. `Detector.detect(frame: FrameSample) -> FrameDetections`; `EventAggregator.add(detections: FrameDetections) -> list[SecondObservation]`; `Controller.tick(observation: SecondObservation) -> PhaseDecision`; `run(source: FrameSource, detector: Detector, zones: Zones, config: Config) -> AnalysisReport`. The first report contains detections, second observations, decisions and a source label. `TrackedObject` may carry optional `vehicle_subtype`; `SecondObservation` may carry optional `priority_input`, ignored by this MVP controller.

- [ ] **Step 1: Write a failing integration test** `test_video_to_detection_to_event_to_phase_to_visible_result`: use a tiny generated video and fake detector, assert at least one detected person becomes a request, the controller emits a phase decision, and `preview.html` displays its timestamp and reason. Also assert `run` consumes frames in increasing timestamp order.
- [ ] **Step 2: Run** `python -m pytest tests/test_vertical_slice.py -q`; expected: fail because the pipeline is absent.
- [ ] **Step 3: Implement the smallest working path**: OpenCV prepared-file reader; cache `yolo26n.pt` before the first real run and use its tracking adapter unless the colleagues' module is ready behind `Detector`; one configured waiting zone and vehicle count line; basic request/phase rule; `preview.py` writes a simple local HTML page containing a representative annotated frame, counts and phase timeline. Keep the controller's interface independent of file paths and model classes.
- [ ] **Step 4: Run the integration test and a real candidate clip** through `python -m smart_crossing.preview <clip-path>`. Expected: the HTML page opens locally and shows actual detections, an event, a phase and its reason. If the clip lacks a detectable event, mark it unsuitable and replace it; do not hard-code detections.
- [ ] **Step 5: Commit** the thin slice as `feat: show first video-to-phase result`.

**Gate:** By the end of Task 1 there is already a visible end-to-end demonstration. Later tasks improve correctness and presentation rather than creating the first working result.

### Task 2: Harden the prepared-video source and CV boundary (about 3 hours)

**Files:** Modify `source.py`, `vision.py`, `types.py`; create `tests/test_source_vision.py`.

**Interfaces:** `validate_video(path: Path) -> VideoInfo` raises `InvalidVideo` for unreadable, non-monotonic or >120-second files. `PreparedVideoSource` reports blank or exactly repeated frames lasting at least 3 seconds as unhealthy. `VisionEngine.reset()` or a fresh instance resets tracker state per video. Map person and normal vehicle classes into one tracked-object contract; preserve optional subtype metadata without emergency-priority behavior.

- [ ] **Step 1: Write failing tests** for corrupt/121-second files, monotonic frame timestamps, 3-second blank/frozen segments, and two consecutive videos with no shared track IDs. Test that a subtype alone leaves `priority_input` unset.
- [ ] **Step 2: Run** `python -m pytest tests/test_source_vision.py -q`; expected: fail.
- [ ] **Step 3: Implement validation and per-source tracking reset**. Keep raw footage local and cache model weights before the offline demo.
- [ ] **Step 4: Run tests and smoke-test selected real frames**; record model detections and clip suitability in `demo_assets/README.md`.
- [ ] **Step 5: Commit** as `feat: validate prepared video and tracking`.

### Task 3: Count events and compare traffic windows (about 3 hours)

**Files:** Modify `events.py`, `types.py`; create `tests/test_events.py`.

**Interfaces:** `SecondObservation` includes video second, unique vehicle arrivals, visible vehicles, stable waiting track IDs, group size, `video_ok`, rolling `flow_per_min`, `road_empty_5s` and warm-up status. `EventAggregator(zones: Zones, window_s: int).add(frame: FrameDetections) -> list[SecondObservation]` counts a vehicle once on the line and a waiting person only after 2 seconds. Support `window_s` 15, 30 or 45 without using future frames.

- [ ] **Step 1: Write failing tests** for one crossing over many frames counted once, five waiting people after 2 seconds, a vehicle at 31 s not affecting the 30-s estimate, correct warm-up denominator, and invalid video never becoming `road_empty_5s=True`.
- [ ] **Step 2: Run** `python -m pytest tests/test_events.py -q`; expected: fail.
- [ ] **Step 3: Implement** bounded arrival buckets, normalized zones and line crossing; record manually checked timestamps for at least two cars and one pedestrian request in each chosen demo clip.
- [ ] **Step 4: Run tests and compare 15/30/45-second event traces** on the same selected clips; save raw observations for Task 5.
- [ ] **Step 5: Commit** as `feat: derive crossing events and traffic windows`.

### Task 4: Enforce phase safety and fallback (about 3 hours)

**Files:** Modify `controller.py`, `types.py`; create `tests/test_controller.py`.

**Interfaces:** `Phase` states: `CAR_GREEN`, `CAR_WARNING`, `ALL_RED_TO_PED`, `PED_GREEN`, `ALL_RED_TO_CAR`. `Controller(config: Config).tick(obs: SecondObservation) -> PhaseDecision` starts at car green at `t=0`, remembers served track IDs until they exit, and records the reason for each transition. On bad video it completes required phase time and follows the fixed fallback cycle; it never interprets source failure as an empty road.

- [ ] **Step 1: Write failing tests**: empty road request at 0 s reaches pedestrian green at 20 s; group reaches it by 30 s and single request by 45 s when feasible; warning lasts 3 s and all-red 2 s; no conflicting green; already served ID cannot re-request; failure at 10 s selects fallback rather than empty-road acceleration.
- [ ] **Step 2: Run** `python -m pytest tests/test_controller.py -q`; expected: fail.
- [ ] **Step 3: Implement** min-car-green, low/high-flow deferral, group priority, wait deadlines and deterministic fallback. Protect mandatory clearance and pedestrian green from CV-driven shortening.
- [ ] **Step 4: Run** the controller tests and the Task 1 vertical-slice test; expected: all pass and the visible timeline reflects the safer policy.
- [ ] **Step 5: Commit** as `feat: enforce safe adaptive phase rules`.

### Task 5: Fixed-cycle baseline, window metrics and recommendations (about 3 hours)

**Files:** Create `baseline.py`, `evaluation.py`, `report.py`, `tests/test_evaluation.py`; modify `pipeline.py`, `types.py`.

**Interfaces:** `FixedCycleController(config: Config).tick(obs: SecondObservation) -> PhaseDecision` repeats car green 30 s → warning 3 s → all-red 2 s → pedestrian green 12 s → all-red 2 s from the same `t=0`. `PolicyMetrics(mean_ped_wait_s: float, max_ped_wait_s: float, conditional_vehicle_delay_s: float, switches: int, safety_violations: int)`. `evaluate(trace: tuple[SecondObservation, ...], decisions: tuple[PhaseDecision, ...]) -> PolicyMetrics`. Conditional vehicle delay is the sum, for observed vehicle arrivals during simulated non-car-green, of seconds until the next simulated car green. If a phase crosses the video end, extend only its known timer to determine release; assume no new arrivals. This estimate assumes arrivals do not change with the policy and does not model queues or real capacity. Safety violations count conflicting greens, illegal phase order, missed warning/all-red durations and shortened minimum green. `compare_windows(detections: tuple[FrameDetections, ...], zones: Zones, config: Config, windows: tuple[int, ...] = (15, 30, 45)) -> ComparisonReport` re-aggregates causal windows and runs adaptive and fixed-cycle policies on identical observed arrivals/requests.

- [ ] **Step 1: Write failing tests** that the fixed cycle follows exact phases, both policies use identical observed requests/arrivals, the metric formula gives a known result on a tiny trace, every compared policy has zero safety violations, and report wording says “модельная оценка для эпизода”, never “измеренное улучшение пропускной способности”.
- [ ] **Step 2: Run** `python -m pytest tests/test_evaluation.py -q`; expected: fail.
- [ ] **Step 3: Implement** baseline and evaluation, then calculate a 15/30/45 table with pedestrian wait, conditional vehicle delay, switches and safety violations. Keep 30 s as default unless the observed trade-off supports another window; explain the choice, and reject any candidate with a safety violation. Generate 1–2 recommendations tied to timestamps and metrics.
- [ ] **Step 4: Run tests and the vertical slice**; expected: comparison table and recommendation appear in the visible result.
- [ ] **Step 5: Commit** as `feat: compare adaptive and fixed signal policies`.

### Task 6: Product interface and persistence (about 3 hours)

**Files:** Create `storage.py`, `web.py`, `templates/index.html`, `templates/result.html`, `static/app.js`, `static/style.css`, `tests/test_web.py`; keep `preview.py` as the fast diagnostic path.

**Interfaces:** `POST /analyze` accepts uploaded video plus prepared zone profile/config; the home page also selects packaged examples through the same `run` pipeline. `GET /reports/{id}`, `/reports/{id}/data`, `/reports/{id}/video` show the result, structured evidence and local playback; `POST /reports/{id}/replay` changes policy parameters without rerunning CV. `ReportStore` persists report JSON and configuration in SQLite.

- [ ] **Step 1: Write failing HTTP tests** for corrupt upload rejection, bundled example and normal upload using the same pipeline, visible phase timeline/reasons/metrics/model-label, local video route, and parameter replay preserving raw counts.
- [ ] **Step 2: Run** `python -m pytest tests/test_web.py -q`; expected: fail.
- [ ] **Step 3: Implement** upload/configuration, virtual signal and video overlay, flow/window comparison, baseline comparison, statistics, quality markers and source attribution. Prefer a clear single result page over extra navigation or authentication.
- [ ] **Step 4: Run tests and open both example and upload flows locally**; expected: results agree with the Task 1 preview and Task 5 metrics.
- [ ] **Step 5: Commit** as `feat: present analyzed crossing episodes`.

### Task 7: Camera-layout review, Linux run and demo rehearsal (about 2 hours)

**Files:** Update `docs/camera-layout.md`, `demo_assets/README.md`; create `docs/demo-runbook.md`, `README.md`.

**Interfaces:** No new runtime API. The camera note links every input zone to a physical camera and support, documents count line, occlusions, night limitations and one-camera-loss behavior. The runbook records prepared clip paths, expected timestamps, attribution, Linux command and actual outputs.

- [ ] **Step 1: Run the full test suite** with `python -m pytest -q`, then run a selected prepared clip through the complete app inside the Linux environment selected in Task 0. Record OS/runtime, command, exit status, processing time and a result screenshot or report ID. **Do not mark MVP complete if this Linux run has not succeeded.**
- [ ] **Step 2: Recheck camera layout against the actual selected clip** and keep the physical two-camera proposal distinct from the one-camera demo view. Confirm the loss of either required view routes to fallback.
- [ ] **Step 3: Rehearse bundled example, upload and labeled fault clip** offline; verify detection → event → controller → visible result, 15/30/45 table, fixed baseline, zero safety violations and honest model language. Repair only failures that block this chain.
- [ ] **Step 4: Commit** the runbook, layout update and verified fixes as `docs: verify crossing MVP on Linux`.

## 24-hour cut line

Task 0 and Task 1 establish the first visible end-to-end result early. Tasks 2–5 make the evidence and controller credible; Task 6 replaces the diagnostic page with the judged product UI; Task 7 is a mandatory Linux/demo gate. The estimates total about 23 hours, leaving roughly one hour of contingency. If a candidate clip fails CV validation, replace it promptly and keep the failed result documented; never substitute synthetic detections while claiming the footage was analyzed. Live camera/RTSP and emergency-vehicle priority stay out of the MVP.
