import { test } from "node:test";
import assert from "node:assert/strict";
import { withTone } from "../lib/emojiTone.ts";

test("adds the tone to emoji that have tones", () => {
  assert.equal(withTone("👍", "🏽"), "👍🏽");
  assert.equal(withTone("✌️", "🏿"), "✌🏿"); // the "show as emoji" mark makes way for the tone
});

test("puts the tone right after the person in a runner with a gender", () => {
  assert.equal(withTone("🏃‍♀️", "🏻"), "🏃🏻‍♀️");
});

test("leaves other emoji and the default tone alone", () => {
  assert.equal(withTone("❤️", "🏽"), "❤️");
  assert.equal(withTone("👍", ""), "👍");
});
