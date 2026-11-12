// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  listVaultArtifacts,
  readVaultArtifact,
  VaultHashMismatchError,
  writeVaultArtifact,
} from "../writer";

describe("vault writer batch34", () => {
  let db: Database.Database;
  let vaultRoot: string;

  afterEach(() => {
    db?.close();
    if (vaultRoot) fs.rmSync(vaultRoot, { recursive: true, force: true });
    delete process.env.MEMROOS_VAULT_ROOT;
  });

  it("readVaultArtifact rejects tampered ciphertext (61, 67, 197-203)", () => {
    db = new Database(":memory:");
    initSchema(db);
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `vault-b34-${randomUUID()}-`));
    process.env.MEMROOS_VAULT_ROOT = vaultRoot;
    const body = `tamper-b34-${randomUUID()}`;
    const written = writeVaultArtifact(db, {
      tenantId: "default-tenant",
      sourceType: "test",
      body,
      label: { visibility: "private", policy: "sealed", sensitivity: "pii" },
    });
    db.prepare("UPDATE raw_artifacts SET content_hash = ? WHERE id = ?").run("deadbeef".repeat(8), written.id);
    expect(() => readVaultArtifact(db, written.id)).toThrow(VaultHashMismatchError);
  });

  it("listVaultArtifacts paginates with cursor and default labels (234, 254-258)", () => {
    db = new Database(":memory:");
    initSchema(db);
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `vault-list-b34-${randomUUID()}-`));
    process.env.MEMROOS_VAULT_ROOT = vaultRoot;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const written = writeVaultArtifact(db, {
        tenantId: "tenant-b34",
        sourceType: "test",
        body: `page-b34-${i}-${randomUUID()}`,
      });
      ids.push(written.id);
    }
    const page1 = listVaultArtifacts(db, { tenantId: "tenant-b34", limit: 2 });
    expect(page1.artifacts).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    expect(page1.artifacts[0].label.policy).toBe("sealed");
    expect(page1.artifacts.every((a) => a.label.visibility === "private")).toBe(true);
  });
});
