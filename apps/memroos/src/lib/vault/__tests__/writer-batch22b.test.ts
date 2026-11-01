// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { readVaultArtifact, writeVaultArtifact } from "../writer";

describe("vault writer batch22b — temp cleanup and reads", () => {
  let db: Database.Database;
  let vaultRoot: string;

  afterEach(() => {
    db?.close();
    if (vaultRoot) fs.rmSync(vaultRoot, { recursive: true, force: true });
    delete process.env.MEMROOS_VAULT_ROOT;
    vi.restoreAllMocks();
  });

  it("writeVaultArtifact removes temp files when DB insert fails", () => {
    db = new Database(":memory:");
    initSchema(db);
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `vault-b22b-${randomUUID()}-`));
    process.env.MEMROOS_VAULT_ROOT = vaultRoot;
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: unknown) => {
      const stmt = originalPrepare(sql as string);
      if (typeof sql === "string" && sql.includes("INSERT INTO raw_artifacts")) {
        return {
          run: () => {
            throw new Error("db insert failed");
          },
          get: stmt.get.bind(stmt),
          all: stmt.all.bind(stmt),
        } as ReturnType<typeof db.prepare>;
      }
      return stmt;
    });
    expect(() =>
      writeVaultArtifact(db, {
        tenantId: "default-tenant",
        sourceType: "test",
        body: "vault body",
      }),
    ).toThrow(/db insert failed/);
    const tmpFiles = fs.readdirSync(vaultRoot, { recursive: true }).filter(String).map(String);
    expect(tmpFiles.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("readVaultArtifact returns plaintext for unencrypted artifacts", () => {
    db = new Database(":memory:");
    initSchema(db);
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `vault-read-b22b-${randomUUID()}-`));
    process.env.MEMROOS_VAULT_ROOT = vaultRoot;
    const written = writeVaultArtifact(db, {
      tenantId: "default-tenant",
      sourceType: "test",
      body: "readable body",
      label: { visibility: "public", policy: "default" },
    });
    const read = readVaultArtifact(db, written.id);
    expect(read.body.toString("utf8")).toBe("readable body");
  });
});
