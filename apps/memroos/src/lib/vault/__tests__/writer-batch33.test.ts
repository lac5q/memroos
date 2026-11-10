// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { readVaultArtifact, writeVaultArtifact } from "../writer";

describe("vault writer batch33 — zstd compress/decompress path (61, 67)", () => {
  let db: Database.Database;
  let vaultRoot: string;

  afterEach(() => {
    db?.close();
    if (vaultRoot) fs.rmSync(vaultRoot, { recursive: true, force: true });
    delete process.env.MEMROOS_VAULT_ROOT;
  });

  it("round-trips sealed artifacts through zstd", () => {
    db = new Database(":memory:");
    initSchema(db);
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `vault-b33-${randomUUID()}-`));
    process.env.MEMROOS_VAULT_ROOT = vaultRoot;
    const body = `sealed-b33-${randomUUID()}`;
    const written = writeVaultArtifact(db, {
      tenantId: "default-tenant",
      sourceType: "test",
      body,
      label: { visibility: "private", policy: "sealed", sensitivity: "pii" },
    });
    const read = readVaultArtifact(db, written.id);
    expect(read.body.toString("utf8")).toBe(body);
  });
});
