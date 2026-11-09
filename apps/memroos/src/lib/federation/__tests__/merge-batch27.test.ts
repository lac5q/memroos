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
  TEST_DB_DIR = path.join(os.tmpdir(), `federation-merge-b27-${crypto.randomUUID()}`);
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
    federationRunId: "run-b27",
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

describe("mergeFederatedPack batch27 — deterministic tie-break ordering", () => {
  it("breaks score ties by source handle then canonical hash", () => {
    const outcome = makeOutcome({ outcomeId: "A" });
    const items = new Map<string, Array<{ id: string; content: string; score: number; canonicalHash: string }>>();
    items.set("A", [
      { id: "i1", content: "z", score: 0.5, canonicalHash: "sha256:zzz" },
      { id: "i2", content: "b", score: 0.5, canonicalHash: "sha256:aaa" },
    ]);
    const merged = mergeFederatedPack(db, {
      tenantId: "default-tenant",
      federationRunId: "run-b27",
      outcomes: [outcome],
      scopeHash: "sha256:scope",
      budget: { maxItems: 10, maxBytes: 10_000, hopCount: 1 },
      itemsByOutcome: items,
    });
    expect(merged.items[0]?.canonicalHash).toBe("sha256:aaa");
    expect(merged.items[1]?.canonicalHash).toBe("sha256:zzz");
  });
});
