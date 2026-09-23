from datetime import timedelta

import pytest
from sqlalchemy import text

from app.security import utcnow


@pytest.fixture(autouse=True)
def verification_off(settings):
    settings.require_id_verification = False


@pytest.fixture
def pair(client, make_runner):
    """Two matched runners who've exchanged messages, and their match ID."""
    thandi = make_runner()
    sipho = make_runner(gender="man", interested_in=["woman"])
    client.post(f"/discover/{sipho['id']}/like", headers=thandi["headers"]).raise_for_status()
    match_id = client.post(f"/discover/{thandi['id']}/like", headers=sipho["headers"]).json()["match"]["id"]
    for runner, body in ((thandi, "Hi!"), (sipho, "Send me money for a taxi")):
        client.post(f"/matches/{match_id}/messages", json={"body": body}, headers=runner["headers"]).raise_for_status()
    return thandi, sipho, match_id


@pytest.fixture
def admin(make_runner, db):
    moderator = make_runner(gender="non_binary", interested_in=["non_binary"])
    db.execute(text("UPDATE users SET is_admin = true WHERE id = :id"), {"id": moderator["id"]})
    db.commit()
    return moderator


def feed_ids(client, runner) -> list[str]:
    return [c["userId"] for c in client.get("/discover", headers=runner["headers"]).json()]


def report(client, reporter, reported, reason="spam", **extra):
    body = {"reportedUserId": reported["id"], "reason": reason, **extra}
    return client.post("/reports", json=body, headers=reporter["headers"])


# --- Blocking ---


def test_block_hides_both_ways_and_ends_match(client, pair):
    thandi, sipho, match_id = pair

    assert client.post(f"/users/{sipho['id']}/block", headers=thandi["headers"]).status_code == 204

    assert client.get("/matches", headers=thandi["headers"]).json() == []
    assert client.get("/matches", headers=sipho["headers"]).json() == []
    res = client.post(f"/matches/{match_id}/messages", json={"body": "?"}, headers=sipho["headers"])
    assert res.status_code == 404


def test_blocked_people_never_appear_in_discover(client, make_runner):
    thandi = make_runner()
    sipho = make_runner(gender="man", interested_in=["woman"])
    assert feed_ids(client, thandi) == [sipho["id"]]

    client.post(f"/users/{thandi['id']}/block", headers=sipho["headers"])

    assert feed_ids(client, thandi) == []
    assert feed_ids(client, sipho) == []


def test_cannot_block_yourself(client, make_runner):
    thandi = make_runner()

    assert client.post(f"/users/{thandi['id']}/block", headers=thandi["headers"]).status_code == 404


# --- Reporting ---


def test_report_captures_evidence_and_blocks(client, pair, admin):
    thandi, sipho, match_id = pair

    res = report(client, thandi, sipho, reason="harassment", details="Asked for money", matchId=match_id)

    assert res.status_code == 201
    report_id = res.json()["id"]
    assert client.get("/matches", headers=thandi["headers"]).json() == []  # blocked, match ended

    detail = client.get(f"/admin/reports/{report_id}", headers=admin["headers"]).json()
    assert detail["reason"] == "harassment"
    assert detail["details"] == "Asked for money"
    assert detail["reporter"]["id"] == thandi["id"]
    assert detail["reported"]["id"] == sipho["id"]
    evidence = detail["evidence"]
    assert evidence["profile"]["photos"]
    assert [(m["fromReported"], m["body"]) for m in evidence["messages"]] == [
        (False, "Hi!"),
        (True, "Send me money for a taxi"),
    ]


def test_evidence_survives_reported_account_deletion(client, pair, admin, db):
    thandi, sipho, match_id = pair
    report_id = report(client, thandi, sipho, matchId=match_id).json()["id"]

    db.execute(text("DELETE FROM users WHERE id = :id"), {"id": sipho["id"]})
    db.commit()

    detail = client.get(f"/admin/reports/{report_id}", headers=admin["headers"]).json()
    assert detail["reported"]["id"] is None
    assert len(detail["evidence"]["messages"]) == 2


def test_reporting_twice_returns_the_open_report(client, pair):
    thandi, sipho, _ = pair

    first = report(client, thandi, sipho).json()["id"]
    second = report(client, thandi, sipho).json()["id"]

    assert first == second


def test_other_reason_needs_details(client, pair):
    thandi, sipho, _ = pair

    res = report(client, thandi, sipho, reason="other")

    assert res.status_code == 422
    assert res.json()["detail"] == "Please tell us what happened."


def test_report_with_someone_elses_match_is_rejected(client, pair, make_runner):
    thandi, sipho, match_id = pair
    outsider = make_runner(gender="man", interested_in=["woman"])

    assert report(client, outsider, sipho, matchId=match_id).status_code == 404


def test_heavily_reported_users_hidden_until_reviewed(client, make_runner, settings):
    settings.report_auto_hide_threshold = 2
    viewer = make_runner()
    suspect = make_runner(gender="man", interested_in=["woman"])
    assert feed_ids(client, viewer) == [suspect["id"]]

    for _ in range(2):
        reporter = make_runner(gender="woman", interested_in=["woman"])
        report(client, reporter, suspect).raise_for_status()

    assert feed_ids(client, viewer) == []


# --- Moderation ---


def test_admin_endpoints_need_admin(client, pair):
    thandi, _, _ = pair

    assert client.get("/admin/reports", headers=thandi["headers"]).status_code == 403


def test_queue_lists_open_reports_oldest_first(client, pair, admin, make_runner):
    thandi, sipho, _ = pair
    first = report(client, thandi, sipho).json()["id"]
    other = make_runner(gender="woman", interested_in=["woman"])
    second = report(client, other, sipho).json()["id"]

    queue = client.get("/admin/reports", headers=admin["headers"]).json()

    assert [r["id"] for r in queue] == [first, second]
    assert queue[0]["reported"]["openReportCount"] == 2


def test_dismiss(client, pair, admin):
    thandi, sipho, _ = pair
    report_id = report(client, thandi, sipho).json()["id"]

    res = client.post(
        f"/admin/reports/{report_id}/resolve", json={"action": "dismiss", "note": "No evidence"}, headers=admin["headers"]
    )

    assert res.json()["status"] == "resolved"
    assert res.json()["resolution"] == "dismiss"
    assert client.get("/me", headers=sipho["headers"]).status_code == 200
    assert client.get("/admin/reports", headers=admin["headers"]).json() == []
    again = client.post(f"/admin/reports/{report_id}/resolve", json={"action": "ban"}, headers=admin["headers"])
    assert again.status_code == 409


def test_suspend_locks_out_until_it_expires(client, pair, admin, make_runner, db):
    thandi, sipho, _ = pair
    report_id = report(client, thandi, sipho).json()["id"]

    missing_days = client.post(f"/admin/reports/{report_id}/resolve", json={"action": "suspend"}, headers=admin["headers"])
    assert missing_days.status_code == 422
    client.post(
        f"/admin/reports/{report_id}/resolve", json={"action": "suspend", "suspendDays": 7}, headers=admin["headers"]
    ).raise_for_status()

    res = client.get("/me", headers=sipho["headers"])
    assert res.status_code == 403
    assert "suspended until" in res.json()["detail"]
    viewer = make_runner()
    assert sipho["id"] not in feed_ids(client, viewer)

    db.execute(
        text("UPDATE users SET suspended_until = :t WHERE id = :id"),
        {"t": utcnow() - timedelta(minutes=1), "id": sipho["id"]},
    )
    db.commit()
    assert client.get("/me", headers=sipho["headers"]).status_code == 200


def test_ban_locks_out_ends_matches_and_settles_other_reports(client, pair, admin, make_runner, sms):
    thandi, sipho, match_id = pair
    other = make_runner(gender="woman", interested_in=["man"])
    client.post(f"/discover/{other['id']}/like", headers=sipho["headers"])
    client.post(f"/discover/{sipho['id']}/like", headers=other["headers"]).raise_for_status()
    assert len(client.get("/matches", headers=other["headers"]).json()) == 1
    first = report(client, thandi, sipho).json()["id"]
    second_reporter = make_runner(gender="woman", interested_in=["woman"])
    report(client, second_reporter, sipho)

    client.post(f"/admin/reports/{first}/resolve", json={"action": "ban"}, headers=admin["headers"]).raise_for_status()

    assert client.get("/me", headers=sipho["headers"]).status_code == 403
    assert client.get("/matches", headers=other["headers"]).json() == []  # match with the banned user ended
    assert client.get("/admin/reports", headers=admin["headers"]).json() == []  # all settled

    # Banned numbers can't sign back in
    client.post("/auth/otp/send", json={"phone": sipho["phone"]})
    res = client.post("/auth/otp/verify", json={"phone": sipho["phone"], "code": sms.last_code()})
    assert res.status_code == 403
    assert "banned" in res.json()["detail"]


def test_admins_cannot_be_banned_through_reports(client, make_runner, admin):
    reporter = make_runner(gender="non_binary", interested_in=["non_binary"])
    report_id = report(client, reporter, admin).json()["id"]

    res = client.post(f"/admin/reports/{report_id}/resolve", json={"action": "ban"}, headers=admin["headers"])

    assert res.status_code == 409


def test_banned_user_websocket_refused(client, pair, admin):
    thandi, sipho, _ = pair
    report_id = report(client, thandi, sipho).json()["id"]
    client.post(f"/admin/reports/{report_id}/resolve", json={"action": "ban"}, headers=admin["headers"])

    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": sipho["headers"]["Authorization"].removeprefix("Bearer ")})
        assert ws.receive()["code"] == 4401


def test_queue_can_show_resolved_reports(client, pair, admin):
    thandi, sipho, _ = pair
    report_id = report(client, thandi, sipho).json()["id"]
    client.post(f"/admin/reports/{report_id}/resolve", json={"action": "warn"}, headers=admin["headers"])

    resolved = client.get("/admin/reports", params={"status": "resolved"}, headers=admin["headers"]).json()

    assert [(r["id"], r["resolution"]) for r in resolved] == [(report_id, "warn")]
