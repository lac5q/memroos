// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runConsolidationCycle, type ConsolidationSourceRow } from "../consolidation";

const VAULT_ROOT = path.join(os.tmpdir(), `consolidation-b31-${crypto.randomUUID()}`);

function freshDb(): Database.Database {
  fs.mkdirSync(VAULT_ROOT, { recursive: true });
  vi.stubEnv("MEMROOS_VAULT_ROOT", VAULT_ROOT);
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function makeSource(overrides: Partial<ConsolidationSourceRow> = {}): ConsolidationSourceRow {
  return {
    canonicalId: overrides.canonicalId ?? `canon-b31-${crypto.randomUUID().slice(0, 8)}`,
    recordType: "message",
    recordId: "1",
    content: "batch31 consolidation source",
    contentHash: crypto.createHash("sha256").update("batch31-body").digest("hex"),
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

describe("memory consolidation batch31 — vault replay and durability guard", () => {
  it("recordVaultFailure no-ops when memory_vault_durability is absent (line 558)", async () => {
    vi.resetModules();
    const vaultWriter = await import("@/lib/vault/writer");
    const originalWrite = vaultWriter.writeVaultArtifact;
    const writeSpy = vi.spyOn(vaultWriter, "writeVaultArtifact").mockImplementation((dbHandle, opts) => {
      const written = originalWrite(dbHandle, opts);
      const row = dbHandle
        .prepare("SELECT artifact_path FROM raw_artifacts WHERE id = ?")
        .get(written.id) as { artifact_path: string };
      const absolute = path.join(VAULT_ROOT, "default-tenant", row.artifact_path);
      fs.writeFileSync(absolute, Buffer.from("tampered-batch31"));
      return written;
    });

    const database = freshDb();
    database.exec("DROP TABLE IF EXISTS memory_vault_durability");
    const source = makeSource();
    const { runConsolidationCycle: runCycle } = await import("../consolidation");
    const result = await runCycle(database, {
      runKey: `run-no-dur-b31-${crypto.randomUUID().slice(0, 8)}`,
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [source],
      actorId: "operator",
    });

    writeSpy.mockRestore();
    expect(result.status).toBe("failed");
    expect(result.failureReason).toMatch(/vault_replay_failed/);
    const durability = database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_vault_durability'")
      .get();
    expect(durability).toBeUndefined();
    database.close();
  });
});
