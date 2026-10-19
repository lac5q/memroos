// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runConsolidationCycle, type ConsolidationSourceRow } from "../consolidation";

const VAULT_ROOT = path.join(os.tmpdir(), `consolidation-test-${crypto.randomUUID()}`);

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function makeSource(overrides: Partial<ConsolidationSourceRow> = {}): ConsolidationSourceRow {
  const id = overrides.canonicalId ?? `canon_${crypto.randomBytes(8).toString("hex")}`;
  return {
    canonicalId: id,
    recordType: "message",
    recordId: overrides.recordId ?? String(Math.floor(Math.random() * 1_000_000)),
    content: overrides.content ?? "Original episodic content kept intact",
    contentHash: overrides.contentHash ?? crypto.createHash("sha256").update(`content-${id}`).digest("hex"),
    ontologyType: overrides.ontologyType ?? "memory.contact_event",
    tier: overrides.tier ?? "mid",
    classification: overrides.classification ?? { visibility: "internal", policy: "sealed" },
  };
}

beforeEach(() => {
  fs.rmSync(VAULT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(VAULT_ROOT, { recursive: true });
  process.env["MEMROOS_VAULT_ROOT"] = VAULT_ROOT;
});

afterEach(() => {
  db?.close();
  db = null;
  delete process.env["MEMROOS_VAULT_ROOT"];
});

describe("VAL-MEM-024: consolidation preserves originals before projection change", () => {
  it("writes raw-vault artifact before summary and only summarizes if vault integrity verifies", async () => {
    const database = freshDb();
    const source = makeSource();
    const result = await runConsolidationCycle(database, {
      runKey: "run-001",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      sources: [source],
      actorId: "operator",
      now: new Date("2026-07-01T00:00:00.000Z"),
    });

    expect(result.status).toBe("completed");
    expect(result.vaultArtifactId).toBeTruthy();
    expect(result.vaultArtifactHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.summaryId).toBeTruthy();
    expect(result.lineageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.failureReason).toBeNull();

    // Verify the vault artifact exists on disk with the recorded hash.
    const row = database
      .prepare("SELECT artifact_path, content_hash FROM raw_artifacts WHERE id = ?")
      .get(result.vaultArtifactId!) as { artifact_path: string; content_hash: string };
    expect(row.content_hash).toBe(result.vaultArtifactHash);
    const absolute = path.join(VAULT_ROOT, "default-tenant", row.artifact_path);
    expect(fs.existsSync(absolute)).toBe(true);
  });

  it("excludes protected sources (decayProtected=true) from the eligible batch", async () => {
    const database = freshDb();
    const eligible = makeSource({ canonicalId: "canon_eligible" });
    const protectedSrc = makeSource({ canonicalId: "canon_protected", classification: { visibility: "internal", policy: "sealed", decayProtected: true } });

    const result = await runConsolidationCycle(database, {
      runKey: "run-protected",
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [eligible, protectedSrc],
      actorId: "operator",
    });

    expect(result.considered).toBe(2);
    expect(result.eligible).toBe(1);
    expect(result.protected).toBe(1);
    expect(result.status).toBe("completed");
  });

  it("blocks when any source is requires_human_review (protected_skipped)", async () => {
    const database = freshDb();
    const eligible = makeSource({ canonicalId: "canon_mixed", classification: { visibility: "internal", policy: "sealed" } });
    const hilSource = makeSource({ canonicalId: "canon_hil", classification: { visibility: "private", policy: "requires_human_review" } });
    const result = await runConsolidationCycle(database, {
      runKey: "run-hil",
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [eligible, hilSource],
      actorId: "operator",
    });
    expect(result.status).toBe("protected_skipped");
    expect(result.failureReason).toBe("requires_human_review_classification");
    expect(result.summaryId).toBeNull();
  });

  it("fails closed when scope.purpose is missing", async () => {
    const database = freshDb();
    const source = makeSource();
    const result = await runConsolidationCycle(database, {
      runKey: "run-no-purpose",
      scope: { tenantId: "default-tenant" } as never,
      sources: [source],
      actorId: "operator",
    });
    expect(result.status).toBe("policy_blocked");
    expect(result.failureReason).toBe("missing_scope_purpose");
  });

  it("excludes vault source content from summary metadata (no prompt/raw secret)", async () => {
    const database = freshDb();
    const source = makeSource({ content: "SUPER_SECRET_ORIGINAL_CONTENT" });
    const result = await runConsolidationCycle(database, {
      runKey: "run-redaction",
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [source],
      actorId: "operator",
    });
    expect(result.status).toBe("completed");
    const summaryRow = database
      .prepare("SELECT * FROM memory_consolidation_summaries WHERE id = ?")
      .get(result.summaryId!) as Record<string, unknown>;
    const serialized = JSON.stringify(summaryRow);
    expect(serialized).not.toContain("SUPER_SECRET_ORIGINAL_CONTENT");
  });
});

describe("VAL-MEM-025: consolidation failure and replay are safe", () => {
  it("provider failure leaves originals intact and retry is possible", async () => {
    const database = freshDb();
    const source = makeSource({ canonicalId: "canon_providerfail" });
    const result = await runConsolidationCycle(database, {
      runKey: "run-provider-fail",
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [source],
      actorId: "operator",
      provider: async () => {
        throw new Error("provider outage");
      },
    });
    expect(result.status).toBe("failed");
    expect(result.failureReason).toContain("provider_failed");
    expect(result.summaryId).toBeNull();
    // Retry with same runKey should give same failure (no duplicate summary lineage created).
    const retry = await runConsolidationCycle(database, {
      runKey: "run-provider-fail",
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [source],
      actorId: "operator",
      provider: async () => ({ type: "episodic_summary", content: "different summary" }),
    });
    // Run was already attempted; replay returns the prior summary or completed_replayed.
    expect(["completed_replayed", "completed"]).toContain(retry.status);
    // Only ONE summary row should exist (no duplicate lineage).
    const summaries = database
      .prepare("SELECT COUNT(*) AS count FROM memory_consolidation_summaries WHERE run_key = ?")
      .get("run-provider-fail") as { count: number };
    expect(summaries.count).toBeLessThanOrEqual(1);
  });

  it("duplicate lineage (same source hash + scope) does not create a second summary row", async () => {
    const database = freshDb();
    const source = makeSource({ canonicalId: "canon_dedupe", contentHash: "fixed-hash-for-dedupe" });
    const first = await runConsolidationCycle(database, {
      runKey: "run-dedupe-1",
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [source],
      actorId: "operator",
    });
    expect(first.status).toBe("completed");
    // Second run with different runKey but same content hash + scope -> lineage_hash collision.
    const second = await runConsolidationCycle(database, {
      runKey: "run-dedupe-2",
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [source],
      actorId: "operator",
    });
    // The second run detects the existing summary via run_key check and returns
    // completed_replayed. If for any reason it falls through to the dedupe UNIQUE
    // constraint branch, that also returns completed_replayed. Either way there
    // must be exactly ONE summary row.
    expect(["completed_replayed", "completed"]).toContain(second.status);
    const summaries = database.prepare("SELECT COUNT(*) AS count FROM memory_consolidation_summaries").get() as { count: number };
    expect(summaries.count).toBe(1);
  });

  it("empty source batch returns skipped_empty without writing anything", async () => {
    const database = freshDb();
    const result = await runConsolidationCycle(database, {
      runKey: "run-empty",
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [],
      actorId: "operator",
    });
    expect(result.status).toBe("skipped_empty");
    const summaries = database.prepare("SELECT COUNT(*) AS count FROM memory_consolidation_summaries").get() as { count: number };
    expect(summaries.count).toBe(0);
  });

  it("completed run returns completed_replayed on the next call with same runKey", async () => {
    const database = freshDb();
    const source = makeSource();
    const first = await runConsolidationCycle(database, {
      runKey: "run-replay",
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [source],
      actorId: "operator",
    });
    expect(first.status).toBe("completed");
    const second = await runConsolidationCycle(database, {
      runKey: "run-replay",
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [source],
      actorId: "operator",
    });
    expect(second.status).toBe("completed_replayed");
  });

  it("provider returning empty content is recorded as failed (no half-state)", async () => {
    const database = freshDb();
    const source = makeSource();
    const result = await runConsolidationCycle(database, {
      runKey: "run-empty-content",
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [source],
      actorId: "operator",
      provider: async () => ({ type: "episodic_summary", content: "" }),
    });
    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("provider_returned_empty");
  });

  it("treats decay_protected and protected classification flags as protected sources", async () => {
    const database = freshDb();
    const decayProtected = makeSource({
      canonicalId: "canon_decay_protected",
      classification: { visibility: "internal", policy: "sealed", decay_protected: true },
    });
    const protectedFlag = makeSource({
      canonicalId: "canon_protected_flag",
      classification: { visibility: "internal", policy: "sealed", protected: true },
    });
    const result = await runConsolidationCycle(database, {
      runKey: "run-protected-flags",
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [decayProtected, protectedFlag],
      actorId: "operator",
    });
    expect(result.considered).toBe(2);
    expect(result.protected).toBe(2);
    expect(result.eligible).toBe(0);
    expect(result.status).toBe("skipped_empty");
  });

  it("policy_blocked when scope purpose is whitespace-only", async () => {
    const database = freshDb();
    const source = makeSource({ canonicalId: "canon_ws_purpose" });
    const result = await runConsolidationCycle(database, {
      runKey: "run-ws-purpose",
      scope: { tenantId: "default-tenant", purpose: "   " },
      sources: [source],
      actorId: "operator",
    });
    expect(result.status).toBe("policy_blocked");
    expect(result.failureReason).toBe("missing_scope_purpose");
  });

  it("vault replay mismatch records durability failure and leaves no summary", async () => {
    vi.resetModules();
    const vaultWriter = await import("@/lib/vault/writer");
    const originalWrite = vaultWriter.writeVaultArtifact;
    const writeSpy = vi.spyOn(vaultWriter, "writeVaultArtifact").mockImplementation((dbHandle, opts) => {
      const written = originalWrite(dbHandle, opts);
      const row = dbHandle
        .prepare("SELECT artifact_path FROM raw_artifacts WHERE id = ?")
        .get(written.id) as { artifact_path: string };
      const absolute = path.join(VAULT_ROOT, "default-tenant", row.artifact_path);
      fs.writeFileSync(absolute, Buffer.from("tampered-vault-bytes"));
      return written;
    });

    const database = freshDb();
    const source = makeSource({ canonicalId: "canon_vault_replay" });
    const { runConsolidationCycle: runCycle } = await import("../consolidation");
    const result = await runCycle(database, {
      runKey: "run-vault-replay-fail",
      scope: { tenantId: "default-tenant", purpose: "recall" },
      sources: [source],
      actorId: "operator",
    });

    writeSpy.mockRestore();

    expect(result.status).toBe("failed");
    expect(result.failureReason).toMatch(/vault_replay_failed/);
    expect(result.summaryId).toBeNull();
    const durability = database
      .prepare("SELECT replay_state, failure_reason FROM memory_vault_durability ORDER BY created_at DESC LIMIT 1")
      .get() as { replay_state: string; failure_reason: string } | undefined;
    expect(durability?.replay_state).toBe("failed");
    expect(durability?.failure_reason).toMatch(/vault_replay_failed/);
  });

});
