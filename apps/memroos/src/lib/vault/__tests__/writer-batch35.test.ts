// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "node:zlib";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { readVaultArtifact, writeVaultArtifact } from "../writer";

type ZstdModule = typeof zlib & {
  zstdCompressSync?: (buffer: Buffer) => Buffer;
  zstdDecompressSync?: (buffer: Buffer) => Buffer;
};

describe("vault writer batch35", () => {
  let vaultRoot: string;

  afterEach(() => {
    if (vaultRoot) fs.rmSync(vaultRoot, { recursive: true, force: true });
    delete process.env.MEMROOS_VAULT_ROOT;
    vi.restoreAllMocks();
  });

  it("writeVaultArtifact requires zstdCompressSync (61)", () => {
    const mod = zlib as ZstdModule;
    const original = mod.zstdCompressSync;
    Object.defineProperty(mod, "zstdCompressSync", { value: undefined, configurable: true });
    const db = new Database(":memory:");
    initSchema(db);
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `vault-b35-zstd-${randomUUID()}-`));
    process.env.MEMROOS_VAULT_ROOT = vaultRoot;
  try {
      expect(() =>
        writeVaultArtifact(db, {
          tenantId: "default-tenant",
          sourceType: "test",
          body: "batch35 zstd missing",
        }),
      ).toThrow(/zstdCompressSync/);
    } finally {
      Object.defineProperty(mod, "zstdCompressSync", { value: original, configurable: true });
      db.close();
    }
  });

  it("readVaultArtifact requires zstdDecompressSync (67)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `vault-b35-read-${randomUUID()}-`));
    process.env.MEMROOS_VAULT_ROOT = vaultRoot;
    const written = writeVaultArtifact(db, {
      tenantId: "default-tenant",
      sourceType: "test",
      body: `batch35 body ${randomUUID()}`,
    });
    const mod = zlib as ZstdModule;
    const original = mod.zstdDecompressSync;
    Object.defineProperty(mod, "zstdDecompressSync", { value: undefined, configurable: true });
    try {
      expect(() => readVaultArtifact(db, written.id)).toThrow(/zstdDecompressSync/);
    } finally {
      Object.defineProperty(mod, "zstdDecompressSync", { value: original, configurable: true });
      db.close();
    }
  });
});
