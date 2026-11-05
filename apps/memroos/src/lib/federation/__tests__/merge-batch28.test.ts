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
  TEST_DB_DIR = path.join(os.tmpdir(), `federation-merge-b28-${crypto.randomUUID()}`);
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
    federationRunId: "run-b28",
    sourceId: "src-1",
    sourceHandle: overrides.sourceHandle ?? "alpha",
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

describe("mergeFederatedPack batch28 — budget and denied duplicate suppression", () => {
  it("marks over_budget when byte budget is exceeded", () => {
    const outcome = makeOutcome({ outcomeId: "bytes-b28" });
    const items = new Map<string, Array<{ id: string; content: string; score: number; canonicalHash: string }>>();
    items.set("bytes-b28", [
      { id: "a", content: "x".repeat(200), score: 1, canonicalHash: "sha256:a" },
      { id: "b", content: "y".repeat(200), score: 0.9, canonicalHash: "sha256:b" },
    ]);
    const merged = mergeFederatedPack(db, {
      tenantId: "default-tenant",
      federationRunId: "run-b28",
      outcomes: [outcome],
      scopeHash: "sha256:scope",
      budget: { maxItems: 10, maxBytes: 100, hopCount: 1 },
      itemsByOutcome: items,
    });
    expect(merged.boundStatus).toBe("over_budget");
    expect(merged.packItemCount).toBe(0);
  });

  it("skips allowed items whose canonical hash was denied by another source", () => {
    const allowed = makeOutcome({ outcomeId: "allow-b28" });
    const denied = makeOutcome({ outcomeId: "deny-b28", outcome: "denied", policyDecision: { kind: "deny", reason: "policy", policyVersion: "federation-v1" } });
    const hash = "sha256:deny-batch28";
    const items = new Map<string, Array<{ id: string; content: string; score: number; canonicalHash: string }>>();
    items.set("deny-b28", [{ id: "d1", content: "denied", score: 1, canonicalHash: hash }]);
    items.set("allow-b28", [{ id: "a1", content: "allowed", score: 0.9, canonicalHash: hash }]);
    const merged = mergeFederatedPack(db, {
      tenantId: "default-tenant",
      federationRunId: "run-b28-deny",
      outcomes: [denied, allowed],
      scopeHash: "sha256:scope",
      budget: { maxItems: 5, maxBytes: 10_000, hopCount: 1 },
      itemsByOutcome: items,
    });
    expect(merged.packItemCount).toBe(0);
  });
});
