// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runConsolidationCycle, type ConsolidationSourceRow } from "../consolidation";

const VAULT_ROOT = path.join(os.tmpdir(), `consolidation-b15-${crypto.randomUUID()}`);

function freshDb(): Database.Database {
  fs.mkdirSync(VAULT_ROOT, { recursive: true });
  vi.stubEnv("MEMROOS_VAULT_ROOT", VAULT_ROOT);
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function makeSource(overrides: Partial<ConsolidationSourceRow> = {}): ConsolidationSourceRow {
  return {
    canonicalId: `canon-${crypto.randomUUID()}`,
    recordType: "message",
    recordId: "1",
    content: "Batch15 consolidation source content",
    contentHash: crypto.createHash("sha256").update("batch15").digest("hex"),
    ontologyType: "memroos.Message",
    tier: "episodic",
    classification: { visibility: "internal", policy: "sealed" },
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("consolidation batch15 — protected skip and summary insert failure", () => {
  it("protected_skipped when any source requires human review", async () => {
    const database = freshDb();
    const reviewSource = makeSource({
      classification: { visibility: "internal", policy: "requires_human_review" },
    });
    const result = await runConsolidationCycle(database, {
      runKey: "run-protected-review",
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [reviewSource, makeSource({ canonicalId: "canon-eligible" })],
      actorId: "operator",
    });
    expect(result.status).toBe("protected_skipped");
    expect(result.failureReason).toBe("requires_human_review_classification");
  });

  it("summary_insert_failed when summary table insert throws non-unique errors", async () => {
    vi.resetModules();
    const database = freshDb();
    const source = makeSource({ canonicalId: "canon-insert-fail" });
    database.prepare(
      `CREATE TABLE IF NOT EXISTS memory_consolidation_summaries (
         id TEXT PRIMARY KEY,
         tenant_id TEXT NOT NULL,
         run_id TEXT NOT NULL,
         run_key TEXT NOT NULL,
         lineage_hash TEXT NOT NULL,
         summary_json TEXT NOT NULL,
         created_at TEXT NOT NULL,
         UNIQUE(tenant_id, lineage_hash)
       )`,
    ).run();
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO memory_consolidation_summaries")) {
        return {
          run: () => {
            throw new Error("disk io error");
          },
        } as ReturnType<typeof database.prepare>;
      }
      return originalPrepare(sql);
    });
    const { runConsolidationCycle: runCycle } = await import("../consolidation");
    const result = await runCycle(database, {
      runKey: "run-insert-fail",
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [source],
      actorId: "operator",
    });
    expect(result.status).toBe("failed");
    expect(result.failureReason).toMatch(/summary_insert_failed/);
  });
});
