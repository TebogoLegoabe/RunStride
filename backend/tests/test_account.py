import pytest
from sqlalchemy import text

from app.main import app
from app.storage import get_photo_storage
from tests.conftest import sign_in


@pytest.fixture(autouse=True)
def verification_off(settings):
    settings.require_id_verification = False


@pytest.fixture
def pair(client, make_runner):
    thandi = make_runner()
    sipho = make_runner(gender="man", interested_in=["woman"])
    client.post(f"/discover/{sipho['id']}/like", headers=thandi["headers"]).raise_for_status()
    match_id = client.post(f"/discover/{thandi['id']}/like", headers=sipho["headers"]).json()["match"]["id"]
    client.post(f"/matches/{match_id}/messages", json={"body": "hey"}, headers=sipho["headers"]).raise_for_status()
    return thandi, sipho, match_id


def test_delete_account_removes_the_user_and_their_photos(client, pair, storage, db):
    thandi, sipho, _ = pair
    photo_files = list(storage.root.rglob("*.jpg"))
    assert len(photo_files) == 2  # one each

    res = client.delete("/me", headers=sipho["headers"])

    assert res.status_code == 204
    assert client.get("/me", headers=sipho["headers"]).status_code == 401
    assert db.execute(text("SELECT count(*) FROM users WHERE id = :id"), {"id": sipho["id"]}).scalar() == 0
    assert len(list(storage.root.rglob("*.jpg"))) == 1  # only Thandi's is left


def test_matches_and_chats_end_for_the_other_person(client, pair):
    thandi, sipho, match_id = pair

    client.delete("/me", headers=sipho["headers"])

    assert client.get("/matches", headers=thandi["headers"]).json() == []
    assert client.get(f"/matches/{match_id}/messages", headers=thandi["headers"]).status_code == 404


def test_other_person_is_told_live(client, pair):
    thandi, sipho, match_id = pair
    token = thandi["headers"]["Authorization"].removeprefix("Bearer ")

    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": token})
        ws.receive_json()
        client.delete("/me", headers=sipho["headers"])
        assert ws.receive_json() == {"type": "match_ended", "matchId": match_id}


def test_reports_and_evidence_survive_deletion(client, pair, db):
    thandi, sipho, match_id = pair
    report_id = client.post(
        "/reports",
        json={"reportedUserId": sipho["id"], "reason": "harassment", "matchId": match_id},
        headers=thandi["headers"],
    ).json()["id"]

    client.delete("/me", headers=sipho["headers"])

    row = db.execute(text("SELECT reported_id, evidence FROM reports WHERE id = :id"), {"id": report_id}).one()
    assert row.reported_id is None
    assert row.evidence["messages"][0]["body"] == "hey"


def test_same_number_can_start_fresh(client, pair, sms):
    _, sipho, _ = pair
    client.delete("/me", headers=sipho["headers"])

    again = sign_in(client, sms, phone=sipho["phone"])

    assert again["userId"] != sipho["id"]
    assert again["profileComplete"] is False


def test_photo_storage_failure_does_not_block_deletion(client, pair):
    _, sipho, _ = pair

    class Broken:
        def delete(self, url):
            raise RuntimeError("storage down")

    app.dependency_overrides[get_photo_storage] = lambda: Broken()

    assert client.delete("/me", headers=sipho["headers"]).status_code == 204
