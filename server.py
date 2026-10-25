from __future__ import annotations

import html
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import parse_qs

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATABASE_PATH = DATA_DIR / "knee_demo.db"

EXERCISES = {
    "heelSlide": "Heel Slide",
    "kneeExtension": "Knee Extension",
    "sitToStand": "Sit-to-Stand",
    "squat": "Squat",
}


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS exercise_samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp_ms INTEGER NOT NULL,
                sequence INTEGER NOT NULL,
                exercise_key TEXT NOT NULL,
                exercise_name TEXT NOT NULL,
                exercise_status TEXT NOT NULL,
                calibrated INTEGER NOT NULL CHECK (calibrated IN (0, 1)),
                thigh_angle REAL NOT NULL,
                shank_angle REAL NOT NULL,
                knee_angle REAL NOT NULL,
                repetitions INTEGER NOT NULL CHECK (repetitions >= 0),
                stored_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_samples_exercise_time "
            "ON exercise_samples(exercise_key, timestamp_ms)"
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="Knee Rehabilitation Digital Twin Demo", lifespan=lifespan)


async def read_form(request: Request) -> dict[str, str]:
    content_type = request.headers.get("content-type", "")
    if "application/x-www-form-urlencoded" not in content_type:
        raise HTTPException(status_code=415, detail="Form-encoded data required")
    parsed = parse_qs((await request.body()).decode("utf-8"), keep_blank_values=True)
    return {key: values[-1] for key, values in parsed.items()}


def required(data: dict[str, str], key: str) -> str:
    value = data.get(key)
    if value is None or value == "":
        raise HTTPException(status_code=422, detail=f"Missing field: {key}")
    return value


def parse_integer(data: dict[str, str], key: str, minimum: int = 0) -> int:
    try:
        value = int(required(data, key))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=f"Invalid integer: {key}") from error
    if value < minimum:
        raise HTTPException(status_code=422, detail=f"{key} must be at least {minimum}")
    return value


def parse_angle(data: dict[str, str], key: str) -> float:
    try:
        value = float(required(data, key))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=f"Invalid angle: {key}") from error
    if not -180.0 <= value <= 360.0:
        raise HTTPException(status_code=422, detail=f"{key} is outside the accepted range")
    return value


def storage_fragment(exercise_key: str | None = None) -> str:
    with connect() as connection:
        total = connection.execute("SELECT COUNT(*) FROM exercise_samples").fetchone()[0]
        if exercise_key in EXERCISES:
            exercise_count = connection.execute(
                "SELECT COUNT(*) FROM exercise_samples WHERE exercise_key = ?",
                (exercise_key,),
            ).fetchone()[0]
            last = connection.execute(
                "SELECT knee_angle, repetitions, stored_at FROM exercise_samples "
                "WHERE exercise_key = ? ORDER BY id DESC LIMIT 1",
                (exercise_key,),
            ).fetchone()
            label = EXERCISES[exercise_key]
        else:
            exercise_count = total
            last = connection.execute(
                "SELECT knee_angle, repetitions, stored_at FROM exercise_samples "
                "ORDER BY id DESC LIMIT 1"
            ).fetchone()
            label = "All exercises"

    last_angle = f"{last['knee_angle']:.1f}°" if last else "—"
    repetitions = str(last["repetitions"]) if last else "0"
    stored_at = html.escape(last["stored_at"] if last else "No samples stored")
    safe_label = html.escape(label)
    return f"""
    <div class="storage-grid">
      <div class="storage-item"><span>Total samples</span><strong>{total}</strong></div>
      <div class="storage-item"><span>{safe_label}</span><strong>{exercise_count}</strong></div>
      <div class="storage-item"><span>Last angle</span><strong>{last_angle}</strong></div>
      <div class="storage-item"><span>Stored repetitions</span><strong>{repetitions}</strong></div>
    </div>
    <p class="storage-meta">SQLite · demo/data/knee_demo.db · {stored_at}</p>
    """


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "database": str(DATABASE_PATH)}


@app.post("/api/samples", response_class=HTMLResponse)
async def create_sample(request: Request) -> HTMLResponse:
    data = await read_form(request)
    exercise_key = required(data, "exercise_key")
    if exercise_key not in EXERCISES:
        raise HTTPException(status_code=422, detail="Unknown exercise")

    sample = {
        "timestamp_ms": parse_integer(data, "timestamp_ms", 1),
        "sequence": parse_integer(data, "sequence"),
        "exercise_key": exercise_key,
        "exercise_name": EXERCISES[exercise_key],
        "exercise_status": required(data, "exercise_status")[:40],
        "calibrated": 1 if required(data, "calibrated").lower() == "true" else 0,
        "thigh_angle": parse_angle(data, "thigh_angle"),
        "shank_angle": parse_angle(data, "shank_angle"),
        "knee_angle": parse_angle(data, "knee_angle"),
        "repetitions": parse_integer(data, "repetitions"),
    }
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO exercise_samples (
                timestamp_ms, sequence, exercise_key, exercise_name,
                exercise_status, calibrated, thigh_angle, shank_angle,
                knee_angle, repetitions
            ) VALUES (
                :timestamp_ms, :sequence, :exercise_key, :exercise_name,
                :exercise_status, :calibrated, :thigh_angle, :shank_angle,
                :knee_angle, :repetitions
            )
            """,
            sample,
        )
    return HTMLResponse(storage_fragment(exercise_key))


@app.get("/api/samples")
def list_samples(
    exercise: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
) -> JSONResponse:
    if exercise is not None and exercise not in EXERCISES:
        raise HTTPException(status_code=422, detail="Unknown exercise")
    query = "SELECT * FROM exercise_samples"
    parameters: list[object] = []
    if exercise:
        query += " WHERE exercise_key = ?"
        parameters.append(exercise)
    query += " ORDER BY id DESC LIMIT ?"
    parameters.append(limit)
    with connect() as connection:
        rows = [dict(row) for row in connection.execute(query, parameters).fetchall()]
    return JSONResponse(rows)


@app.get("/fragments/storage-status", response_class=HTMLResponse)
def get_storage_status(exercise: str | None = None) -> HTMLResponse:
    return HTMLResponse(storage_fragment(exercise))


@app.delete("/api/samples", response_class=HTMLResponse)
def clear_samples() -> HTMLResponse:
    with connect() as connection:
        connection.execute("DELETE FROM exercise_samples")
    return HTMLResponse(storage_fragment())


app.mount("/", StaticFiles(directory=BASE_DIR, html=True), name="demo")
