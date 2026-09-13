"""Fetch optional official NBA advanced, tracking, and game-log role data.

The collector is intentionally explicit and cache-first. It never manufactures a
missing field: every stored payload contains the columns actually returned by
the installed nba_api endpoint.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import pandas as pd
import nba_api
from nba_api.stats.endpoints import leaguedashplayerstats, leaguedashptstats, playergamelogs

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = PROJECT_ROOT / "data" / "raw"
SEASONS = ["2023-24", "2024-25", "2025-26"]
LATEST_SEASON = SEASONS[-1]
TRACKING_MEASURES = ["Possessions", "Passing", "Rebounding"]


def write_json(path: Path, value: Any) -> None:
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False)
        handle.write("\n")
    temporary.replace(path)


def fetch_frame(label: str, factory: Callable[[], Any], attempts: int = 3) -> pd.DataFrame:
    for attempt in range(1, attempts + 1):
        try:
            frame = factory().get_data_frames()[0]
            if frame.empty:
                raise ValueError("endpoint returned zero rows")
            return frame
        except Exception as error:
            if attempt == attempts:
                raise RuntimeError(f"{label} failed after {attempts} attempts: {error}") from error
            print(f"Retrying {label} ({attempt}/{attempts}) ...")
            time.sleep(attempt * 2)
    raise AssertionError("unreachable")


def store(path: Path, season: str, category: str, frame: pd.DataFrame) -> None:
    rows = json.loads(frame.to_json(orient="records"))
    write_json(path, {
        "season": season,
        "category": category,
        "source": "nba_api (NBA.com Stats)",
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "columns": list(frame.columns),
        "rows": rows,
    })
    print(f"Stored {len(rows)} rows and {len(frame.columns)} returned columns in {path.name}.")


def collect(path: Path, season: str, category: str, factory: Callable[[], Any], force: bool) -> dict[str, Any]:
    if path.exists() and not force:
        print(f"Using cached {path.name} (pass --force to refresh).")
        return {"file": path.name, "status": "cached"}
    frame = fetch_frame(f"{category} {season}", factory)
    store(path, season, category, frame)
    time.sleep(0.35)
    return {"file": path.name, "status": "fetched", "rows": len(frame)}


def fetch(force: bool) -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []
    failures: list[str] = []

    for season in SEASONS:
        path = RAW_DIR / f"role_advanced_{season}.json"
        try:
            results.append(collect(path, season, "NBA Advanced", lambda season=season: leaguedashplayerstats.LeagueDashPlayerStats(season=season, per_mode_detailed="PerGame", measure_type_detailed_defense="Advanced", timeout=60), force))
        except Exception as error:
            failures.append(str(error)); print(f"Warning: {error}", file=sys.stderr)

    for measure in TRACKING_MEASURES:
        path = RAW_DIR / f"role_tracking_{measure.lower()}_{LATEST_SEASON}.json"
        try:
            results.append(collect(path, LATEST_SEASON, f"NBA Tracking {measure}", lambda measure=measure: leaguedashptstats.LeagueDashPtStats(season=LATEST_SEASON, player_or_team="Player", per_mode_simple="PerGame", pt_measure_type=measure, timeout=60), force))
        except Exception as error:
            failures.append(str(error)); print(f"Warning: {error}", file=sys.stderr)

    for season in ["2024-25", LATEST_SEASON]:
        for measure in ["Base", "Advanced"]:
            path = RAW_DIR / f"role_game_logs_{measure.lower()}_{season}.json"
            try:
                results.append(collect(path, season, f"NBA Game Logs {measure}", lambda measure=measure, season=season: playergamelogs.PlayerGameLogs(season_nullable=season, season_type_nullable="Regular Season", measure_type_player_game_logs_nullable=measure, timeout=60), force))
            except Exception as error:
                failures.append(str(error)); print(f"Warning: {error}", file=sys.stderr)

    write_json(RAW_DIR / "role_fetch_metadata.json", {
        "nbaApiVersionInspected": nba_api.__version__,
        "requestedAt": datetime.now(timezone.utc).isoformat(),
        "seasons": SEASONS,
        "results": results,
        "failures": failures,
    })
    if failures:
        print(f"Role fetch completed with {len(failures)} optional source failure(s). Existing cache and box-score fallbacks remain usable.")
    else:
        print("Role fetch completed successfully.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="Replace existing cached role responses.")
    args = parser.parse_args()
    try:
        fetch(args.force)
    except Exception as error:
        print(f"Role data fetch failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
