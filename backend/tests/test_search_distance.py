"""Widening your search right from Discover."""
from tests.test_discover import feed_ids  # noqa: F401


def test_a_wider_distance_brings_in_runners_further_away(client, make_runner):
    thandi = make_runner()
    far = make_runner(gender="man", interested_in=["woman"], km_north=80)
    assert feed_ids(client, thandi) == []  # both default to a short distance

    res = client.put("/me/search-distance", json={"maxDistanceKm": 100}, headers=thandi["headers"])
    assert res.status_code == 200 and res.json()["maxDistanceKm"] == 100
    # Your distance alone decides: his short distance doesn't hide him from you
    assert feed_ids(client, thandi) == [far["id"]]
    assert feed_ids(client, far) == []


def test_anywhere_in_sa_is_allowed_and_nonsense_is_not(client, make_runner):
    runner = make_runner()
    assert client.put("/me/search-distance", json={"maxDistanceKm": 2000}, headers=runner["headers"]).status_code == 200
    assert client.put("/me/search-distance", json={"maxDistanceKm": 0}, headers=runner["headers"]).status_code == 422
    assert client.put("/me/search-distance", json={"maxDistanceKm": 5000}, headers=runner["headers"]).status_code == 422
