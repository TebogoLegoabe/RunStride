/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { activeMention, encodeMentions, plainText, splitMentions } from "../lib/mentions.ts";

const ann = { id: "11111111-1111-1111-1111-111111111111", displayName: "Ann", photo: null };
const anna = { id: "22222222-2222-2222-2222-222222222222", displayName: "Anna", photo: null };
const otherAnn = { id: "33333333-3333-3333-3333-333333333333", displayName: "Ann", photo: null };

test("a body splits into text and the people it mentions", () => {
  const body = `Hi <@${ann.id}>, see you at the start`;
  assert.deepEqual(splitMentions(body, [ann]), [
    { text: "Hi " },
    { mention: ann, id: ann.id },
    { text: ", see you at the start" },
  ]);
});

test("someone who left still shows as a mention", () => {
  assert.equal(plainText(`<@${ann.id}> hi`, []), "@someone hi");
  assert.equal(plainText(`<@${ann.id}> hi`, [ann]), "@Ann hi");
});

test("the @word being typed is found only at a word start", () => {
  assert.deepEqual(activeMention("hey @An", 7), { start: 4, query: "An" });
  assert.deepEqual(activeMention("@", 1), { start: 0, query: "" });
  assert.equal(activeMention("mail@An", 7), null);
  assert.equal(activeMention("hey @Ann there", 14), null);
});

test("picked names become ids, longest name first", () => {
  assert.equal(encodeMentions("@Anna and @Ann", [ann, anna]), `<@${anna.id}> and <@${ann.id}>`);
});

test("two people with the same name stay apart", () => {
  assert.equal(encodeMentions("@Ann @Ann", [ann, otherAnn]), `<@${ann.id}> <@${otherAnn.id}>`);
});

test("a name edited after picking stays text", () => {
  assert.equal(encodeMentions("@Annie", [ann]), "@Annie");
});
