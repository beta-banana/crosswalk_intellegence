"""Local API and built frontend for the hackathon demonstration."""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .simulation import Config, SCENARIOS, simulate
from .video_episode import VIDEO_ID, VIDEO_PATH, simulate_video, video_scenario


app = FastAPI(title="Smart Crossing Demo API", version="1.0.0")


class SimulationRequest(BaseModel):
    scenario_id: str = "normal"
    config: Config = Field(default_factory=Config)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "source": "cv-json-and-simulation"}


@app.get("/api/scenarios")
def scenarios() -> list[dict]:
    return [video_scenario(), *SCENARIOS]


@app.post("/api/simulate")
def run_simulation(payload: SimulationRequest) -> dict:
    try:
        if payload.scenario_id == VIDEO_ID:
            return simulate_video(payload.config)
        return simulate(payload.scenario_id, payload.config)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.get("/api/video")
def video():
    if not VIDEO_PATH.is_file():
        raise HTTPException(status_code=404, detail="Video file is unavailable")
    return FileResponse(VIDEO_PATH, media_type="video/mp4")


FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@app.get("/{full_path:path}", include_in_schema=False)
def frontend(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Unknown API route")
    index = FRONTEND_DIST / "index.html"
    if not index.is_file():
        raise HTTPException(status_code=404, detail="Build the frontend first: npm run build --prefix frontend")
    target = (FRONTEND_DIST / full_path).resolve()
    if target.is_file() and FRONTEND_DIST in target.parents:
        return FileResponse(target)
    return FileResponse(index)
