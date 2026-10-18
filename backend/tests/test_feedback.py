"""Feedback from the app to the admin console, and app error reports."""
from tests.test_notifications import phone, pushes  # noqa: F401 (fixtures)
from tests.test_races import admin, verification_off  # noqa: F401 (fixtures)


def test_feedback_reaches_admins(client, admin, make_runner, pushes):
    phone(client, admin)
    runner = make_runner(gender="man", interested_in=["woman"])

    res = client.post("/feedback", json={"body": "The race filter is confusing", "platform": "android", "screen": "races"},
                      headers=runner["headers"])
    assert res.status_code == 204
    assert [p.title for p in pushes.sent] == ["New feedback"]

    items = client.get("/admin/feedback", headers=admin["headers"])
    assert items.headers["X-Total-Count"] == "1"
    item = items.json()[0]
    assert item["body"] == "The race filter is confusing" and item["platform"] == "android"
    assert item["phone"] == runner["phone"]  # so you can follow up

    client.post(f"/admin/feedback/{item['id']}/done", headers=admin["headers"]).raise_for_status()
    assert client.get("/admin/feedback", headers=admin["headers"]).json() == []
    assert len(client.get("/admin/feedback", params={"status": "done"}, headers=admin["headers"]).json()) == 1
    assert client.get("/admin/stats", headers=admin["headers"]).json()["openFeedback"] == 0


def test_feedback_is_limited_and_admin_only(client, make_runner):
    runner = make_runner()
    assert client.post("/feedback", json={"body": "hi"}, headers=runner["headers"]).status_code == 422  # too short
    for _ in range(10):
        client.post("/feedback", json={"body": "more ideas"}, headers=runner["headers"]).raise_for_status()
    assert client.post("/feedback", json={"body": "more ideas"}, headers=runner["headers"]).status_code == 429
    assert client.get("/admin/feedback", headers=runner["headers"]).status_code == 403


def test_app_errors_are_accepted_without_signing_in(client):
    res = client.post("/client-errors", json={"message": "TypeError: x is undefined", "stack": "at Foo", "platform": "web"})
    assert res.status_code == 204
