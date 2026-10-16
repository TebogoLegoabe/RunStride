"""Running clubs: saved on the profile, matched across spellings, flagged on Discover."""
from app.clubs import club_key, shared_clubs
from tests.test_discover import feed  # noqa: F401

RUNNING = {"paceSecondsPerKm": 330, "weeklyKm": 40, "terrains": ["road"], "goals": ["10k"], "runTimes": ["morning"]}


def test_the_same_club_is_recognised_however_it_is_written():
    assert club_key("Hout Bay Harriers") == club_key("hout bay harriers AC")
    assert club_key("Vitality") == club_key("Vitality Run Club")
    assert club_key("Nike Run Club") == club_key("nike running")
    assert club_key("parkrun") != club_key("Nike Run Club")
    assert shared_clubs(["Hout Bay Harriers AC"], ["parkrun", "Hout Bay Harriers"]) == ["Hout Bay Harriers"]


def test_clubs_are_saved_tidied_and_limited(client, make_runner):
    runner = make_runner()
    res = client.put(
        "/me/running-profile",
        json={**RUNNING, "clubs": ["  Hout   Bay  Harriers ", "hout bay harriers", "parkrun"]},
        headers=runner["headers"],
    )
    assert res.status_code == 200 and res.json()["clubs"] == ["Hout Bay Harriers", "parkrun"]
    too_many = client.put("/me/running-profile", json={**RUNNING, "clubs": ["A1", "B2", "C3", "D4"]}, headers=runner["headers"])
    assert too_many.status_code == 422
    link = client.put("/me/running-profile", json={**RUNNING, "clubs": ["see https://example.com"]}, headers=runner["headers"])
    assert link.status_code == 422


def test_discover_says_when_you_share_a_club(client, make_runner):
    thandi = make_runner()
    sipho = make_runner(gender="man", interested_in=["woman"], km_north=3)
    base = {**RUNNING}
    before = feed(client, thandi)[0]["compatibility"]
    client.put("/me/running-profile", json={**base, "clubs": ["Hout Bay Harriers"]}, headers=thandi["headers"]).raise_for_status()
    client.put("/me/running-profile", json={**base, "clubs": ["Hout Bay Harriers AC", "parkrun"]}, headers=sipho["headers"]).raise_for_status()

    card = feed(client, thandi)[0]

    assert card["clubs"] == ["Hout Bay Harriers AC", "parkrun"]
    assert card["sharedClubs"] == ["Hout Bay Harriers AC"]
    assert card["compatibility"] >= before  # a shared club never lowers the match


def test_club_suggestions_include_popular_and_well_known_ones(client, make_runner):
    a, b = make_runner(), make_runner(gender="man", interested_in=["woman"])
    for runner in (a, b):
        client.put("/me/running-profile", json={**RUNNING, "clubs": ["Hout Bay Harriers"]}, headers=runner["headers"])

    names = client.get("/me/clubs/suggest", headers=a["headers"]).json()
    assert names[0] == "Hout Bay Harriers" and "parkrun" in names
    assert client.get("/me/clubs/suggest", params={"q": "hout"}, headers=a["headers"]).json() == ["Hout Bay Harriers"]
