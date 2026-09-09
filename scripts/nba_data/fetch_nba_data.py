"""Fetch the current NBA player catalog and historical stats via nba_api."""

from __future__ import annotations

import json
import sys
import time
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
from nba_api.stats.endpoints import (
    commonallplayers,
    commonteamroster,
    leaguedashplayerstats,
)
from nba_api.stats.static import teams as nba_teams


PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = PROJECT_ROOT / "data" / "raw"
SOURCE_NAME = "nba_api (NBA.com Stats)"
STAT_COLUMNS = [
    "GP",
    "MIN",
    "PTS",
    "OREB",
    "DREB",
    "AST",
    "STL",
    "BLK",
    "TOV",
]
REQUIRED_COLUMNS = [
    "PLAYER_ID",
    "PLAYER_NAME",
    "TEAM_ABBREVIATION",
    "AGE",
    *STAT_COLUMNS,
]
CATALOG_COLUMNS = [
    "PERSON_ID",
    "DISPLAY_FIRST_LAST",
    "ROSTERSTATUS",
    "FROM_YEAR",
    "TO_YEAR",
    "TEAM_ID",
    "TEAM_CITY",
    "TEAM_NAME",
    "TEAM_ABBREVIATION",
    "GAMES_PLAYED_FLAG",
    "OTHERLEAGUE_EXPERIENCE_CH",
]
ROSTER_COLUMNS = ["PLAYER_ID", "PLAYER", "POSITION", "AGE", "EXP"]


def completed_seasons(today: date | None = None, count: int = 3) -> list[str]:
    """Return season labels for the latest completed NBA seasons."""
    current_date = today or date.today()
    latest_end_year = (
        current_date.year if current_date.month >= 7 else current_date.year - 1
    )
    first_end_year = latest_end_year - count + 1
    return [
        f"{end_year - 1}-{str(end_year)[-2:]}"
        for end_year in range(first_end_year, latest_end_year + 1)
    ]


def current_season(today: date | None = None) -> str:
    """Return the NBA season containing the supplied date."""
    current_date = today or date.today()
    start_year = (
        current_date.year if current_date.month >= 7 else current_date.year - 1
    )
    return f"{start_year}-{str(start_year + 1)[-2:]}"


def write_json(path: Path, value: Any) -> None:
    """Replace a JSON file only after the complete payload is serialized."""
    temporary_path = path.with_suffix(f"{path.suffix}.tmp")
    with temporary_path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    temporary_path.replace(path)


def normalize_name(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value).casefold()
    without_accents = "".join(
        character
        for character in normalized
        if unicodedata.category(character) != "Mn"
    )
    safe_punctuation = "".join(
        " " if character in "-‐‑–—" else "" if character in ".'’" else character
        for character in without_accents
    )
    return " ".join(safe_punctuation.split())


def validate_current_players(records: list[dict[str, Any]]) -> None:
    if not records:
        raise ValueError("nba_api returned an empty current-player catalog.")

    ids = [record.get("id") for record in records]
    if any(player_id is None for player_id in ids):
        raise ValueError("A current player is missing an NBA ID.")
    if len(ids) != len(set(ids)):
        raise ValueError("The current-player catalog contains duplicate NBA IDs.")
    if any(not str(record.get("full_name", "")).strip() for record in records):
        raise ValueError("A current player is missing a full name.")

    names_by_normalized: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        key = normalize_name(str(record["full_name"]))
        names_by_normalized.setdefault(key, []).append(record)
    duplicate_names = [
        matches for matches in names_by_normalized.values() if len(matches) > 1
    ]
    for matches in duplicate_names:
        summary = ", ".join(
            f"{record['full_name']} ({record['id']})" for record in matches
        )
        print(f"Warning: duplicate normalized catalog name: {summary}")


def validate_frame_columns(
    frame: pd.DataFrame, required: list[str], label: str
) -> None:
    if frame.empty:
        raise ValueError(f"NBA Stats returned no rows for {label}.")
    missing = sorted(set(required) - set(frame.columns))
    if missing:
        raise ValueError(f"{label} is missing columns: {', '.join(missing)}")


def request_frame(label: str, factory: Any, attempts: int = 3) -> pd.DataFrame:
    """Request one official endpoint with a small bounded retry."""
    for attempt in range(1, attempts + 1):
        try:
            return factory().get_data_frames()[0]
        except Exception as error:
            if attempt == attempts:
                raise RuntimeError(
                    f"NBA Stats request failed for {label} after {attempts} attempts: {error}"
                ) from error
            print(f"Retrying {label} after request failure ({attempt}/{attempts}) ...")
            time.sleep(attempt * 2)
    raise AssertionError("unreachable")


def fetch_current_player_catalog(season: str) -> list[dict[str, Any]]:
    """Build membership from the live NBA directory plus official team rosters."""
    directory_frame = request_frame(
        f"CommonAllPlayers {season}",
        lambda: commonallplayers.CommonAllPlayers(
            is_only_current_season=1,
            season=season,
            timeout=60,
        ),
    )
    validate_frame_columns(directory_frame, CATALOG_COLUMNS, "CommonAllPlayers")
    directory_rows = json.loads(directory_frame.to_json(orient="records"))

    roster_by_id: dict[str, dict[str, Any]] = {}
    for team in sorted(nba_teams.get_teams(), key=lambda value: int(value["id"])):
        abbreviation = str(team["abbreviation"])
        print(f"Fetching current {abbreviation} roster for {season} ...")
        roster_frame = request_frame(
            f"{abbreviation} roster {season}",
            lambda team_id=team["id"]: commonteamroster.CommonTeamRoster(
                team_id=team_id,
                season=season,
                timeout=60,
            ),
        )
        validate_frame_columns(
            roster_frame, ROSTER_COLUMNS, f"{abbreviation} CommonTeamRoster"
        )
        for row in json.loads(roster_frame.to_json(orient="records")):
            player_id = str(row["PLAYER_ID"])
            if player_id in roster_by_id:
                raise ValueError(
                    f"Current team rosters contain duplicate NBA ID {player_id}."
                )
            roster_by_id[player_id] = {**row, "TEAM_ABBREVIATION": abbreviation}
        time.sleep(0.25)

    catalog_by_id: dict[str, dict[str, Any]] = {}
    for row in directory_rows:
        player_id = str(row["PERSON_ID"])
        roster = roster_by_id.get(player_id)
        experience = str(roster.get("EXP", "")).strip() if roster else ""
        catalog_by_id[player_id] = {
            "id": player_id,
            "full_name": str(row["DISPLAY_FIRST_LAST"]).strip(),
            "team_id": int(row["TEAM_ID"]) if row.get("TEAM_ID") else None,
            "team_abbreviation": str(row.get("TEAM_ABBREVIATION") or "").strip()
            or None,
            "team_city": str(row.get("TEAM_CITY") or "").strip() or None,
            "team_name": str(row.get("TEAM_NAME") or "").strip() or None,
            "position": str(roster.get("POSITION") or "").strip() or None
            if roster
            else None,
            "age": roster.get("AGE") if roster else None,
            "experience": experience or None,
            "is_rookie": experience == "R" if experience else None,
            "from_year": str(row.get("FROM_YEAR") or "").strip() or None,
            "to_year": str(row.get("TO_YEAR") or "").strip() or None,
            "games_played_flag": str(row.get("GAMES_PLAYED_FLAG") or "").strip()
            or None,
            "other_league_experience": str(
                row.get("OTHERLEAGUE_EXPERIENCE_CH") or ""
            ).strip()
            or None,
            "catalog_source": "CommonAllPlayers",
        }

    # Team rosters are also authoritative membership. Union any roster record that
    # has not yet propagated to the league directory rather than silently dropping it.
    for player_id, row in roster_by_id.items():
        if player_id in catalog_by_id:
            continue
        experience = str(row.get("EXP") or "").strip()
        catalog_by_id[player_id] = {
            "id": player_id,
            "full_name": str(row["PLAYER"]).strip(),
            "team_id": int(row["TeamID"]),
            "team_abbreviation": row["TEAM_ABBREVIATION"],
            "team_city": None,
            "team_name": None,
            "position": str(row.get("POSITION") or "").strip() or None,
            "age": row.get("AGE"),
            "experience": experience or None,
            "is_rookie": experience == "R" if experience else None,
            "from_year": None,
            "to_year": None,
            "games_played_flag": None,
            "other_league_experience": None,
            "catalog_source": "CommonTeamRoster",
        }

    catalog = sorted(catalog_by_id.values(), key=lambda row: int(row["id"]))
    validate_current_players(catalog)
    return catalog


def validate_season_frame(frame: pd.DataFrame, season: str) -> None:
    if frame.empty:
        raise ValueError(f"NBA stats returned no rows for season {season}.")

    missing_columns = sorted(set(REQUIRED_COLUMNS) - set(frame.columns))
    if missing_columns:
        raise ValueError(
            f"Season {season} is missing required columns: {', '.join(missing_columns)}"
        )
    if frame["PLAYER_ID"].duplicated().any():
        raise ValueError(f"Season {season} contains duplicate NBA player IDs.")
    if frame["PLAYER_NAME"].isna().any() or (
        frame["PLAYER_NAME"].astype(str).str.strip() == ""
    ).any():
        raise ValueError(f"Season {season} contains missing player names.")

    numeric = frame[STAT_COLUMNS].apply(pd.to_numeric, errors="coerce")
    if numeric.isna().any().any():
        bad_columns = numeric.columns[numeric.isna().any()].tolist()
        raise ValueError(
            f"Season {season} contains NaN/non-numeric stats in: "
            f"{', '.join(bad_columns)}"
        )
    if (numeric < 0).any().any():
        bad_columns = numeric.columns[(numeric < 0).any()].tolist()
        raise ValueError(
            f"Season {season} contains negative stats in: {', '.join(bad_columns)}"
        )


def fetch() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    seasons = completed_seasons()
    catalog_season = current_season()
    fetched_at = datetime.now(timezone.utc).isoformat()

    print(f"Fetching official current-player catalog for {catalog_season} ...")
    current_records = fetch_current_player_catalog(catalog_season)
    write_json(RAW_DIR / "current_players.json", current_records)
    print(f"Fetched {len(current_records)} current NBA players.")

    for season in seasons:
        print(f"Fetching NBA player per-game stats for {season} ...")
        try:
            response = leaguedashplayerstats.LeagueDashPlayerStats(
                season=season,
                per_mode_detailed="PerGame",
                timeout=60,
            )
            frame = response.get_data_frames()[0]
        except Exception as error:
            raise RuntimeError(
                f"NBA stats request failed for season {season}: {error}"
            ) from error

        validate_season_frame(frame, season)
        records = json.loads(frame.to_json(orient="records"))
        write_json(RAW_DIR / f"player_stats_{season}.json", records)
        print(f"Stored {len(records)} rows for {season}.")

    write_json(
        RAW_DIR / "metadata.json",
        {
            "source": SOURCE_NAME,
            "fetchedAt": fetched_at,
            "seasonsIncluded": seasons,
            "catalogSeason": catalog_season,
            "catalogSources": ["CommonAllPlayers", "CommonTeamRoster"],
        },
    )
    print(f"Raw NBA data written to {RAW_DIR}")


def main() -> int:
    try:
        fetch()
    except Exception as error:
        print(f"NBA data fetch failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
