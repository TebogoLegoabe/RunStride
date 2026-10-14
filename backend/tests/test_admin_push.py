"""Admins get a push when something needs their review."""
from sqlalchemy import text

from tests.test_notifications import phone, pushes  # noqa: F401 (fixtures)
from tests.test_races import admin, day, verification_off  # noqa: F401 (fixtures)


def suggest(client, runner):
    return client.post(
        "/races/suggestions",
        json={"name": "Two Oceans", "startsOn": day(30), "venue": "UCT", "city": "Cape Town",
              "events": [{"label": "Ultra", "distanceKm": 56}]},
        headers=runner["headers"],
    )


def test_admins_are_told_about_a_suggested_race(client, admin, make_runner, pushes):
    phone(client, admin)
    runner = make_runner(gender="man", interested_in=["woman"])

    assert suggest(client, runner).status_code == 201

    assert [(p.title, p.url) for p in pushes.sent] == [("New race suggested", "/moderation?view=races")]
    assert "Two Oceans" in pushes.sent[0].body


def test_an_admin_is_not_told_about_their_own_suggestion(client, admin, pushes):
    phone(client, admin)
    assert suggest(client, admin).status_code == 201
    assert pushes.sent == []


def test_non_admins_get_nothing(client, admin, make_runner, pushes):
    runner = make_runner(gender="man", interested_in=["woman"])
    phone(client, runner)
    other = make_runner()
    suggest(client, other)
    assert pushes.sent == []


def test_admins_can_turn_all_push_off(client, admin, make_runner, pushes):
    phone(client, admin)
    client.put(
        "/me/notification-settings",
        json={"enabled": False, "messages": True, "matches": True, "races": True, "swaps": True},
        headers=admin["headers"],
    )
    suggest(client, make_runner(gender="man", interested_in=["woman"]))
    assert pushes.sent == []
