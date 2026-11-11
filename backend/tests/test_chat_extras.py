"""Replies, reactions, photos and voice notes in a chat."""
from tests.conftest import png
from tests.test_chat import messages, pair, send, verification_off  # noqa: F401 (fixtures)

# The start of an M4A file (an MP4 container), as phones record voice notes
M4A = b"\x00\x00\x00\x20ftypM4A \x00\x00\x00\x00M4A mp42isom" + b"\x00" * 64


def test_reply_shows_the_message_it_answers(client, pair):
    thandi, sipho, match_id = pair
    question = send(client, thandi, match_id, "Parkrun on Saturday?").json()

    reply = client.post(
        f"/matches/{match_id}/messages", json={"body": "Yes!", "replyToId": question["id"]}, headers=sipho["headers"]
    )

    assert reply.status_code == 201
    assert reply.json()["replyTo"] == {
        "id": question["id"], "senderId": thandi["id"], "kind": "text", "body": "Parkrun on Saturday?", "mediaUrl": None
    }
    assert messages(client, thandi, match_id)[-1]["replyTo"]["id"] == question["id"]


def test_cant_reply_to_a_message_from_another_chat(client, pair, make_runner):
    thandi, sipho, match_id = pair
    lwazi = make_runner(gender="man", interested_in=["woman"], km_north=1)
    client.post(f"/discover/{lwazi['id']}/like", headers=thandi["headers"]).raise_for_status()
    other = client.post(f"/discover/{thandi['id']}/like", headers=lwazi["headers"]).json()["match"]["id"]
    elsewhere = send(client, lwazi, other, "Hi Thandi").json()

    res = client.post(f"/matches/{match_id}/messages", json={"body": "Hey", "replyToId": elsewhere["id"]}, headers=sipho["headers"])

    assert res.status_code == 404


def test_reactions_one_each_replace_and_remove(client, pair):
    thandi, sipho, match_id = pair
    msg = send(client, thandi, match_id).json()
    url = f"/matches/{match_id}/messages/{msg['id']}/reaction"

    assert client.put(url, json={"emoji": "❤️"}, headers=sipho["headers"]).json() == [{"userId": sipho["id"], "emoji": "❤️"}]
    # Reacting again replaces it
    client.put(url, json={"emoji": "😂"}, headers=sipho["headers"]).raise_for_status()
    client.put(url, json={"emoji": "👍"}, headers=thandi["headers"]).raise_for_status()
    assert {(r["userId"], r["emoji"]) for r in messages(client, thandi, match_id)[0]["reactions"]} == {
        (sipho["id"], "😂"), (thandi["id"], "👍")
    }
    # null removes it; words aren't reactions
    assert client.put(url, json={"emoji": None}, headers=sipho["headers"]).json() == [{"userId": thandi["id"], "emoji": "👍"}]
    assert client.put(url, json={"emoji": "lol"}, headers=sipho["headers"]).status_code == 422


def test_photo_message_has_size_and_caption(client, pair):
    thandi, sipho, match_id = pair

    res = client.post(
        f"/matches/{match_id}/messages/photo",
        files={"file": ("p.png", png(), "image/png")},
        data={"caption": "Finish line!"},
        headers=thandi["headers"],
    )

    assert res.status_code == 201
    msg = res.json()
    assert msg["kind"] == "image" and msg["body"] == "Finish line!"
    assert msg["mediaUrl"].startswith("/media/chat/") and msg["mediaUrl"].endswith(".jpg")
    assert (msg["mediaWidth"], msg["mediaHeight"]) == (20, 20)
    assert messages(client, sipho, match_id)[0]["id"] == msg["id"]


def test_voice_message(client, pair):
    thandi, _, match_id = pair

    res = client.post(
        f"/matches/{match_id}/messages/voice",
        files={"file": ("v.m4a", M4A, "audio/mp4")},
        data={"duration_ms": "4200"},
        headers=thandi["headers"],
    )
    junk = client.post(
        f"/matches/{match_id}/messages/voice", files={"file": ("v.m4a", b"not audio at all", "audio/mp4")}, headers=thandi["headers"]
    )

    assert res.status_code == 201
    assert res.json()["kind"] == "voice" and res.json()["mediaDurationMs"] == 4200
    assert res.json()["mediaUrl"].endswith(".m4a")
    assert junk.status_code == 422
