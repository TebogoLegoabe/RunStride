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


def report(client, reporter, reported, reason):
    return client.post(
        "/reports",
        json={"reportedUserId": reported["id"], "reason": reason, "details": "test"},
        headers=reporter["headers"],
    )


def test_admins_are_told_about_reports(client, admin, make_runner, pushes):
    phone(client, admin)
    a, b = make_runner(gender="man", interested_in=["woman"]), make_runner()
    assert report(client, a, b, "harassment").status_code == 201
    assert [(p.title, p.url) for p in pushes.sent] == [("New report", "/moderation?view=open")]


def test_an_under_18_report_is_urgent(client, admin, make_runner, pushes):
    phone(client, admin)
    a, b = make_runner(gender="man", interested_in=["woman"]), make_runner()
    assert report(client, a, b, "underage").status_code == 201
    assert pushes.sent[0].title == "Urgent: possible under-18"


def test_admin_can_remind_people_to_activate_free_plus(client, admin, make_runner, pushes):
    waiting = make_runner(gender="man", interested_in=["woman"])
    claimed = make_runner()
    phone(client, waiting, "ExponentPushToken[waiting00]")
    phone(client, claimed, "ExponentPushToken[claimed00]")
    client.post("/billing/activate-beta", headers=claimed["headers"]).raise_for_status()

    stats = client.get("/admin/stats", headers=admin["headers"]).json()
    res = client.post("/admin/beta-plus/remind", headers=admin["headers"])

    assert res.status_code == 200 and res.json()["sent"] == stats["betaPlusUnclaimed"] - 1  # minus the admin
    tokens = {p.token for p in pushes.sent if p.url == "/plus"}
    assert tokens == {"ExponentPushToken[waiting00]"}
    assert "free" in pushes.sent[0].title.lower()


def test_only_admins_can_send_reminders(client, make_runner):
    runner = make_runner()
    assert client.post("/admin/beta-plus/remind", headers=runner["headers"]).status_code == 403


def test_admin_can_remind_people_who_cant_be_seen_yet(client, admin, make_runner, sms, pushes):
    from tests.conftest import sign_in

    ready = make_runner(gender="man", interested_in=["woman"])
    halfway = {"headers": {"Authorization": f"Bearer {sign_in(client, sms, phone='082 555 9999')['token']}"}}
    phone(client, ready, "ExponentPushToken[ready0000]")
    phone(client, halfway, "ExponentPushToken[halfway00]")

    stats = client.get("/admin/stats", headers=admin["headers"]).json()
    res = client.post("/admin/finish-signup/remind", headers=admin["headers"])

    assert stats["hiddenFromDiscover"] == 1
    assert res.status_code == 200 and res.json()["sent"] == 1
    assert {p.token for p in pushes.sent} == {"ExponentPushToken[halfway00]"}
    assert pushes.sent[0].url == "/"


def test_only_admins_can_remind_people_to_finish(client, make_runner):
    runner = make_runner()
    assert client.post("/admin/finish-signup/remind", headers=runner["headers"]).status_code == 403
