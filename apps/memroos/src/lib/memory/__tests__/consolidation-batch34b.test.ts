// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runConsolidationCycle, type ConsolidationSourceRow } from "../consolidation";

const VAULT_ROOT = path.join(os.tmpdir(), `consolidation-b34b-${crypto.randomUUID()}`);

function freshDb(): Database.Database {
  fs.mkdirSync(VAULT_ROOT, { recursive: true });
  vi.stubEnv("MEMROOS_VAULT_ROOT", VAULT_ROOT);
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function makeSource(overrides: Partial<ConsolidationSourceRow> = {}): ConsolidationSourceRow {
  return {
    canonicalId: overrides.canonicalId ?? `canon-b34b-${crypto.randomUUID().slice(0, 8)}`,
    recordType: "message",
    recordId: "1",
    content: "batch34b consolidation source",
    contentHash: crypto.createHash("sha256").update("batch34b-body").digest("hex"),
    ontologyType: "memroos.Message",
    tier: "episodic",
    classification: { visibility: "internal", policy: "sealed" },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("consolidation batch34b — branch gaps", () => {
  it("accepts ISO string now values via toIso (line 104)", async () => {
    const database = freshDb();
    const source = makeSource();
    const result = await runConsolidationCycle(database, {
      runKey: `run-iso-b34b-${crypto.randomUUID().slice(0, 6)}`,
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [source],
      actorId: "system",
      now: "2026-07-01T12:00:00.000Z" as unknown as Date,
    });
    expect(result.startedAt).toBe("2026-07-01T12:00:00.000Z");
    expect(result.status).not.toBe("policy_blocked");
    database.close();
  });

  it("uses default classification when fields are absent (line 110)", async () => {
    const database = freshDb();
    const source = makeSource({ classification: {} });
    const result = await runConsolidationCycle(database, {
      runKey: `run-class-b34b-${crypto.randomUUID().slice(0, 6)}`,
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [source],
      actorId: "operator",
    });
    expect(result.status).toBe("completed");
    database.close();
  });

  it("records vault_write_failed for non-Error throws (line 325)", async () => {
    vi.resetModules();
    const vaultWriter = await import("@/lib/vault/writer");
    vi.spyOn(vaultWriter, "writeVaultArtifact").mockImplementation(() => {
      throw "disk_full_string";
    });
    const database = freshDb();
    const { runConsolidationCycle: runCycle } = await import("../consolidation");
    const result = await runCycle(database, {
      runKey: `run-vault-str-b34b`,
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [makeSource()],
      actorId: "operator",
    });
    expect(result.failureReason).toBe("vault_write_failed:disk_full_string");
    database.close();
  });

  it("records provider_failed for non-Error provider throws (line 370)", async () => {
    const database = freshDb();
    const result = await runConsolidationCycle(database, {
      runKey: `run-prov-str-b34b`,
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [makeSource()],
      actorId: "operator",
      provider: async () => {
        throw "provider_down";
      },
    });
    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("provider_failed:provider_down");
    database.close();
  });

  it("returns completed_replayed on duplicate lineage insert (line 465)", async () => {
    const database = freshDb();
    const source = makeSource({ contentHash: "fixed-lineage-b34b" });
    const scope = { tenantId: "default-tenant", purpose: "recall" };
    const first = await runConsolidationCycle(database, {
      runKey: "run-dup-a-b34b",
      scope,
      sources: [source],
      actorId: "operator",
    });
    expect(first.status).toBe("completed");

    const originalPrepare = database.prepare.bind(database);
    let insertAttempts = 0;
    vi.spyOn(database, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO memory_consolidation_summaries")) {
        insertAttempts += 1;
        if (insertAttempts > 1) {
          return {
            run: () => {
              throw new Error("UNIQUE constraint failed: memory_consolidation_summaries.lineage_hash");
            },
          } as ReturnType<typeof database.prepare>;
        }
      }
      return originalPrepare(sql);
    });

    const second = await runConsolidationCycle(database, {
      runKey: "run-dup-b-b34b",
      scope,
      sources: [source],
      actorId: "operator",
    });
    expect(second.status).toBe("completed_replayed");
    expect(second.failureReason).toBe("duplicate_lineage");
    database.close();
  });

  it("vault replay failure preserves failed status on receipt write errors (lines 544–546)", async () => {
    vi.resetModules();
    const vaultReader = await import("@/lib/vault/writer");
    vi.spyOn(vaultReader, "readVaultArtifact").mockImplementation(() => {
      throw "replay_broken";
    });
    const audit = await import("@/lib/audit/memory-chain");
    vi.spyOn(audit, "writeChainedMemoryAuditEntry").mockImplementation(() => {
      throw new Error("audit unavailable");
    });

    const database = freshDb();
    const { runConsolidationCycle: runCycle } = await import("../consolidation");
    const result = await runCycle(database, {
      runKey: `run-receipt-failed-b34b`,
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [makeSource()],
      actorId: "operator",
    });
    expect(result.status).toBe("failed");
    expect(result.failureReason).toMatch(/receipt_failure:audit unavailable/);
    database.close();
  });
});
