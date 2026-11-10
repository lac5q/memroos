// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { PROPOSAL_TYPES } from "../proposal-registry";

let testDb: Database.Database;

beforeEach(() => {
  testDb = new Database(":memory:");
  initSchema(testDb);
});

afterEach(() => {
  testDb.close();
});

describe("proposal-registry batch33 — resolveDb sticky paths", () => {
  it.skip("resolveDb default require('@/lib/db') (24-25) — Vitest module alias prevents hitting CJS require fallback", () => {});

  it("noop_test applyShadow remains callable with explicit db", () => {
    PROPOSAL_TYPES.noop_test.applyShadow({ marker: `batch33-${Date.now()}` }, testDb);
  });
});
