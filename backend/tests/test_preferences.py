RUNNING = {
    "paceSecondsPerKm": 330,
    "weeklyKm": 25,
    "terrains": ["road", "trail"],
    "goals": ["half_marathon", "social"],
    "runTimes": ["early_morning"],
}
DATING = {
    "gender": "woman",
    "interestedIn": ["man"],
    "ageMin": 26,
    "ageMax": 36,
    "maxDistanceKm": 25,
}


def me(client, headers) -> dict:
    return client.get("/me", headers=headers).json()


def test_running_profile_404_before_creation(client, auth_headers):
    assert client.get("/me/running-profile", headers=auth_headers).status_code == 404


def test_save_and_update_running_profile(client, auth_headers):
    res = client.put("/me/running-profile", json=RUNNING, headers=auth_headers)

    assert res.status_code == 200
    assert res.json() == RUNNING
    assert me(client, auth_headers)["hasRunningProfile"] is True

    updated = {**RUNNING, "paceSecondsPerKm": 300, "runTimes": []}
    client.put("/me/running-profile", json=updated, headers=auth_headers).raise_for_status()
    assert client.get("/me/running-profile", headers=auth_headers).json() == updated


def test_running_profile_dedupes_choices(client, auth_headers):
    res = client.put(
        "/me/running-profile", json={**RUNNING, "terrains": ["road", "road", "trail"]}, headers=auth_headers
    )

    assert res.json()["terrains"] == ["road", "trail"]


def test_running_profile_validation(client, auth_headers):
    for bad in (
        {"paceSecondsPerKm": 60},  # 1:00/km: not a human pace
        {"weeklyKm": -5},
        {"terrains": []},
        {"terrains": ["lava"]},
        {"goals": []},
        {"runTimes": ["midnight"]},
    ):
        res = client.put("/me/running-profile", json={**RUNNING, **bad}, headers=auth_headers)
        assert res.status_code == 422, bad


def test_save_and_update_dating_preferences(client, auth_headers):
    res = client.put("/me/dating-preferences", json=DATING, headers=auth_headers)

    assert res.status_code == 200
    assert res.json() == DATING
    assert me(client, auth_headers)["hasDatingPreferences"] is True

    updated = {**DATING, "interestedIn": ["man", "woman"], "maxDistanceKm": 50}
    client.put("/me/dating-preferences", json=updated, headers=auth_headers).raise_for_status()
    assert client.get("/me/dating-preferences", headers=auth_headers).json() == updated


def test_age_range_must_be_in_order(client, auth_headers):
    res = client.put("/me/dating-preferences", json={**DATING, "ageMin": 40, "ageMax": 30}, headers=auth_headers)

    assert res.status_code == 422
    assert res.json()["detail"] == "Minimum age can't be higher than maximum age."


def test_dating_preferences_validation(client, auth_headers):
    for bad in (
        {"ageMin": 17},
        {"ageMax": 120},
        {"interestedIn": []},
        {"gender": "unknown"},
        {"maxDistanceKm": 0},
    ):
        res = client.put("/me/dating-preferences", json={**DATING, **bad}, headers=auth_headers)
        assert res.status_code == 422, bad


def test_preferences_require_auth(client):
    assert client.put("/me/running-profile", json=RUNNING).status_code == 401
    assert client.put("/me/dating-preferences", json=DATING).status_code == 401
