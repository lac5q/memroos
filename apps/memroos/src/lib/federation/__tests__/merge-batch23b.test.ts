// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mergeFederatedPack } from "../merge";
import type { FederationPolicyDecision, FederationSourceOutcome } from "../retrieval";

let db: import("better-sqlite3").Database;
let closeDb: () => void;
let TEST_DB_DIR: string;

beforeEach(async () => {
  TEST_DB_DIR = path.join(os.tmpdir(), `federation-merge-b23b-${crypto.randomUUID()}`);
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(TEST_DB_DIR, "fed.db");
  vi.resetModules();
  const { getDb, closeDb: close } = await import("@/lib/db");
  const { initSchema } = await import("@/lib/db-schema");
  db = getDb();
  initSchema(db);
  closeDb = close;
});

afterEach(() => {
  closeDb();
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

function makeOutcome(overrides: Partial<FederationSourceOutcome> = {}): FederationSourceOutcome {
  const policy: FederationPolicyDecision = { kind: "allow", reason: "ok", policyVersion: "federation-v1" };
  return {
    outcomeId: overrides.outcomeId ?? `out-${crypto.randomUUID()}`,
    federationRunId: "run-b23b",
    sourceId: "src-1",
    sourceHandle: "alpha",
    sourceKind: "memory",
    outcome: "success",
    reasonCode: "ok",
    policyDecision: policy,
    policyVersion: "federation-v1",
    resultCount: 1,
    resultBytes: 100,
    durationMs: 1,
    requestHash: null,
    responseHash: null,
    payloadHash: null,
    scopeHash: "sha256:scope",
    metadata: {},
    ...overrides,
  };
}

describe("mergeFederatedPack batch23b — byte budget and duplicate tallies", () => {
  it("marks over_budget when maxBytes is exceeded", () => {
    const outcome = makeOutcome({ outcomeId: "A" });
    const items = new Map<string, Array<{ id: string; content: string; score: number; canonicalHash: string }>>();
    items.set("A", [
      { id: "i1", content: "x".repeat(200), score: 0.9, canonicalHash: "sha256:big1" },
      { id: "i2", content: "y".repeat(200), score: 0.8, canonicalHash: "sha256:big2" },
    ]);
    const merged = mergeFederatedPack(db, {
      tenantId: "default-tenant",
      federationRunId: "run-b23b",
      outcomes: [outcome],
      scopeHash: "sha256:scope",
      budget: { maxItems: 10, maxBytes: 250, hopCount: 1 },
      itemsByOutcome: items,
    });
    expect(merged.boundStatus).toBe("over_budget");
    expect(merged.items.length).toBe(1);
  });

  it("increments duplicateCount when the same canonical hash appears twice in an allowed outcome", () => {
    const outcome = makeOutcome({ outcomeId: "A" });
    const items = new Map<string, Array<{ id: string; content: string; score: number; canonicalHash: string }>>();
    items.set("A", [
      { id: "i1", content: "first", score: 0.9, canonicalHash: "sha256:dup" },
      { id: "i2", content: "second", score: 0.8, canonicalHash: "sha256:dup" },
    ]);
    const merged = mergeFederatedPack(db, {
      tenantId: "default-tenant",
      federationRunId: "run-dup",
      outcomes: [outcome],
      scopeHash: "sha256:scope",
      budget: { maxItems: 10, maxBytes: 10_000, hopCount: 1 },
      itemsByOutcome: items,
    });
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].duplicateCount).toBe(1);
    expect(merged.dedupeMetadata).toMatchObject({ duplicates_total: 1 });
  });
});
