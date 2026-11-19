// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  collectCollectionFiles,
  collectKnowledgeFiles,
  loadCollections,
  scanConfiguredCollection,
} from "@/lib/knowledge-collections";
import { parseFailuresLog } from "@/lib/failures-parser";
import { parseTransactionCsv } from "@/lib/finance-reconciliation";
import { mergeFederatedPack } from "@/lib/federation/merge";
import type { FederationPolicyDecision, FederationSourceOutcome } from "@/lib/federation/retrieval";
import { BudgetTracker } from "@/lib/federation/budgets";
import { checkOwnerGate } from "@/lib/identity/owner-gate";
import { listErasureTombstones, tombstoneUserForDsar } from "@/lib/erasure-tombstone";

describe("long-tail batch15 — priority ROI lib targets", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), `b15-priority-${randomUUID()}-`));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("knowledge-collections tolerates bad config and merges paths", async () => {
    vi.stubEnv("COLLECTIONS_CONFIG_PATH", path.join(tmp, "missing.json"));
    expect(loadCollections()).toEqual([]);
    const kb = path.join(tmp, "kb");
    fs.mkdirSync(path.join(kb, "col"), { recursive: true });
    fs.writeFileSync(path.join(kb, "col", "a.md"), "doc\n");
    vi.stubEnv("KNOWLEDGE_BASE_PATH", kb);
    const files = await collectKnowledgeFiles(path.join(kb, "col"));
    expect(files.length).toBe(1);
    const merged = await collectCollectionFiles({
      name: "m",
      category: "internal",
      basePaths: ["col", "missing-dir"],
    });
    expect(merged.length).toBe(1);
    const scan = await scanConfiguredCollection({ name: "col", category: "internal", basePath: "col" });
    expect(scan.docCount).toBe(1);
  });

  it("failures-parser parses escaped string content", async () => {
    const log = path.join(tmp, "f.log");
    fs.writeFileSync(log, '{"error_type":"x","msg":"a \\"b\\""}', "utf8");
    const entries = await parseFailuresLog(log);
    expect(entries).toHaveLength(1);
  });

  it("finance CSV parser handles quoted fields", () => {
    const rows = parseTransactionCsv(
      'transaction_id,amount,status\n"abc,def",1,matched',
    );
    expect(rows[0]?.transactionId).toBe("abc,def");
  });

  it("federation merge dedupes hashes and enforces byte budget", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const policy: FederationPolicyDecision = { kind: "allow", reason: "ok", policyVersion: "v1" };
    const base = (id: string, handle: string): FederationSourceOutcome => ({
      outcomeId: id,
      federationRunId: "run",
      sourceId: handle,
      sourceHandle: handle,
      sourceKind: "memory",
      outcome: "success",
      reasonCode: "ok",
      policyDecision: policy,
      policyVersion: "v1",
      resultCount: 1,
      resultBytes: 1,
      durationMs: 1,
      requestHash: null,
      responseHash: null,
      payloadHash: null,
      scopeHash: "sha256:s",
      metadata: {},
    });
    const items = new Map<string, Array<{ id: string; content: string; score: number; canonicalHash: string }>>();
    items.set("A", [{ id: "1", content: "d", score: 0.5, canonicalHash: "sha256:same" }]);
    items.set("B", [{ id: "2", content: "d", score: 0.5, canonicalHash: "sha256:same" }]);
    const dup = mergeFederatedPack(db, {
      tenantId: "default-tenant",
      federationRunId: "run-d",
      outcomes: [base("A", "a"), base("B", "b")],
      scopeHash: "sha256:s",
      budget: { maxItems: 10, maxBytes: 9999, hopCount: 1 },
      itemsByOutcome: items,
    });
    expect(dup.items[0]?.duplicateCount).toBe(1);

    items.set("BIG", [
      { id: "b1", content: "x".repeat(300), score: 1, canonicalHash: "sha256:1" },
      { id: "b2", content: "y".repeat(300), score: 1, canonicalHash: "sha256:2" },
    ]);
    const over = mergeFederatedPack(db, {
      tenantId: "default-tenant",
      federationRunId: "run-o",
      outcomes: [base("BIG", "big")],
      scopeHash: "sha256:s",
      budget: { maxItems: 10, maxBytes: 400, hopCount: 1 },
      itemsByOutcome: items,
    });
    expect(over.boundStatus).toBe("over_budget");
    db.close();
  });

  it("BudgetTracker enforces deadline", () => {
    vi.useFakeTimers();
    const tracker = new BudgetTracker({
      sourceCount: 5,
      perSourceResultCount: 5,
      globalResultCount: 10,
      hops: 1,
      fanout: 2,
      maxBytes: 1000,
      maxCalls: 10,
      deadlineMs: 40,
    });
    tracker.startSource("a");
    vi.advanceTimersByTime(50);
    const late = tracker.startSource("b");
    expect(late.ok).toBe(false);
  });

  it("owner-gate rejects missing ownerId", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(() =>
      checkOwnerGate(db, {
        assetType: "skill",
        assetId: "skill-2",
        requestingAgentId: "agent-1",
        ownerId: "",
      }),
    ).toThrow(/ownerId/);
    db.close();
  });

  it("erasure tombstone lists DSAR markers", () => {
    const db = new Database(":memory:");
    initSchema(db);
    tombstoneUserForDsar(db, {
      tenantId: "default-tenant",
      userId: "user-1",
      tombstonedBy: "operator",
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(listErasureTombstones(db, { tenantId: "default-tenant", reason: "dsar" }).length).toBeGreaterThan(0);
    db.close();
  });
});
