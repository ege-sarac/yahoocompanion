"""Focused tests for catalog-first player processing."""

from __future__ import annotations

import unittest

from scripts.nba_data.process_nba_data import build_processed_players


def catalog_player(player_id: str, name: str, team: str = "TST") -> dict:
    return {
        "id": player_id,
        "full_name": name,
        "team_abbreviation": team,
        "position": "F",
        "age": 19,
        "experience": "R",
        "is_rookie": True,
    }


def stat_row(player_id: str, name: str) -> dict:
    return {
        "PLAYER_ID": int(player_id),
        "PLAYER_NAME": name,
        "TEAM_ABBREVIATION": "TST",
        "AGE": 25,
        "GP": 72,
        "MIN": 30,
        "PTS": 20,
        "OREB": 1,
        "DREB": 4,
        "AST": 5,
        "STL": 1,
        "BLK": 0.5,
        "TOV": 2,
    }


DATA_SOURCE = {
    "source": "test",
    "fetchedAt": "2026-09-09T00:00:00Z",
    "seasonsIncluded": ["2025-26"],
    "catalogSeason": "2026-27",
    "catalogSources": ["test"],
}


class CatalogFirstProcessingTests(unittest.TestCase):
    def test_zero_history_catalog_member_survives_without_fabricated_stats(self) -> None:
        players, report = build_processed_players(
            [catalog_player("1", "New Player")], {"2025-26": {}}, DATA_SOURCE
        )

        self.assertEqual([player["id"] for player in players], ["1"])
        self.assertEqual(players[0]["historicalStats"], [])
        self.assertIsNone(players[0]["projections"])
        self.assertEqual(report["playersWithoutHistory"], 1)

    def test_history_joins_by_stable_nba_id(self) -> None:
        players, report = build_processed_players(
            [catalog_player("2", "Established Player")],
            {"2025-26": {"2": stat_row("2", "Different Display Name")}},
            DATA_SOURCE,
        )

        self.assertEqual(players[0]["name"], "Established Player")
        self.assertEqual(players[0]["historicalStats"][0]["points"], 20)
        self.assertEqual(report["playersWithHistory"], 1)

    def test_historical_rows_do_not_create_master_members(self) -> None:
        players, report = build_processed_players(
            [catalog_player("1", "Current Player")],
            {"2025-26": {"99": stat_row("99", "Former Player")}},
            DATA_SOURCE,
        )

        self.assertEqual([player["id"] for player in players], ["1"])
        self.assertEqual(report["unmatchedHistoricalIds"], ["99"])

    def test_duplicate_catalog_ids_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "duplicate NBA ID"):
            build_processed_players(
                [
                    catalog_player("1", "First Name"),
                    catalog_player("1", "Second Name"),
                ],
                {"2025-26": {}},
                DATA_SOURCE,
            )


if __name__ == "__main__":
    unittest.main()
