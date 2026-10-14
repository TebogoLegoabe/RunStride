"""The free beta Plus offer, who is active, and the admin overview and people list."""
from datetime import timedelta

from sqlalchemy import text

from app.security import utcnow
from tests.test_races import admin  # noqa: F401 (fixture)


# --- Beta Plus ---


def test_beta_plus_can_be_switched_on_once(client, make_runner, settings):
    settings.beta_plus_days = 30
    runner = make_runner()
    before = client.get("/me/membership", headers=runner["headers"]).json()
    assert before["plus"]["active"] is False and before["betaOfferDays"] == 30

    after = client.post("/billing/activate-beta", headers=runner["headers"]).json()

    assert after["plus"]["active"] is True and after["plus"]["source"] == "beta"
    assert after["betaOfferDays"] == 0
    assert client.post("/billing/activate-beta", headers=runner["headers"]).status_code == 409


def test_beta_offer_off_when_days_is_zero(client, make_runner, settings):
    settings.beta_plus_days = 0
    runner = make_runner()
    assert client.get("/me/membership", headers=runner["headers"]).json()["betaOfferDays"] == 0
    assert client.post("/billing/activate-beta", headers=runner["headers"]).status_code == 409


# --- Active users ---


def test_using_the_app_marks_someone_active(client, make_runner, db):
    runner = make_runner()
    client.get("/me", headers=runner["headers"]).raise_for_status()
    seen = db.execute(text("SELECT last_seen_at FROM users WHERE id = :id"), {"id": runner["id"]}).scalar()
    assert seen is not None and utcnow() - seen < timedelta(minutes=1)


# --- Admin ---


def test_stats_count_people_and_activity(client, admin, make_runner, db):
    make_runner()
    stale = make_runner(gender="man", interested_in=["woman"])
    db.execute(
        text("UPDATE users SET last_seen_at = now() - interval '10 days' WHERE id = :id"), {"id": stale["id"]}
    )
    db.commit()

    stats = client.get("/admin/stats", headers=admin["headers"]).json()

    assert stats["usersTotal"] == 3
    assert stats["profilesComplete"] == 3
    assert stats["activeNow"] == 2  # the admin and the first runner (the third was backdated)
    assert stats["activeWeek"] == 2 and stats["activeMonth"] == 3
    assert stats["newToday"] == 3
    assert len(stats["signupsByDay"]) == 14 and stats["signupsByDay"][-1]["count"] == 3


def test_stats_are_for_admins_only(client, make_runner):
    assert client.get("/admin/stats", headers=make_runner()["headers"]).status_code == 403
    assert client.get("/admin/users", headers=make_runner()["headers"]).status_code == 403


def test_user_list_searches_and_pages(client, admin, make_runner):
    first = make_runner()
    make_runner(gender="man", interested_in=["woman"])

    everyone = client.get("/admin/users", params={"limit": 2}, headers=admin["headers"])
    assert everyone.headers["X-Total-Count"] == "3"
    assert len(everyone.json()) == 2

    by_phone = client.get("/admin/users", params={"q": first["phone"][-6:]}, headers=admin["headers"]).json()
    assert [u["id"] for u in by_phone] == [first["id"]]
    assert client.get("/admin/users", params={"q": "nobody-here"}, headers=admin["headers"]).json() == []


def test_admin_can_suspend_ban_and_reinstate(client, admin, make_runner):
    runner = make_runner(gender="man", interested_in=["woman"])
    url = f"/admin/users/{runner['id']}/status"

    suspended = client.post(url, json={"action": "suspend", "days": 3}, headers=admin["headers"]).json()
    assert suspended["accountStatus"] == "suspended"
    assert client.get("/me", headers=runner["headers"]).status_code == 403

    assert client.post(url, json={"action": "ban"}, headers=admin["headers"]).json()["accountStatus"] == "banned"
    assert client.post(url, json={"action": "reinstate"}, headers=admin["headers"]).json()["accountStatus"] == "active"
    assert client.get("/me", headers=runner["headers"]).status_code == 200


def test_admins_cannot_be_banned_from_the_list(client, admin):
    res = client.post(f"/admin/users/{admin['id']}/status", json={"action": "ban"}, headers=admin["headers"])
    assert res.status_code == 409


def test_admin_gives_and_takes_plus(client, admin, make_runner, settings):
    settings.beta_plus_days = 30
    runner = make_runner(gender="man", interested_in=["woman"])
    client.post("/billing/activate-beta", headers=runner["headers"]).raise_for_status()

    given = client.post(f"/admin/users/{runner['id']}/plus", json={"days": 90}, headers=admin["headers"]).json()
    assert given["plusActive"] is True

    taken = client.delete(f"/admin/users/{runner['id']}/plus", headers=admin["headers"]).json()
    assert taken["plusActive"] is False  # both the beta Plus and the given Plus end
