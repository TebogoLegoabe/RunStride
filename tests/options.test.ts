/// <reference types="node" />
// The app's choices must be values the server accepts, or saving a profile or report fails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DISTANCES_KM, GENDERS, GOALS, REPORT_REASONS, RUN_TIMES, SHOW_ME, TERRAINS, distanceLabel } from "../lib/options.ts";

const schemas = readFileSync(new URL("../backend/app/schemas.py", import.meta.url), "utf8");

function literal(name: string): string[] {
  const match = new RegExp(`^${name} = Literal\\[([^\\]]+)\\]`, "m").exec(schemas);
  assert.ok(match, `${name} not found in schemas.py`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
}

const values = (options: readonly { value: string }[]) => options.map((o) => o.value).sort();

test("running and dating choices match the server", () => {
  assert.deepEqual(values(TERRAINS), literal("Terrain"));
  assert.deepEqual(values(GOALS), literal("Goal"));
  assert.deepEqual(values(RUN_TIMES), literal("RunTime"));
  assert.deepEqual(values(GENDERS), literal("Gender"));
  assert.deepEqual(values(SHOW_ME), literal("Gender"));
});

test("report reasons match the server", () => {
  assert.deepEqual(values(REPORT_REASONS), literal("ReportReason"));
});

test("search distances fit the server's limit", () => {
  const max = Number(/max_distance_km: int = Field\(ge=1, le=(\d+)\)/.exec(schemas)?.[1]);
  assert.ok(max > 0);
  for (const km of DISTANCES_KM) assert.ok(km >= 1 && km <= max, `${km} km is outside 1–${max}`);
  assert.equal(distanceLabel(max), "Anywhere in SA");
  assert.equal(distanceLabel(50), "50 km");
});
