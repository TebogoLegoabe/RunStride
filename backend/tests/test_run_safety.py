from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.security import utcnow


@pytest.fixture(autouse=True)
def verification_off(settings):
    settings.require_id_verification = False


@pytest.fixture
def accepted_run(client, make_runner):
    """Thandi and Sipho, matched, with an accepted run starting in an hour."""
    thandi = make_runner()
    sipho = make_runner(gender="man", interested_in=["woman"])
    client.post(f"/discover/{sipho['id']}/like", headers=thandi["headers"]).raise_for_status()
    match_id = client.post(f"/discover/{thandi['id']}/like", headers=sipho["headers"]).json()["match"]["id"]
    starts = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    card = client.post(
        f"/matches/{match_id}/run-dates",
        json={"startsAt": starts, "place": "Delta Park parkrun"},
        headers=thandi["headers"],
    ).json()
    run_id = card["runDate"]["id"]
    client.post(f"/run-dates/{run_id}/accept", headers=sipho["headers"]).raise_for_status()
    return thandi, sipho, run_id


def move_run(db, run_id, starts_at):
    db.execute(text("UPDATE run_dates SET starts_at = :t WHERE id = :id"), {"t": starts_at, "id": run_id})
    db.commit()


def start_share(client, runner, run_id):
    return client.post(f"/run-dates/{run_id}/share", headers=runner["headers"])


def public(client, url) -> dict:
    path = "/" + url.split("/", 3)[3]  # the /s/<token> part of the full link
    return client.get(f"{path}/data").json()


# --- Trusted contacts ---


def test_trusted_contacts(client, accepted_run):
    thandi, _, _ = accepted_run
    h = thandi["headers"]

    res = client.post("/me/trusted-contacts", json={"name": "Mom", "phone": "072 111 2222"}, headers=h)
    assert res.status_code == 201
    assert res.json()["phone"] == "+27721112222"

    duplicate = client.post("/me/trusted-contacts", json={"name": "Mum", "phone": "+27721112222"}, headers=h)
    assert duplicate.status_code == 409
    yourself = client.post("/me/trusted-contacts", json={"name": "Me", "phone": thandi["phone"]}, headers=h)
    assert yourself.status_code == 422

    for n in range(2):
        client.post("/me/trusted-contacts", json={"name": f"Friend {n}", "phone": f"072 111 333{n}"}, headers=h)
    too_many = client.post("/me/trusted-contacts", json={"name": "One more", "phone": "072 111 4444"}, headers=h)
    assert too_many.status_code == 409

    contact_id = client.get("/me/trusted-contacts", headers=h).json()[0]["id"]
    assert client.delete(f"/me/trusted-contacts/{contact_id}", headers=h).status_code == 204
    assert len(client.get("/me/trusted-contacts", headers=h).json()) == 2


# --- Sharing ---


def test_share_link_shows_live_location(client, accepted_run):
    thandi, _, run_id = accepted_run

    res = start_share(client, thandi, run_id)
    assert res.status_code == 201
    share = res.json()
    assert share["status"] == "active"
    assert "/s/" in share["url"]

    before = public(client, share["url"])
    assert before["runnerName"] and before["meetingName"]
    assert before["place"] == "Delta Park parkrun"
    assert before["location"] is None  # nothing sent yet

    client.put(
        f"/shares/{share['id']}/location",
        json={"latitude": -26.1234567, "longitude": 28.0123456, "accuracyM": 12},
        headers=thandi["headers"],
    ).raise_for_status()
    location = public(client, share["url"])["location"]
    assert (location["latitude"], location["longitude"]) == (-26.1234567, 28.0123456)  # exact, not rounded
    assert location["accuracyM"] == 12


def test_starting_twice_returns_the_same_share(client, accepted_run):
    thandi, _, run_id = accepted_run

    assert start_share(client, thandi, run_id).json()["id"] == start_share(client, thandi, run_id).json()["id"]


def test_public_page_and_bad_tokens(client, accepted_run):
    thandi, _, run_id = accepted_run
    url = start_share(client, thandi, run_id).json()["url"]
    path = "/" + url.split("/", 3)[3]

    page = client.get(path)
    assert page.status_code == 200
    assert "RunStride" in page.text
    assert page.headers["x-robots-tag"].startswith("noindex")
    assert client.get("/s/not-a-real-token/data").status_code == 404


def test_sharing_window(client, accepted_run, db):
    thandi, _, run_id = accepted_run

    move_run(db, run_id, utcnow() + timedelta(hours=5))
    res = start_share(client, thandi, run_id)
    assert res.status_code == 409
    assert "2 hours before" in res.json()["detail"]

    move_run(db, run_id, utcnow() - timedelta(hours=5))
    assert start_share(client, thandi, run_id).status_code == 409


def test_only_accepted_runs_can_be_shared(client, accepted_run, db):
    thandi, _, run_id = accepted_run
    db.execute(text("UPDATE run_dates SET status = 'cancelled' WHERE id = :id"), {"id": run_id})
    db.commit()

    assert start_share(client, thandi, run_id).status_code == 409


def test_others_cannot_touch_your_share(client, accepted_run):
    thandi, sipho, run_id = accepted_run
    share_id = start_share(client, thandi, run_id).json()["id"]

    res = client.put(f"/shares/{share_id}/location", json={"latitude": 1, "longitude": 1}, headers=sipho["headers"])
    assert res.status_code == 404
    assert client.post(f"/shares/{share_id}/alert", headers=sipho["headers"]).status_code == 404


def test_outsiders_cannot_see_run_safety(client, accepted_run, make_runner):
    _, _, run_id = accepted_run
    outsider = make_runner(gender="woman", interested_in=["man"])

    assert client.get(f"/run-dates/{run_id}/safety", headers=outsider["headers"]).status_code == 404
    assert start_share(client, outsider, run_id).status_code == 404


def test_stop_sharing_forgets_location(client, accepted_run, db):
    thandi, _, run_id = accepted_run
    share = start_share(client, thandi, run_id).json()
    client.put(f"/shares/{share['id']}/location", json={"latitude": -26.1, "longitude": 28.0}, headers=thandi["headers"])

    res = client.post(f"/shares/{share['id']}/end", headers=thandi["headers"])

    assert res.json()["status"] == "ended"
    data = public(client, share["url"])
    assert data["status"] == "ended"
    assert data["location"] is None
    stored = db.execute(text("SELECT latitude FROM run_shares WHERE id = :id"), {"id": share["id"]}).scalar()
    assert stored is None
    after = client.put(f"/shares/{share['id']}/location", json={"latitude": 1, "longitude": 1}, headers=thandi["headers"])
    assert after.status_code == 409


def test_share_expires_on_its_own(client, accepted_run, db):
    thandi, _, run_id = accepted_run
    share = start_share(client, thandi, run_id).json()
    client.put(f"/shares/{share['id']}/location", json={"latitude": -26.1, "longitude": 28.0}, headers=thandi["headers"])

    db.execute(text("UPDATE run_shares SET expires_at = :t WHERE id = :id"), {"t": utcnow(), "id": share["id"]})
    db.commit()

    data = public(client, share["url"])
    assert data["status"] == "expired"
    assert data["location"] is None


# --- Panic button ---


def test_panic_button_alerts_page_and_texts_contacts(client, accepted_run, sms, db):
    thandi, _, run_id = accepted_run
    for name, phone in (("Mom", "072 111 2222"), ("Lebo", "073 222 3333")):
        client.post("/me/trusted-contacts", json={"name": name, "phone": phone}, headers=thandi["headers"])
    share = start_share(client, thandi, run_id).json()
    client.put(f"/shares/{share['id']}/location", json={"latitude": -26.1, "longitude": 28.0}, headers=thandi["headers"])
    sms.messages.clear()

    res = client.post(f"/shares/{share['id']}/alert", headers=thandi["headers"])

    assert res.json()["status"] == "alert"
    assert public(client, share["url"])["status"] == "alert"
    assert sorted(to for to, _ in sms.messages) == ["+27721112222", "+27732223333"]
    assert share["url"] in sms.messages[0][1]
    assert "10111" in sms.messages[0][1]

    # Pressing again doesn't text everyone twice
    client.post(f"/shares/{share['id']}/alert", headers=thandi["headers"])
    assert len(sms.messages) == 2

    # After an alert, the last location stays visible even once the link expires
    db.execute(text("UPDATE run_shares SET expires_at = :t WHERE id = :id"), {"t": utcnow(), "id": share["id"]})
    db.commit()
    data = public(client, share["url"])
    assert data["status"] == "expired"
    assert data["alertAt"] is not None
    assert data["location"] is not None


def test_panic_still_recorded_if_texting_fails(client, accepted_run):
    from app.main import app
    from app.sms import get_optional_sms_sender

    thandi, _, run_id = accepted_run
    client.post("/me/trusted-contacts", json={"name": "Mom", "phone": "072 111 2222"}, headers=thandi["headers"])
    share = start_share(client, thandi, run_id).json()

    class BrokenSms:
        def send(self, to, message):
            raise RuntimeError("provider down")

    app.dependency_overrides[get_optional_sms_sender] = lambda: BrokenSms()
    res = client.post(f"/shares/{share['id']}/alert", headers=thandi["headers"])

    assert res.status_code == 200
    assert res.json()["status"] == "alert"


def test_panic_works_with_no_sms_provider(client, accepted_run):
    from app.main import app
    from app.sms import get_optional_sms_sender

    thandi, _, run_id = accepted_run
    share = start_share(client, thandi, run_id).json()
    app.dependency_overrides[get_optional_sms_sender] = lambda: None

    res = client.post(f"/shares/{share['id']}/alert", headers=thandi["headers"])

    assert res.json()["status"] == "alert"


# --- Safety screen and check-ins ---


def test_safety_screen_summary(client, accepted_run):
    thandi, _, run_id = accepted_run
    client.post("/me/trusted-contacts", json={"name": "Mom", "phone": "072 111 2222"}, headers=thandi["headers"])

    before = client.get(f"/run-dates/{run_id}/safety", headers=thandi["headers"]).json()
    assert before["run"]["status"] == "accepted"
    assert before["otherName"]
    assert before["otherUserId"] == accepted_run[1]["id"]
    assert before["share"] is None
    assert [c["name"] for c in before["trustedContacts"]] == ["Mom"]
    assert before["checkIn"] is None

    start_share(client, thandi, run_id)
    after = client.get(f"/run-dates/{run_id}/safety", headers=thandi["headers"]).json()
    assert after["share"]["status"] == "active"


def test_check_in_after_the_run_starts(client, accepted_run, db):
    thandi, sipho, run_id = accepted_run

    early = client.post(f"/run-dates/{run_id}/check-in", json={"outcome": "ok"}, headers=thandi["headers"])
    assert early.status_code == 409

    move_run(db, run_id, utcnow() - timedelta(hours=1))
    client.post(f"/run-dates/{run_id}/check-in", json={"outcome": "ok"}, headers=thandi["headers"]).raise_for_status()
    client.post(f"/run-dates/{run_id}/check-in", json={"outcome": "problem"}, headers=thandi["headers"])

    assert client.get(f"/run-dates/{run_id}/safety", headers=thandi["headers"]).json()["checkIn"] == "problem"
    # Check-ins are private to each runner
    assert client.get(f"/run-dates/{run_id}/safety", headers=sipho["headers"]).json()["checkIn"] is None
