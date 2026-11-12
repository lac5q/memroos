// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { writeVaultArtifact } from "@/lib/vault/writer";
import {
  readVaultArtifactForTenant,
  reconcileVaultDurability,
  replayVaultArtifactWithDurability,
  writeVaultArtifactWithDurability,
} from "../vault-durability";

let vaultRoot: string;
let db: Database.Database;

beforeEach(() => {
  vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `vault-b28-${randomUUID()}-`));
  process.env.MEMROOS_VAULT_ROOT = vaultRoot;
  db = new Database(":memory:");
  initSchema(db);
});

afterEach(() => {
  db.close();
  delete process.env.MEMROOS_VAULT_ROOT;
  fs.rmSync(vaultRoot, { recursive: true, force: true });
});

describe("vault-durability batch28 — tenant read guard, replay mismatch, reconcile", () => {
  it("readVaultArtifactForTenant rejects cross-tenant reads", () => {
    const written = writeVaultArtifact(db, {
      tenantId: "tenant-a",
      sourceType: "memory.test",
      body: "tenant scoped batch28",
    });
    expect(() => readVaultArtifactForTenant(db, "tenant-b", written.id)).toThrow(/tenant mismatch/);
  });

  it("replayVaultArtifactWithDurability marks hash tampering as mismatch", () => {
    const durable = writeVaultArtifactWithDurability(db, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      sourceId: `src-${randomUUID().slice(0, 8)}`,
      body: "original batch28 body",
      actorId: "operator",
    });
    db.prepare(`UPDATE raw_artifacts SET content_hash = ? WHERE id = ?`).run(`${"d".repeat(64)}`, durable.id);

    const replay = replayVaultArtifactWithDurability(db, "default-tenant", durable.id, "operator");
    expect(replay.replayState).toBe("mismatch");
    expect(replay.ok).toBe(false);
  });

  it("reconcileVaultDurability returns empty summary when durability table is missing", () => {
    db.exec("DROP TABLE memory_vault_durability");
    expect(reconcileVaultDurability(db, "default-tenant", "operator")).toEqual({
      ok: 0,
      mismatched: [],
      failed: [],
    });
  });

  it("replayVaultArtifactWithDurability throws when durability row is missing", () => {
    const written = writeVaultArtifact(db, {
      tenantId: "default-tenant",
      sourceType: "memory.test",
      body: "no durability row",
    });
    expect(() =>
      replayVaultArtifactWithDurability(db, "default-tenant", written.id, "operator"),
    ).toThrow(/durability row missing/);
  });
});
