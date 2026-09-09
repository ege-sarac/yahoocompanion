"""Convert raw nba_api results to YahooCompanion's Player JSON shape."""

from __future__ import annotations

import json
import math
import sys
import unicodedata
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = PROJECT_ROOT / "data" / "raw"
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
OUTPUT_PATH = PROCESSED_DIR / "players.json"
METADATA_OUTPUT_PATH = PROCESSED_DIR / "players.metadata.json"
VALIDATION_OUTPUT_PATH = PROCESSED_DIR / "players.validation.json"
REQUIRED_STAT_KEYS = [
    "PLAYER_ID",
    "PLAYER_NAME",
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
NON_NEGATIVE_FIELDS = [
    "gamesPlayed",
    "minutesPerGame",
    "points",
    "offensiveRebounds",
    "defensiveRebounds",
    "assists",
    "steals",
    "blocks",
    "turnovers",
]


def read_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError as error:
        raise FileNotFoundError(
            f"Required raw file is missing: {path}. Run fetch_nba_data.py first."
        ) from error
    except json.JSONDecodeError as error:
        raise ValueError(f"Malformed JSON in {path}: {error}") from error


def write_json(path: Path, value: Any) -> None:
    temporary_path = path.with_suffix(f"{path.suffix}.tmp")
    with temporary_path.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(
            value,
            handle,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
            allow_nan=False,
        )
        handle.write("\n")
    temporary_path.replace(path)


def require_list(value: Any, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{label} must be a non-empty JSON array.")
    if not all(isinstance(item, dict) for item in value):
        raise ValueError(f"{label} contains a malformed row.")
    return value


def finite_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be numeric.")
    numeric = float(value)
    if not math.isfinite(numeric):
        raise ValueError(f"{label} contains NaN or infinity.")
    if numeric < 0:
        raise ValueError(f"{label} cannot be negative.")
    return numeric


def optional_number(value: Any, label: str) -> float | None:
    if value is None or value == "":
        return None
    return finite_number(value, label)


def normalize_team(value: Any) -> str | None:
    if value is None:
        return None
    team = str(value).strip()
    return team or None


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


def validate_current_catalog(
    players: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    seen_ids: set[str] = set()
    names: dict[str, list[dict[str, str]]] = {}
    for row_number, player in enumerate(players, start=1):
        player_id = str(player.get("id", "")).strip()
        name = str(player.get("full_name", "")).strip()
        if not player_id or not name:
            raise ValueError(
                f"Current catalog row {row_number} has a missing ID or name."
            )
        if player_id in seen_ids:
            raise ValueError(f"Current catalog contains duplicate NBA ID {player_id}.")
        seen_ids.add(player_id)
        if player.get("age") not in (None, ""):
            optional_number(player["age"], f"current catalog {player_id} age")
        normalized = normalize_name(name)
        names.setdefault(normalized, []).append({"id": player_id, "name": name})

    return [matches for matches in names.values() if len(matches) > 1]


def validate_raw_season(rows: list[dict[str, Any]], season: str) -> None:
    seen_ids: set[str] = set()
    for row_number, row in enumerate(rows, start=1):
        missing = [key for key in REQUIRED_STAT_KEYS if key not in row]
        if missing:
            raise ValueError(
                f"{season} row {row_number} is missing: {', '.join(missing)}"
            )
        player_id = str(row["PLAYER_ID"])
        if player_id in seen_ids:
            raise ValueError(f"{season} contains duplicate NBA ID {player_id}.")
        seen_ids.add(player_id)
        if not str(row["PLAYER_NAME"]).strip():
            raise ValueError(f"{season} row {row_number} has a missing name.")
        for key in REQUIRED_STAT_KEYS[2:]:
            finite_number(row[key], f"{season} {player_id} {key}")


def historical_row(row: dict[str, Any], season: str) -> dict[str, Any]:
    return {
        "season": season,
        "gamesPlayed": int(finite_number(row["GP"], f"{season} GP")),
        "minutesPerGame": finite_number(row["MIN"], f"{season} MIN"),
        "points": finite_number(row["PTS"], f"{season} PTS"),
        "offensiveRebounds": finite_number(row["OREB"], f"{season} OREB"),
        "defensiveRebounds": finite_number(row["DREB"], f"{season} DREB"),
        "assists": finite_number(row["AST"], f"{season} AST"),
        "steals": finite_number(row["STL"], f"{season} STL"),
        "blocks": finite_number(row["BLK"], f"{season} BLK"),
        "turnovers": finite_number(row["TOV"], f"{season} TOV"),
    }


def validate_processed_players(players: list[dict[str, Any]]) -> None:
    if not players:
        raise ValueError("Processing produced an empty player dataset.")

    ids = [player.get("id") for player in players]
    if len(ids) != len(set(ids)):
        raise ValueError("Processed output contains duplicate NBA IDs.")

    for player in players:
        if not isinstance(player.get("id"), str) or not player["id"]:
            raise ValueError("A processed player has a malformed NBA ID.")
        if not isinstance(player.get("name"), str) or not player["name"].strip():
            raise ValueError(f"Player {player['id']} has a missing name.")
        if player.get("yahooPositions") != []:
            raise ValueError(
                f"Player {player['id']} has fabricated Yahoo eligibility."
            )
        if not isinstance(player.get("historicalStats"), list):
            raise ValueError(
                f"Player {player['id']} has malformed historicalStats."
            )
        for stat_line in player.get("historicalStats", []):
            for field in NON_NEGATIVE_FIELDS:
                finite_number(
                    stat_line.get(field), f"player {player['id']} field {field}"
                )


def build_processed_players(
    current_players: list[dict[str, Any]],
    season_rows: dict[str, dict[str, dict[str, Any]]],
    data_source: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Join history onto catalog membership without allowing stats to add/remove players."""
    duplicate_normalized_names = validate_current_catalog(current_players)
    catalog_by_id = {str(player["id"]): player for player in current_players}
    seasons = list(season_rows)
    historical_ids = {
        player_id for rows in season_rows.values() for player_id in rows
    }
    unmatched_historical_ids = sorted(
        historical_ids - set(catalog_by_id), key=int
    )

    processed_players: list[dict[str, Any]] = []
    for player_id, catalog_player in catalog_by_id.items():
        history: list[dict[str, Any]] = []
        latest_row: dict[str, Any] | None = None
        for season in seasons:
            row = season_rows[season].get(player_id)
            if row is not None:
                history.append(historical_row(row, season))
                latest_row = row

        catalog_age = optional_number(
            catalog_player.get("age"), f"player {player_id} catalog age"
        )
        historical_age = (
            optional_number(latest_row.get("AGE"), f"player {player_id} age")
            if latest_row
            else None
        )
        experience = str(catalog_player.get("experience") or "").strip() or None
        rookie_value = catalog_player.get("is_rookie")
        is_rookie = rookie_value if isinstance(rookie_value, bool) else None
        processed_players.append(
            {
                "id": player_id,
                "name": str(catalog_player["full_name"]).strip(),
                "nbaTeam": normalize_team(catalog_player.get("team_abbreviation")),
                "nbaPosition": normalize_team(catalog_player.get("position")),
                "nbaExperience": experience,
                "isRookie": is_rookie,
                "yahooPositions": [],
                "age": catalog_age if catalog_age is not None else historical_age,
                "injuryStatus": None,
                "expectedReturnDate": None,
                "historicalStats": history,
                "projections": None,
                "injuryRisk": None,
                "opportunityScore": None,
                "breakoutScore": None,
                "dataSource": data_source,
            }
        )

    processed_players.sort(key=lambda player: (player["name"].casefold(), player["id"]))
    validate_processed_players(processed_players)

    processed_ids = {player["id"] for player in processed_players}
    missing_catalog_ids = sorted(set(catalog_by_id) - processed_ids, key=int)
    if missing_catalog_ids:
        raise ValueError(
            "Current-catalog players are missing from processed output: "
            + ", ".join(missing_catalog_ids)
        )

    without_history = [
        {
            "id": player["id"],
            "name": player["name"],
            "nbaTeam": player["nbaTeam"],
            "age": player["age"],
        }
        for player in processed_players
        if not player["historicalStats"]
    ]
    missing_teams = [
        {"id": player["id"], "name": player["name"]}
        for player in processed_players
        if player["nbaTeam"] is None
    ]
    report = {
        "masterPlayerCount": len(current_players),
        "playersWithHistory": len(processed_players) - len(without_history),
        "playersWithoutHistory": len(without_history),
        "duplicateIds": [],
        "duplicateNormalizedNames": duplicate_normalized_names,
        "missingCatalogIds": missing_catalog_ids,
        "unmatchedHistoricalIds": unmatched_historical_ids,
        "missingTeams": missing_teams,
        "zeroHistoryPlayers": without_history,
    }
    return processed_players, report


def process() -> None:
    current_players = require_list(
        read_json(RAW_DIR / "current_players.json"), "current_players.json"
    )
    metadata = read_json(RAW_DIR / "metadata.json")
    if not isinstance(metadata, dict):
        raise ValueError("metadata.json must contain a JSON object.")

    seasons = metadata.get("seasonsIncluded")
    catalog_season = metadata.get("catalogSeason")
    catalog_sources = metadata.get("catalogSources")
    source = metadata.get("source")
    fetched_at = metadata.get("fetchedAt")
    if (
        not isinstance(seasons, list)
        or not seasons
        or not all(isinstance(season, str) for season in seasons)
        or not isinstance(source, str)
        or not isinstance(fetched_at, str)
        or not isinstance(catalog_season, str)
        or not isinstance(catalog_sources, list)
    ):
        raise ValueError("metadata.json is missing valid source metadata.")

    season_rows: dict[str, dict[str, dict[str, Any]]] = {}
    for season in seasons:
        rows = require_list(
            read_json(RAW_DIR / f"player_stats_{season}.json"),
            f"player_stats_{season}.json",
        )
        validate_raw_season(rows, season)
        season_rows[season] = {str(row["PLAYER_ID"]): row for row in rows}

    data_source = {
        "source": source,
        "fetchedAt": fetched_at,
        "seasonsIncluded": seasons,
        "catalogSeason": catalog_season,
        "catalogSources": catalog_sources,
    }
    processed_players, validation_report = build_processed_players(
        current_players, season_rows, data_source
    )

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    write_json(OUTPUT_PATH, processed_players)
    write_json(
        METADATA_OUTPUT_PATH,
        {
            **data_source,
            "playerCount": len(processed_players),
            "playersWithHistory": validation_report["playersWithHistory"],
            "playersWithoutHistory": validation_report["playersWithoutHistory"],
        },
    )
    write_json(VALIDATION_OUTPUT_PATH, validation_report)

    written_players = require_list(read_json(OUTPUT_PATH), "processed players.json")
    validate_processed_players(written_players)
    print(
        f"Wrote {len(processed_players)} validated players to {OUTPUT_PATH} "
        f"from seasons: {', '.join(seasons)}"
    )
    print(
        f"History: {validation_report['playersWithHistory']} with seasons, "
        f"{validation_report['playersWithoutHistory']} without seasons."
    )
    print(
        f"Diagnostics: {len(validation_report['unmatchedHistoricalIds'])} unmatched "
        f"historical IDs, {len(validation_report['missingTeams'])} missing teams, "
        f"{len(validation_report['duplicateNormalizedNames'])} duplicate normalized names."
    )


def main() -> int:
    try:
        process()
    except Exception as error:
        print(f"NBA data processing failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
