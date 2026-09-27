from fastapi.testclient import TestClient

from app.main import app
from app.simulation import Config, PhasePlan, SCENARIOS, simulate
from app.video_episode import video_scenarios


def test_scenarios_are_deterministic_and_keep_protective_phases():
    for scenario in SCENARIOS:
        first = simulate(scenario["id"], Config())
        second = simulate(scenario["id"], Config())
        assert first["frames"] == second["frames"]
        assert first["summary"]["safety_violations"] == 0
        assert first["summary"]["served_requests"] >= 1


def test_pedestrian_request_survives_the_end_of_its_observation_window():
    result = simulate("rush", Config(low_flow_threshold=0, max_single_wait=90))
    assert result["frames"][60]["waiting_seconds"] == 52
    assert result["frames"][61]["waiting_seconds"] == 53
    assert result["summary"]["served_requests"] == 1
    assert result["summary"]["unserved_requests"] == 0
    assert result["summary"]["first_pedestrian_green"] == 98
    assert result["summary"]["mean_wait"] == 90


def test_empty_road_and_large_group_receive_early_green():
    empty = simulate("empty", Config())
    group = simulate("group", Config())
    assert empty["summary"]["first_pedestrian_green"] == 15
    assert group["summary"]["first_pedestrian_green"] == 21
    assert any("Приоритет группы" in event["text"] for event in group["events"])
    assert empty["summary"]["mean_wait"] < empty["baseline"]["mean_wait"]


def test_camera_outage_hides_observations_and_uses_fallback_cycle():
    frames = simulate("failure", Config())["frames"]
    assert all(frame["mode"] == "fallback" and frame["vehicles"] is None
               and frame["pedestrians"] is None and not frame["clear_gap"]
               for frame in frames[30:75])
    assert frames[75]["mode"] == "adaptive"
    assert any(frame["phase"] == "pedestrian_green" for frame in frames[69:75])


def test_api_catalog_simulation_and_validation():
    client = TestClient(app)
    assert len(client.get("/api/scenarios").json()) == len(SCENARIOS) + len(video_scenarios())
    assert client.post("/api/simulate", json={"scenario_id": "group"}).json()["scenario_id"] == "group"
    assert client.post("/api/simulate", json={"scenario_id": "missing"}).status_code == 404
    assert client.post("/api/simulate", json={"config": {"pedestrian_green": 3}}).status_code == 422


def test_manual_phase_plan_changes_timeline_and_preserves_safety():
    plan = PhasePlan(vehicle_green=10, warning=4, all_red_to_ped=3,
                     pedestrian_green=8, all_red_to_vehicle=4)
    result = simulate("normal", Config(control_mode="manual", phase_plan=plan))
    frames = result["frames"]
    assert frames[10]["phase"] == "warning"
    assert frames[14]["phase"] == "all_red_to_ped"
    assert frames[17]["phase"] == "pedestrian_green"
    assert frames[25]["phase"] == "all_red_to_vehicle"
    assert frames[29]["phase"] == "vehicle_green"
    assert frames[10]["mode"] == "manual"
    assert result["summary"]["safety_violations"] == 0


def test_traffic_statistics_reflect_mock_observations():
    empty = simulate("empty", Config())["summary"]
    rush = simulate("rush", Config())["summary"]
    assert empty["mean_flow_per_min"] == 0
    assert empty["mean_vehicles_in_zone"] == 0
    assert rush["mean_flow_per_min"] > empty["mean_flow_per_min"]
    assert rush["peak_vehicles_in_zone"] >= rush["mean_vehicles_in_zone"]


def test_default_policy_improves_waiting_and_reports_vehicle_availability():
    for scenario in SCENARIOS:
        report = simulate(scenario["id"], Config())
        summary = report["summary"]
        assert report["modeled_wait_difference"] is not None
        assert report["modeled_wait_difference"] > 0
        assert summary["max_wait"] <= 20
        assert summary["vehicle_green_seconds"] + summary["vehicle_closed_seconds"] == len(report["frames"])
        assert 0 < summary["vehicle_green_share"] <= 100
