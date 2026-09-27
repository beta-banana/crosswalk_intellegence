import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


ROOT = Path(__file__).resolve().parents[2]


def test_video_episode_uses_json_observations_and_summary():
    observations = json.loads((ROOT / "result_crosswalk.json").read_text(encoding="utf-8"))["seconds"]
    client = TestClient(app)

    scenarios = client.get("/api/scenarios").json()
    assert scenarios[0]["id"] == "video"
    assert scenarios[0]["duration"] == len(observations) == 194

    response = client.post("/api/simulate", json={"scenario_id": "video"})
    assert response.status_code == 200
    report = response.json()
    assert len(report["frames"]) == len(observations)
    for second in (0, 18, 100, 120, 150, 180, 193):
        frame, observed = report["frames"][second], observations[second]
        assert frame["time"] == second
        assert frame["vehicles"] == observed["vehicles"]
        assert frame["pedestrians"] == observed["waiting"]
        assert frame["on_road"] == observed["on_road"]
        assert frame["healthy"] == observed["camera_ok"]
    assert report["summary"]["vehicles"] == sum(row["new_vehicles"] for row in observations)
    assert report["summary"]["pedestrians"] == sum(row["new_pedestrians"] for row in observations)
    assert report["summary"]["safety_violations"] == 0


def test_video_endpoint_supports_browser_range_requests():
    client = TestClient(app)
    response = client.get("/api/video", headers={"Range": "bytes=0-1023"})
    assert response.status_code == 206
    assert response.headers["content-type"].startswith("video/mp4")
    assert response.headers["content-range"].startswith("bytes 0-1023/")
    assert len(response.content) == 1024
