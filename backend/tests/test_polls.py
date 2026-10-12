from sqlalchemy import text


def test_poll_is_unanswered_then_answered(client, auth_headers):
    poll = client.get("/me/poll", headers=auth_headers).json()
    assert poll["answered"] is False
    assert {o["value"] for o in poll["options"]} == {"want", "optional", "phone"}

    assert client.post("/me/poll", json={"answer": "optional"}, headers=auth_headers).status_code == 204
    assert client.get("/me/poll", headers=auth_headers).json()["answered"] is True


def test_unknown_answer_is_rejected(client, auth_headers):
    assert client.post("/me/poll", json={"answer": "maybe"}, headers=auth_headers).status_code == 422


def test_changing_an_answer_does_not_double_count(client, auth_headers, db):
    client.post("/me/poll", json={"answer": "want"}, headers=auth_headers).raise_for_status()
    client.post("/me/poll", json={"answer": "phone"}, headers=auth_headers).raise_for_status()
    me = client.get("/me", headers=auth_headers).json()
    db.execute(text("UPDATE users SET is_admin = true WHERE id = :id"), {"id": me["id"]})
    db.commit()

    results = client.get("/admin/poll", headers=auth_headers).json()
    assert results["total"] == 1
    assert results["counts"] == {"want": 0, "optional": 0, "phone": 1}


def test_results_are_admin_only(client, auth_headers):
    assert client.get("/admin/poll", headers=auth_headers).status_code == 403
