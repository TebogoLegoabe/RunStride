"""Admins upload a CSV of races in the browser."""
from tests.test_races import admin, verification_off  # noqa: F401 (fixtures)

HEADER = (
    "name,starts_on,ends_on,venue,city,province,official_url,"
    "substitution_opens_on,substitution_closes_on,substitution_url,events\n"
)
GOOD = (
    "Test Half,2099-03-01,,Town Hall,Cape Town,Western Cape,https://example.com,,,,"
    "Half marathon|21.1; 10 km|10\n"
    "Test Fun Run,2099-03-02,,Park,Durban,KwaZulu-Natal,,,,,5 km|5\n"
)


def upload(client, admin, text):
    return client.post(
        "/admin/races/import", files={"file": ("races.csv", text.encode(), "text/csv")}, headers=admin["headers"]
    )


def test_a_csv_adds_races_and_importing_again_updates_them(client, admin):
    first = upload(client, admin, HEADER + GOOD).json()
    assert first == {"imported": True, "added": 2, "updated": 0, "errors": []}

    again = upload(client, admin, HEADER + GOOD).json()
    assert again["imported"] is True and again["added"] == 0 and again["updated"] == 2

    names = [r["name"] for r in client.get("/races", headers=admin["headers"]).json()]
    assert "Test Half" in names and "Test Fun Run" in names


def test_one_bad_row_saves_nothing_and_says_which(client, admin):
    bad = GOOD + "Broken Race,not-a-date,,Venue,City,Gauteng,,,,,10 km|10\n"

    result = upload(client, admin, HEADER + bad).json()

    assert result["imported"] is False
    assert len(result["errors"]) == 1 and result["errors"][0].startswith("line 4")
    assert client.get("/races", headers=admin["headers"]).json() == []  # not even the good rows


def test_only_admins_can_import(client, make_runner):
    runner = make_runner()
    assert upload(client, runner, HEADER + GOOD).status_code == 403
