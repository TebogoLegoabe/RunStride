/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatCountdown,
  formatDistance,
  formatPace,
  formatRaceDates,
  labelFor,
  toIsoWithOffset,
} from "../lib/format.ts";

test("pace is minutes and zero-padded seconds", () => {
  assert.equal(formatPace(330), "5:30");
  assert.equal(formatPace(305), "5:05");
  assert.equal(formatPace(600), "10:00");
});

test("labelFor falls back to the raw value", () => {
  const options = [{ value: "road", label: "Road" }];
  assert.equal(labelFor(options, "road"), "Road");
  assert.equal(labelFor(options, "sand"), "sand");
});

test("distances drop .0 but keep one decimal", () => {
  assert.equal(formatDistance(21), "21 km");
  assert.equal(formatDistance(21.0975), "21.1 km");
});

test("race dates never shift by a day and name the month once", () => {
  assert.equal(formatRaceDates("2026-11-01", "2026-11-01"), "Sun 1 Nov");
  assert.equal(formatRaceDates("2026-10-03", "2026-10-04"), "Sat 3 – Sun 4 Oct");
  assert.equal(formatRaceDates("2026-10-31", "2026-11-01"), "Sat 31 Oct – Sun 1 Nov");
});

test("countdown from today to months away", () => {
  const now = new Date(2026, 10, 2, 15, 0); // 2 Nov, mid-afternoon
  assert.equal(formatCountdown("2026-11-02", "2026-11-02", now), "Today");
  assert.equal(formatCountdown("2026-11-03", "2026-11-03", now), "Tomorrow");
  assert.equal(formatCountdown("2026-11-07", "2026-11-07", now), "In 5 days");
  assert.equal(formatCountdown("2026-11-23", "2026-11-23", now), "In 3 weeks");
  assert.equal(formatCountdown("2027-02-02", "2027-02-02", now), "In 3 months");
  assert.equal(formatCountdown("2026-11-01", "2026-11-03", now), "On now");
  assert.equal(formatCountdown("2026-10-31", "2026-11-01", now), "Finished");
});

test("run times carry this device's UTC offset", () => {
  const iso = toIsoWithOffset(new Date(2026, 8, 27), "7:05");
  assert.match(iso ?? "", /^2026-09-27T07:05:00[+-]\d{2}:\d{2}$/);
  // Read back, it's the same local moment
  const back = new Date(iso!);
  assert.equal(back.getHours(), 7);
  assert.equal(back.getMinutes(), 5);
});

test("run times reject impossible clocks", () => {
  const day = new Date(2026, 8, 27);
  assert.equal(toIsoWithOffset(day, "24:00"), null);
  assert.equal(toIsoWithOffset(day, "7:60"), null);
  assert.equal(toIsoWithOffset(day, "seven"), null);
});
