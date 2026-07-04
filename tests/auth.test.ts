import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUsername, validatePassword, validateUsername } from "../lib/validation.ts";

test("pseudonyms are normalized and constrained", () => {
  assert.equal(normalizeUsername("  Quiet_Pine  "), "quiet_pine");
  assert.equal(validateUsername("Quiet_Pine"), "quiet_pine");
  for (const invalid of ["ab", "has-dash", "has space", "x".repeat(25), "ålias"]) {
    assert.throws(() => validateUsername(invalid), /3–24 lowercase/);
  }
});

test("password limits reject weak and pathological inputs", () => {
  assert.equal(validatePassword("twelve-chars"), "twelve-chars");
  assert.throws(() => validatePassword("too-short"), /at least 12/);
  assert.throws(() => validatePassword("x".repeat(129)), /128 characters/);
});
