// @mentions in race chats. A message's body carries each mention as <@user-id>, so a mention
// still points at the right person if two runners share a name or someone renames.
import type { Person } from "./types";

const TOKEN = /<@([0-9a-fA-F-]{36})>/g;

export type Segment = { text: string } | { mention: Person | null; id: string };

// A message body as plain text and mentions, for display
export function splitMentions(body: string, mentions: Person[]): Segment[] {
  const byId = new Map(mentions.map((p) => [p.id, p]));
  const segments: Segment[] = [];
  let last = 0;
  for (const match of body.matchAll(TOKEN)) {
    if (match.index > last) segments.push({ text: body.slice(last, match.index) });
    segments.push({ mention: byId.get(match[1]) ?? null, id: match[1] });
    last = match.index + match[0].length;
  }
  if (last < body.length) segments.push({ text: body.slice(last) });
  return segments;
}

// The body with mentions written as @Name, e.g. for quoting a message
export function plainText(body: string, mentions: Person[]): string {
  return splitMentions(body, mentions)
    .map((s) => ("text" in s ? s.text : `@${s.mention?.displayName ?? "someone"}`))
    .join("");
}

// The @word being typed just before the cursor, if any: where it starts and what's typed so far
export function activeMention(text: string, cursor: number): { start: number; query: string } | null {
  const before = text.slice(0, Math.min(cursor, text.length));
  const match = /(^|\s)@([^\s@<>]{0,30})$/.exec(before);
  if (!match) return null;
  return { start: before.length - match[2].length - 1, query: match[2] };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Turns the "@Name" of each person picked from the suggestions back into <@id> for sending.
// `picked` has one entry per pick, in order: each claims the first "@Name" still unclaimed, so
// two different people with the same name stay apart. A name edited after picking stays text.
export function encodeMentions(draft: string, picked: Person[]): string {
  // Longest names first, so "@Ann" doesn't claim the start of "@Anna" (sort keeps pick order otherwise)
  const people = [...picked].sort((a, b) => b.displayName.length - a.displayName.length);
  let out = draft;
  for (const person of people) {
    const name = new RegExp(`(^|\\s)@${escapeRegExp(person.displayName)}(?![\\p{L}\\p{N}_])`, "u");
    out = out.replace(name, `$1<@${person.id}>`);
  }
  return out;
}
