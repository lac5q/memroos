// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runConsolidationCycle, type ConsolidationSourceRow } from "../consolidation";

const VAULT_ROOT = path.join(os.tmpdir(), `consolidation-b30b-${crypto.randomUUID()}`);

function freshDb(): Database.Database {
  fs.mkdirSync(VAULT_ROOT, { recursive: true });
  vi.stubEnv("MEMROOS_VAULT_ROOT", VAULT_ROOT);
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function makeSource(overrides: Partial<ConsolidationSourceRow> = {}): ConsolidationSourceRow {
  return {
    canonicalId: overrides.canonicalId ?? `canon-b30b-${crypto.randomUUID().slice(0, 8)}`,
    recordType: "message",
    recordId: "1",
    content: "batch30b consolidation source",
    contentHash: crypto.createHash("sha256").update("batch30b-body").digest("hex"),
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

describe("memory consolidation batch30b — vault replay mismatch and helpers", () => {
  it("fails when vault replay hash mismatches stored hash (lines 338–343)", async () => {
    vi.resetModules();
    const vaultWriter = await import("@/lib/vault/writer");
    const originalWrite = vaultWriter.writeVaultArtifact;
    const writeSpy = vi.spyOn(vaultWriter, "writeVaultArtifact").mockImplementation((dbHandle, opts) => {
      const written = originalWrite(dbHandle, opts);
      const row = dbHandle
        .prepare("SELECT artifact_path FROM raw_artifacts WHERE id = ?")
        .get(written.id) as { artifact_path: string };
      const absolute = path.join(VAULT_ROOT, "default-tenant", row.artifact_path);
      fs.writeFileSync(absolute, Buffer.from("tampered-batch30b"));
      return written;
    });

    const database = freshDb();
    const source = makeSource();
    const { runConsolidationCycle: runCycle } = await import("../consolidation");
    const result = await runCycle(database, {
      runKey: `run-replay-b30b-${crypto.randomUUID().slice(0, 8)}`,
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [source],
      actorId: "operator",
    });

    writeSpy.mockRestore();
    expect(result.status).toBe("failed");
    expect(result.failureReason).toMatch(/vault_replay_failed/);
    const durability = database
      .prepare("SELECT replay_state, failure_reason FROM memory_vault_durability ORDER BY created_at DESC LIMIT 1")
      .get() as { replay_state: string; failure_reason: string } | undefined;
    expect(durability?.replay_state).toBe("failed");
    database.close();
  });

  it("persistRunRow no-ops when memory_consolidation_summaries is absent (line 509)", async () => {
    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_consolidation_summaries");
    const source = makeSource();
    const result = await runConsolidationCycle(database, {
      runKey: `run-no-table-b30b-${crypto.randomUUID().slice(0, 8)}`,
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [source],
      actorId: "operator",
      provider: async () => {
        throw new Error("provider-batch30b");
      },
    });
    expect(result.status).toBe("failed");
    expect(result.failureReason).toMatch(/provider_failed/);
    database.close();
  });
});
