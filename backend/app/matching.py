"""Running compatibility between two runners, as a 0-100 score.

Deliberately simple and explainable; tune the weights as real usage data comes in.
"""

from dataclasses import dataclass

# How much each part counts towards the score (sums to 1)
WEIGHTS = {
    "pace": 0.35,
    "goals": 0.20,
    "terrain": 0.15,
    "run_times": 0.15,
    "weekly_km": 0.15,
}
# Paces this many seconds/km apart (or more) score zero on pace
PACE_TOLERANCE_SECONDS = 120


@dataclass(frozen=True)
class RunnerTraits:
    pace_seconds_per_km: int
    weekly_km: int
    terrains: list[str]
    goals: list[str]
    run_times: list[str]


def _overlap(a: list[str], b: list[str]) -> float:
    """Jaccard similarity: shared choices / all choices."""
    if not a or not b:
        return 0.5  # one side didn't say (run times are optional): neither reward nor punish
    sa, sb = set(a), set(b)
    return len(sa & sb) / len(sa | sb)


def compatibility(me: RunnerTraits, them: RunnerTraits) -> int:
    pace_gap = abs(me.pace_seconds_per_km - them.pace_seconds_per_km)
    km_high = max(me.weekly_km, them.weekly_km, 1)
    parts = {
        "pace": max(0.0, 1 - pace_gap / PACE_TOLERANCE_SECONDS),
        "goals": _overlap(me.goals, them.goals),
        "terrain": _overlap(me.terrains, them.terrains),
        "run_times": _overlap(me.run_times, them.run_times),
        "weekly_km": 1 - abs(me.weekly_km - them.weekly_km) / km_high,
    }
    return round(100 * sum(WEIGHTS[k] * v for k, v in parts.items()))
