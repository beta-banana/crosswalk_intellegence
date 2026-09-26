# Smart Crossing Interactive Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a polished local operator console that demonstrates real event aggregation, adaptive signal control, safety fallback, statistics, model comparison, and parameter replay using deterministic detection fixtures.

**Architecture:** `DetectionProvider` yields timestamped `FrameDetections`. The same event aggregator, rolling window, decision engine, phase machine, statistics and frontend consume fixtures now and a CV adapter later. Only the provider changes when the separate video team delivers its module. The browser shows a simulation workspace for fixture data and can later overlay the same normalized boxes on real video.

**Tech Stack:** Python 3.11+, FastAPI, Jinja2, SQLite, plain JavaScript/CSS/SVG, pytest. No YOLO, OpenCV, ByteTrack, model weights, video decoding, inference optimization or CV benchmark in this plan. Use the `frontend-design` skill for the operator screen and the `playwright` skill/CLI for browser QA after the UI exists.

**Spec:** `docs/superpowers/specs/2026-09-26-smart-crossing-video-analysis-design.md`. This plan implements the application around CV; final video analysis remains an integration milestone after the other team's output schema arrives.

## Global Constraints

- Fixtures replace **only detection**. Event counting, 30-second rolling traffic estimate, five-second healthy empty-road check, pedestrian requests, group priority, phase decisions, safety, fallback, statistics, fixed-cycle baseline and parameter replay use production logic.
- Default virtual timings from the approved spec: car green minimum 15 s; low flow ≤6 vehicles/min with deferral ≤5 s; pedestrian wait targets 45 s single/30 s group; group threshold 5; car warning 3 s; all-red 2 s; pedestrian green 12 s; fallback car green 30 s.
- Decision at time `t` uses only detections at or before `t`. An unhealthy source is never interpreted as an empty road. No conflicting green signals or skipped clearances.
- Scenario-derived results are visibly labeled **демонстрационный сценарий**. Baseline differences are **модельная оценка для эпизода**, not measured road-capacity gains.
- Emergency-vehicle recognition is out of scope. Optional `vehicle_subtype` and `priority_input` are reserved in the contract; visual subtype alone never changes a phase.
- A future CV adapter must only implement `DetectionProvider`; it must not force changes to events, decision logic, statistics or frontend data shapes.
- The app must run locally in a browser. A complete run in an available Linux environment is mandatory before declaring this prototype complete; embedded-PC performance remains untested.

## Stable CV boundary

Define `DetectedObject(track_id: str, object_type: Literal["person", "vehicle"], bbox_norm: tuple[float, float, float, float], confidence: float, vehicle_subtype: str | None = None)`. The box is `(x_min, y_min, x_max, y_max)` in `[0,1]`; IDs are stable within a source run. Define `FrameDetections(timestamp_s: float, healthy: bool, objects: tuple[DetectedObject, ...], priority_input: bool | None = None)`. Frames have strictly increasing timestamps. `healthy=False` invalidates the frame's objects for traffic decisions.

`DetectionProvider.iter_detections() -> Iterator[FrameDetections]` is the only upstream interface. `FixtureDetectionProvider(scenario_id)` produces all four demo cases now. Later, `CVDetectionAdapter` maps the other team's classes, track IDs, coordinates, timestamps and source-health signal into this contract; its implementation waits for their sample schema. No real CV code belongs in this plan.

`CachedDetectionProvider(frames: tuple[FrameDetections, ...])` replays an already captured trace for changed parameters. It implements the same interface and prevents fixture generation or a future CV detector from running again during parameter replay.

Document the contract and one JSON example in `docs/interfaces/detection-provider-v1.md`. Validate normalized boxes, confidence, object type, timestamp order and source health at the boundary. If the later CV module has variable frame rate, its adapter preserves timestamps; the aggregator bins them into video seconds.

`Zones` is separate site configuration: normalized waiting, approach and crossing polygons plus a vehicle count line. A fixture scenario supplies its `Zones`; a real crossing will configure them for its camera view. Neither fixture nor CV adapter decides phases.

Fixture timing is deterministic and uses 1-second frames; vehicle boxes move across the count line around each listed arrival, while waiting IDs remain stable until their listed exit. This table fixes the four demo inputs rather than hard-coding their outcomes:

| Scenario | Length | Vehicle arrivals | Pedestrian tracks | Source health |
| --- | ---: | --- | --- | --- |
| `normal` | 90 s | t=3, 9, 18, 30, 42, 54, 66 | one waiting from t=10 to 55 | healthy |
| `group` | 90 s | every 4 s from t=4 through 48 | six waiting from t=8 to 55 | healthy |
| `empty` | 60 s | none | one waiting from t=2 to 45 | healthy |
| `failure` | 60 s | t=5, 10 before failure | one waiting from t=8 to 45 | unhealthy t=18–25 inclusive |

## Frontend design direction

Use one operator screen with the **crossing workspace as the focal element**, not an array of equal cards. Suggested tokens, to refine against real screenshots: mist `#E9EFF0` background, deep traffic blue `#173545` structure, signal teal `#16747A` normal action, amber `#D9952B` caution/fallback, red `#B84A46` fault, pale line `#CBD8DA`. Use IBM Plex Sans for controls/text and IBM Plex Mono only for timecodes and measured values; bundle fonts for offline demo if used.

```text
Scenario + playback controls                         Source/safety status
┌──────────────────────────── crossing workspace ───────────────────────┐
│ road, waiting zones, tracked boxes, virtual car/ped signals          │
└───────────────────────────────────────────────────────────────────────┘
Current decision + reason          Flow / waiting / elapsed wait
Phase timeline across full width   Flow chart across same time axis
Fixed vs adaptive comparison       Evidence-linked recommendation
```

Keep alignment and time axes consistent. Use compact status bands and clear signal shapes; reserve motion for playback and phase changes, with reduced-motion support. Scenario selection resets the playhead and updates detections, events, phase timeline, numbers and recommendation together. Fault state must be unmistakable without relying on color alone. Before coding, compare the layout against a generic card dashboard and remove decorative cards or animations that do not explain traffic behavior.

Compared with a grid of equal KPI cards, this layout gives the crossing and phase timeline most of the space; that choice makes cause and effect legible during a live jury demonstration.

## Review Focus

1. Switching scenarios must change underlying detections and controller decisions, not just headings or colors (Tasks 1–2).
2. Repeated track IDs across frames count once; IDs from a new provider run cannot leak into the previous scenario (Tasks 1 and 3).
3. Empty road and camera failure must lead to different phase decisions and status text (Tasks 1 and 3).
4. Group priority must preserve minimum/clearance intervals and zero conflicting greens (Task 3).
5. Parameter replay must reuse cached detections and change decisions/statistics without rewriting fixture data (Task 4).

## File map

- `pyproject.toml`, `src/smart_crossing/types.py`, `provider.py`: package setup, validated detection contract, four fixture providers.
- `src/smart_crossing/events.py`, `controller.py`, `pipeline.py`: genuine causal event and phase logic.
- `src/smart_crossing/baseline.py`, `evaluation.py`, `report.py`: fixed cycle, comparable episode metrics and recommendations.
- `src/smart_crossing/storage.py`, `web.py`, `templates/operator.html`, `static/operator.css`, `static/operator.js`: one local operator screen and persisted reports.
- `tests/`: contract, scenario, safety, comparison and HTTP tests. `docs/interfaces/detection-provider-v1.md`, `docs/camera-layout.md`, `docs/demo-runbook.md`: integration and demo evidence.

## Task 0: Camera layout and Linux preflight, parallel to core work (about 1 hour)

- [ ] **Step 1: Create `docs/camera-layout.md`** with two cameras on existing supports: waiting/crossing coverage and vehicle approach/count-line coverage, fields of view, occlusions, night limitations and the missing observations when either view fails. Keep the proposed real installation distinct from the simulated demo workspace.
- [ ] **Step 2: Choose an available Linux container, VM or host** and record how Task 6 will launch the app there. If none exists, prepare one before claiming completion. This preflight does not block Task 1's local browser work.

### Task 1: First browser vertical slice with real core logic (about 5 hours)

**Files:** Create `pyproject.toml`, `src/smart_crossing/__init__.py`, `types.py`, `provider.py`, `events.py`, `controller.py`, `pipeline.py`, `web.py`, `templates/operator.html`, `static/operator.css`, `static/operator.js`, `docs/interfaces/detection-provider-v1.md`, `tests/test_vertical_slice.py`.

**Interfaces:** `FixtureDetectionProvider(scenario_id: str).iter_detections() -> Iterator[FrameDetections]`; `ScenarioSpec(id: str, zones: Zones)` pairs a scenario with normalized geometry. `EventAggregator(zones: Zones, config: Config).add(frame: FrameDetections) -> list[SecondObservation]`; `Controller(config: Config).tick(obs: SecondObservation) -> PhaseDecision`; `analyze(provider: DetectionProvider, zones: Zones, config: Config) -> AnalysisReport`; `GET /` serves the operator screen and `GET /api/scenarios/{id}` returns the report. `Config` fields/defaults: `min_car_green_s=15`, `low_flow_per_min=6`, `low_flow_delay_s=5`, `max_wait_single_s=45`, `max_wait_group_s=30`, `group_threshold=5`, `car_warning_s=3`, `all_red_s=2`, `ped_green_s=12`, `fallback_car_green_s=30`, `flow_window_s=30`, `empty_gap_s=5`. `AnalysisReport` carries `frames`, `observations`, `decisions`, `stats`, `config`, `source_label`, `recommendations` (initially empty) and `comparison` (initially absent), with timestamps aligned for browser playback.

- [ ] **Step 1: Write failing tests** `test_fixture_to_visible_signal` (normal fixture produces a waiting request, a phase change and an HTML/JSON result with matching timestamp), `test_empty_road_is_not_failure` (empty-road reason appears only while healthy), and `test_unsupported_detection_is_rejected` (bad box/type/timestamp fails validation).
- [ ] **Step 2: Run** `python -m pytest tests/test_vertical_slice.py -q`; expected: fail.
- [ ] **Step 3: Implement one real causal path** from fixture boxes through zone/line events, flow window, pedestrian request and state machine to the browser. Start with the normal and empty-road fixtures. Draw a simple SVG crossing with virtual car/ped lights, bounding boxes, current mode, counts and decision reason; a scenario selector changes backend report and visible state. These are working rules, not prewritten phase timelines.
- [ ] **Step 4: Run tests and open `http://localhost:8000`**; expected: both fixtures play through real decisions on one browser screen. The source badge says “демонстрационный сценарий”.
- [ ] **Step 5: Commit** as `feat: show fixture-driven crossing vertical slice`.

**Deliverable after Task 1:** a locally running browser screen, two distinct scenarios, real events and controller decisions, virtual signals, counts and reason text.

### Task 2: Complete the interactive operator screen and four scenarios (about 4 hours)

**Files:** Extend `provider.py`, `web.py`, `templates/operator.html`, `static/operator.css`, `static/operator.js`; create `tests/test_scenarios_ui.py`.

**Interfaces:** Add deterministic `normal`, `group`, `empty`, `failure` scenarios, each yielding `FrameDetections` through the same provider. `POST /api/replay` accepts scenario ID and validated Config, reruns `analyze` through `CachedDetectionProvider` on the exact cached detections, and returns the new report. UI playback/scrubbing reads timestamps from the report; it never invents phase decisions client-side.

- [ ] **Step 1: Write failing tests** that normal has moving vehicle boxes and one waiting person; group has at least five simultaneous waiting IDs and a group-priority reason; empty has no vehicles and earlier pedestrian service; failure emits `healthy=False` and fallback, not empty-road acceleration. Replay must change at least one phase time while fixture frames remain byte-for-byte equal.
- [ ] **Step 2: Run** `python -m pytest tests/test_scenarios_ui.py -q`; expected: fail.
- [ ] **Step 3: Finish the one-screen UI** with simulation workspace, zones, boxes, paired signal heads, current mode, car count, measured flow intensity (vehicles/min) and visible occupancy as the density proxy, waiting count/time, reason, full-width phase timeline, flow chart, source/safety status and scenario selector. Add play/pause/scrub, responsive layout, keyboard focus and reduced-motion behavior. Use data-driven SVG overlays; no decorative card grid.
- [ ] **Step 4: Run tests and Playwright CLI smoke flows** using the bundled wrapper after `command -v npx` succeeds: switch all four scenarios, replay a parameter, snapshot the page and capture desktop/narrow screenshots under `output/playwright/`. Correct any misleading phase/safety rendering.
- [ ] **Step 5: Commit** as `feat: complete interactive ITS operator screen`.

**Deliverable after Task 2:** all four scenarios drive real changing detections, events, phases and UI; the operator can play, scrub, switch scenarios and replay parameters. Basic statistics and safety state are visible. Baseline comparison and final recommendation rules follow in Task 4.

### Task 3: Harden aggregation, safety and fallback (about 3 hours)

**Files:** Modify `events.py`, `controller.py`, `types.py`; create `tests/test_events_controller.py`.

**Interfaces:** Per-second observations include unique arrivals, visible vehicles, stable waiting IDs after 2 seconds, group size, rolling flow, healthy empty-road flag and warm-up status. The controller uses `CAR_GREEN → CAR_WARNING → ALL_RED_TO_PED → PED_GREEN → ALL_RED_TO_CAR`; served IDs cannot request again until they exit. Unhealthy input enters the fixed fallback program after mandatory phase time.

- [ ] **Step 1: Write failing tests** for one track counted once across frames, 2-second waiting stability, 30-second causal window and 5-second healthy empty road; group service by 30 s and single service by 45 s when feasible; 3-second warning, 2-second all-red, 12-second pedestrian green; no conflicting greens; failure at 10 s selects fallback.
- [ ] **Step 2: Run** `python -m pytest tests/test_events_controller.py -q`; expected: fail.
- [ ] **Step 3: Implement the missing correctness rules** in the same core modules used by fixtures and future CV; keep priority input inert in MVP.
- [ ] **Step 4: Run tests and replay all four browser scenarios**; expected: visible phases, reasons and health agree with the strengthened rules.
- [ ] **Step 5: Commit** as `feat: enforce crossing event and signal safety`.

### Task 4: Statistics, fixed baseline and recommendation (about 3 hours)

**Files:** Create `baseline.py`, `evaluation.py`, `report.py`, `tests/test_evaluation.py`; modify `pipeline.py`, `web.py`, `templates/operator.html`, `static/operator.js`.

**Interfaces:** `FixedCycleController(config: Config)` runs the same start state with car green 30 s, warning 3 s, all-red 2 s, pedestrian green 12 s and return all-red 2 s. `evaluate(observations, decisions) -> PolicyMetrics` returns pedestrian mean/max wait, conditional vehicle delay, phase switches and safety-violation count. Conditional vehicle delay sums time until the next virtual car green for observed arrivals during non-car-green; if a known phase extends beyond fixture end, extend that phase timer without assuming new arrivals. It assumes arrivals are unchanged and is not a real capacity measurement. Safety violations count conflicting greens, illegal phase order, skipped warning/all-red and shortened minimum phases. Run adaptive 15/30/45-second windows on the same fixture detections; reject any option with a safety violation and explain the 30-second default or chosen alternative.

- [ ] **Step 1: Write failing tests** for exact fixed-cycle phases, equal input arrivals/requests across policies, known metric totals, zero safety violations, window comparison on identical detections, and report text saying “модельная оценка для эпизода”.
- [ ] **Step 2: Run** `python -m pytest tests/test_evaluation.py -q`; expected: fail.
- [ ] **Step 3: Implement real statistics and 1–2 evidence-linked recommendation rules**, then add fixed/adaptive comparison and 15/30/45 metrics to the existing screen. Preserve the displayed source label and explain the assumptions beside comparisons.
- [ ] **Step 4: Run tests and inspect the browser**; expected: changing scenario or configuration changes relevant metrics/recommendations, while raw fixture counts remain fixed under parameter replay.
- [ ] **Step 5: Commit** as `feat: compare crossing policies and explain recommendations`.

### Task 5: Persistence and CV handoff without CV work (about 2 hours)

**Files:** Create `storage.py`, `tests/test_storage.py`; update `docs/interfaces/detection-provider-v1.md`, `web.py`, `README.md`.

**Interfaces:** `ReportStore.save(report: AnalysisReport) -> str` and `.load(report_id: str) -> AnalysisReport` persist reports/configuration in SQLite. The contract document defines how the future `CVDetectionAdapter` must map timestamps, health, stable IDs, `person`/`vehicle`, normalized boxes and confidence. Optional subtype/priority input are documented but do not affect the controller.

- [ ] **Step 1: Write failing tests** for report round-trip, scenario switch creating a distinct report, and replay loading cached detections without invoking a provider again.
- [ ] **Step 2: Run** `python -m pytest tests/test_storage.py -q`; expected: fail.
- [ ] **Step 3: Implement SQLite storage and the adapter handoff document**. Do not write the real adapter until the other team's schema is available.
- [ ] **Step 4: Run storage and HTTP tests**; expected: reports and parameter replay survive app restart.
- [ ] **Step 5: Commit** as `feat: persist reports and define CV handoff`.

### Task 6: Browser QA, Linux run and demo rehearsal (about 2 hours)

**Files:** Update `docs/camera-layout.md`; create `docs/demo-runbook.md`; update `README.md` only for verified launch instructions.

**Interfaces:** No runtime API. The camera note assigns waiting/crossing view and vehicle approach/count line to cameras on existing supports, including occlusion, night and one-camera-failure limits. It explains that the current simulation is a sensor substitute, not an installed camera system.

- [ ] **Step 1: Run `python -m pytest -q` and all four scenarios in Playwright CLI**: switch scenarios, verify normal/group/empty/failure phase and safety states, change a parameter and verify replay, inspect timeline, flow chart, comparison and recommendation. Capture screenshots and fix concrete UI discrepancies.
- [ ] **Step 2: Run the complete app in an available Linux environment**, record OS, command and successful scenario replay in `docs/demo-runbook.md`; do not mark complete without this. Do not infer embedded-PC performance.
- [ ] **Step 3: Finalize camera layout and rehearse the operator story**: request → traffic window → safe decision → phase → modeled comparison → recommendation; show camera-failure fallback. Record only observed results.
- [ ] **Step 4: Commit** verified docs and fixes as `docs: verify operator prototype demo`.

## Order, parallel work and cut line

Tasks 1 and 2 are the critical path to the first polished interactive browser prototype (about 9 hours). After Task 1 freezes the detection/report interfaces, a frontend subagent may own Task 2 (`templates/`, `static/`, `web.py`) while another owns Task 3 (`events.py`, `controller.py`, safety tests). Task 0 can run independently from the start. A third subagent can build Task 4's backend only (`baseline.py`, `evaluation.py`, `report.py`, tests) alongside Task 2; defer Task 4's `web.py`/template integration until the frontend work is merged and Task 3 safety behavior is verified. Task 5 follows the report shape; Task 6 follows the UI and engine. Keep file ownership separate and integrate in order. Total planned effort is about 20 hours, leaving roughly four hours within the 24-hour hackathon for integration and fixes.

**Completion boundary:** This plan delivers a complete interactive prototype of the non-CV system. It does not claim the original case's computer-vision requirement is complete. When the team's CV sample schema arrives, implement one `CVDetectionAdapter`, run the same scenario and safety tests against its output, then validate on real video as a separate integration task.
