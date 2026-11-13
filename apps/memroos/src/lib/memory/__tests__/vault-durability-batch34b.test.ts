// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { writeVaultArtifact } from "@/lib/vault/writer";
import {
  replayVaultArtifactWithDurability,
  writeVaultArtifactWithDurability,
} from "../vault-durability";

let vaultRoot: string;
let db: Database.Database;

beforeEach(() => {
  vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `vault-b34b-${randomUUID()}-`));
  process.env.MEMROOS_VAULT_ROOT = vaultRoot;
  db = new Database(":memory:");
  initSchema(db);
});

afterEach(() => {
  db.close();
  delete process.env.MEMROOS_VAULT_ROOT;
  fs.rmSync(vaultRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("vault-durability batch34b — safeSegment, parse fallback, audit catches", () => {
  it("writes artifacts under MEMROOS_VAULT_ROOT tenant folders (lines 92, 96)", () => {
    const durable = writeVaultArtifactWithDurability(db, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: `src-${randomUUID().slice(0, 8)}`,
      body: "safe segment batch34b",
      actorId: "operator",
    });
    const row = db
      .prepare("SELECT artifact_path FROM raw_artifacts WHERE id = ?")
      .get(durable.id) as { artifact_path: string };
    const absolute = path.join(vaultRoot, "default-tenant", row.artifact_path);
    expect(fs.existsSync(absolute)).toBe(true);
  });

  it("records string failures from vault writer throws (line 166)", async () => {
    const writerMod = await import("@/lib/vault/writer");
    const spy = vi.spyOn(writerMod, "writeVaultArtifact").mockImplementation(() => {
      throw "writer_string_fail";
    });
    expect(() =>
      writeVaultArtifactWithDurability(db, {
        tenantId: "default-tenant",
        sourceType: "memory.test",
        body: "fail batch34b",
        actorId: "system",
      }),
    ).toThrow(/writer_string_fail/);
    const row = db
      .prepare(`SELECT failure_reason FROM memory_vault_durability ORDER BY created_at DESC LIMIT 1`)
      .get() as { failure_reason: string };
    expect(row.failure_reason).toBe("writer_string_fail");
    spy.mockRestore();
  });

  it("loadDurabilityRow tolerates invalid classification JSON (lines 410–412)", () => {
    const written = writeVaultArtifact(db, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      body: "classification parse batch34b",
    });
    const durId = `vdr_${randomUUID()}`;
    db.prepare(
      `INSERT INTO memory_vault_durability
        (id, tenant_id, artifact_id, artifact_uri, content_hash, classification_json, label_version,
         write_state, replay_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'complete', 'complete', datetime('now'), datetime('now'))`,
    ).run(
      durId,
      "default-tenant",
      written.id,
      written.artifactUri,
      written.contentHash,
      "{not-json",
    );
    const replay = replayVaultArtifactWithDurability(db, "default-tenant", written.id, "operator");
    expect(replay.ok).toBe(true);
  });

  it("write audit failures stringify non-Error throws (lines 214, 299)", async () => {
    const audit = await import("@/lib/audit/memory-chain");
    vi.spyOn(audit, "writeChainedMemoryAuditEntry").mockImplementation(() => {
      throw "audit_post_write_string";
    });

    expect(() =>
      writeVaultArtifactWithDurability(db, {
        tenantId: "default-tenant",
        sourceType: "memory.test",
        body: "audit post write batch34b",
        actorId: "operator",
      }),
    ).toThrow(/audit_post_write_string/);

    const row = db
      .prepare(`SELECT replay_state, failure_reason FROM memory_vault_durability ORDER BY created_at DESC LIMIT 1`)
      .get() as { replay_state: string; failure_reason: string };
    expect(row.failure_reason).toContain("audit_receipt_failure:audit_post_write_string");
  });
});
