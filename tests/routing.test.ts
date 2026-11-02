/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { afterSave, editHref, routeFor } from "../lib/routing.ts";
import type { Me } from "../lib/types.ts";

const done: Me = {
  id: "u",
  phone: "+27710000000",
  email: null,
  hasGoogle: false,
  verificationStatus: "unverified",
  verificationRequired: false,
  idCheckAvailable: true,
  verificationAvailable: true,
  profileComplete: true,
  hasRunningProfile: true,
  hasDatingPreferences: true,
  hasLocation: true,
  isAdmin: false,
};

test("onboarding goes step by step, then Discover", () => {
  assert.equal(routeFor({ ...done, phone: null }), "/add-phone");
  assert.equal(routeFor({ ...done, profileComplete: false }), "/profile-setup");
  assert.equal(routeFor({ ...done, hasRunningProfile: false }), "/running-preferences");
  assert.equal(routeFor({ ...done, hasDatingPreferences: false }), "/dating-preferences");
  assert.equal(routeFor(done), "/discover");
});

test("ID verification only blocks when it's required", () => {
  assert.equal(routeFor({ ...done, verificationRequired: true }), "/verify-identity");
  assert.equal(
    routeFor({ ...done, verificationRequired: true, verificationStatus: "verified" }),
    "/discover"
  );
});

// Records where afterSave sends someone; canGoBack is true in both cases below
function fakeRouter() {
  const went: string[] = [];
  const router = {
    canGoBack: () => true,
    back: () => went.push("back"),
    replace: (href: string) => went.push(href),
  } as unknown as Parameters<typeof afterSave>[0];
  return { router, went };
}

test("finishing sign-up opens Discover, not the screen before", () => {
  const { router, went } = fakeRouter();
  afterSave(router, done);
  assert.deepEqual(went, ["/discover"]);
});

test("saving an edit goes back to where it was opened", () => {
  const { router, went } = fakeRouter();
  afterSave(router, done, true);
  assert.deepEqual(went, ["back"]);
});

test("an edit that leaves a step unfinished goes to that step", () => {
  const { router, went } = fakeRouter();
  afterSave(router, { ...done, hasDatingPreferences: false }, true);
  assert.deepEqual(went, ["/dating-preferences"]);
  assert.equal(editHref("/running-preferences"), "/running-preferences?edit=1");
});
