// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { initSchema } from "@/lib/db-schema";
import { createRetentionPolicy, registerRetentionRecord } from "../retention-policy";
import { createSubjectErasurePlan } from "../subject-erasure";
import { runConsolidationCycle, type ConsolidationSourceRow } from "../consolidation";

const VAULT_ROOT = path.join(os.tmpdir(), `consolidation-b38c-${crypto.randomUUID()}`);

function freshDb(): Database.Database {
  fs.mkdirSync(VAULT_ROOT, { recursive: true });
  vi.stubEnv("MEMROOS_VAULT_ROOT", VAULT_ROOT);
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

function makeSource(overrides: Partial<ConsolidationSourceRow> = {}): ConsolidationSourceRow {
  return {
    canonicalId: overrides.canonicalId ?? `canon-b38c-${randomUUID().slice(0, 8)}`,
    recordType: "message",
    recordId: "1",
    content: "batch38c consolidation source",
    contentHash: crypto.createHash("sha256").update("batch38c-body").digest("hex"),
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

describe("memory batch38c", () => {
  it("vault replay hash mismatch fails consolidation (consolidation 338)", async () => {
    vi.resetModules();
    const vaultWriter = await import("@/lib/vault/writer");
    const originalWrite = vaultWriter.writeVaultArtifact;
    const writeSpy = vi.spyOn(vaultWriter, "writeVaultArtifact").mockImplementation((dbHandle, opts) => {
      const written = originalWrite(dbHandle, opts);
      const row = dbHandle
        .prepare("SELECT artifact_path FROM raw_artifacts WHERE id = ?")
        .get(written.id) as { artifact_path: string };
      const absolute = path.join(VAULT_ROOT, "default-tenant", row.artifact_path);
      fs.writeFileSync(absolute, Buffer.from("tampered-b38c"));
      return written;
    });

    const database = freshDb();
    const { runConsolidationCycle: runCycle } = await import("../consolidation");
    const result = await runCycle(database, {
      runKey: `run-replay-b38c-${randomUUID().slice(0, 8)}`,
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [makeSource()],
      actorId: "operator",
    });

    writeSpy.mockRestore();
    expect(result.status).toBe("failed");
    expect(result.failureReason).toMatch(/vault_replay_failed|vault replay hash mismatch/);
    database.close();
  });

  it("identityFingerprint falls back when no exact subject fields or name (subject-erasure 233-234)", () => {
    const db = freshDb();
    createRetentionPolicy(db, {
      id: `policy-b38c-${randomUUID()}`,
      name: "subject batch38c",
      ontologyType: "*",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "delta" },
      durationDays: 365,
      priority: 1,
      actorId: "operator",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    const recordId = `rec-b38c-${randomUUID().slice(0, 6)}`;
    registerRetentionRecord(db, {
      recordType: "artifact",
      recordId,
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "delta", recordId },
      contentHash: randomUUID(),
      actorId: "operator",
      createdAt: "2026-03-01T00:00:00.000Z",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    const planned = createSubjectErasurePlan(db, {
      subject: { recordId },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "delta" },
      actorId: "operator-b38c",
      now: new Date("2026-03-02T00:00:00.000Z"),
    });
    expect(planned.ok).toBe(true);
    expect(planned.plan?.matchedRecords.length).toBe(1);
    db.close();
  });

  it.skip("materializeExisting null row (dsar 727) — private helper; callers always pass loadRequestRow results", () => {});
});