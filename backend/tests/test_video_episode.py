import json

from fastapi.testclient import TestClient

from app import video_episode
from app.main import app


def test_video_episode_uses_json_observations_and_summary():
    observations = json.loads(video_episode.JSON_PATH.read_text(encoding="utf-8"))["seconds"]
    client = TestClient(app)

    scenarios = client.get("/api/scenarios").json()
    assert scenarios[0]["id"] == "video"
    assert scenarios[0]["kind"] == "video"
    assert scenarios[0]["period"] == "День"
    assert scenarios[0]["video_url"] == "/api/videos/video"
    assert scenarios[0]["duration"] == len(observations) == 162
    assert [(item["id"], item["period"], item["duration"]) for item in scenarios[:3]] == [
        ("video", "День", 162),
        ("morning", "Утро", 101),
        ("night", "Ночь", 95),
    ]

    response = client.post("/api/simulate", json={"scenario_id": "video"})
    assert response.status_code == 200
    report = response.json()
    assert len(report["frames"]) == len(observations)
    for second in (0, 18, 80, 100, 120, 150, 161):
        frame, observed = report["frames"][second], observations[second]
        assert frame["time"] == second
        assert frame["vehicles"] == observed["vehicles"]
        assert frame["pedestrians"] == observed["waiting"]
        assert frame["on_road"] == observed["on_road"]
        assert frame["healthy"] == observed["camera_ok"]
    assert report["summary"]["vehicles"] == sum(row["new_vehicles"] for row in observations)
    assert report["summary"]["pedestrians"] == sum(row["new_pedestrians"] for row in observations)
    assert report["summary"]["safety_violations"] == 0
    assert report["summary"]["max_wait"] <= 20
    assert 0 < report["summary"]["vehicle_green_share"] < 100
    assert report["modeled_wait_difference"] is None
    assert report["summary"]["vehicle_green_seconds"] + report["summary"]["vehicle_closed_seconds"] == len(observations)


def test_persistent_queue_rearms_request_and_covers_long_crossing_block():
    report = TestClient(app).post("/api/simulate", json={"scenario_id": "video"}).json()
    frames = report["frames"]

    assert any(event["text"] == "Очередь сохраняется после пешеходной фазы"
               for event in report["events"])
    assert all(frame["on_road"] > 0 for frame in frames[90:138])
    assert all(frame["phase"] == "pedestrian_green" for frame in frames[90:138])


def test_recording_phase_overlay_ignores_short_cv_bursts_and_matches_crossing():
    report = TestClient(app).post("/api/simulate", json={"scenario_id": "video"}).json()
    frames = report["frames"]

    assert all(frame["display_phase"] != "pedestrian_green" for frame in frames[:80])
    assert all(frame["display_phase"] == "warning" for frame in frames[80:83])
    assert all(frame["display_phase"] == "all_red_to_ped" for frame in frames[83:85])
    assert all(frame["display_phase"] == "pedestrian_green" for frame in frames[85:138])
    assert all(frame["display_phase"] == "all_red_to_vehicle" for frame in frames[138:140])
    assert frames[140]["display_phase"] == "vehicle_green"
    assert [event["time"] for event in report["display_events"]] == [80, 83, 85, 138, 140]


def test_video_endpoint_supports_browser_range_requests():
    client = TestClient(app)
    for episode_id in ("video", "morning", "night"):
        response = client.get(f"/api/videos/{episode_id}", headers={"Range": "bytes=0-1023"})
        assert response.status_code == 206
        assert response.headers["content-type"].startswith("video/mp4")
        assert response.headers["content-range"].startswith("bytes 0-1023/")
        assert len(response.content) == 1024
    assert client.get("/api/videos/missing").status_code == 404
    assert client.get("/api/video", headers={"Range": "bytes=0-15"}).status_code == 206


def test_second_preprocessed_episode_appears_without_frontend_changes(monkeypatch):
    evening = video_episode.VideoEpisode(
        id="evening",
        name="Переход · вечерняя запись",
        description="Проверка каталога нескольких записей",
        json_filename="result_crosswalk.json",
        video_filename="result_crosswalk_web.mp4",
        period="Вечер",
    )
    episodes = (*video_episode.VIDEO_EPISODES, evening)
    monkeypatch.setattr(video_episode, "VIDEO_EPISODES", episodes)
    monkeypatch.setattr(
        video_episode,
        "VIDEO_EPISODES_BY_ID",
        {episode.id: episode for episode in episodes},
    )

    client = TestClient(app)
    scenarios = client.get("/api/scenarios").json()
    assert any(item["id"] == "evening" and item["video_url"] == "/api/videos/evening"
               for item in scenarios)
    assert client.post("/api/simulate", json={"scenario_id": "evening"}).status_code == 200
    assert client.get("/api/videos/evening", headers={"Range": "bytes=0-15"}).status_code == 206
