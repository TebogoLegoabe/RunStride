"""Emoji in messages: sent, stored and returned intact."""
from tests.test_notifications import match  # noqa: F401


def test_emoji_survive_a_round_trip_in_chat(client, make_runner):
    thandi = make_runner()
    sipho = make_runner(gender="man", interested_in=["woman"])
    match_id = match(client, thandi, sipho)
    text = "See you at the start 🏃‍♂️🏁 🇿🇦 ❤️"

    sent = client.post(f"/matches/{match_id}/messages", json={"body": text}, headers=thandi["headers"])
    assert sent.status_code == 201

    history = client.get(f"/matches/{match_id}/messages", headers=sipho["headers"]).json()
    assert history[-1]["body"] == text
