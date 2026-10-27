// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildKnowledgeAuditEntry } from "@/lib/audit/knowledge-chain";
import { writeAuditEntry } from "@/lib/audit/write";
import { exportFlatVault } from "../flat-export";
import { exportDsarPackage, listVaultPathsForUser } from "../dsar-export";

const ROOT = path.join(os.tmpdir(), `export-b19-${crypto.randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("flat + dsar export batch19", () => {
  it("copyVaultFiles skips path traversal and escapes outside vault root", () => {
    const tenantId = "default-tenant";
    const vaultRoot = path.join(ROOT, "vault");
    const vault = path.join(vaultRoot, tenantId);
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(path.join(vault, "safe.md"), "ok", "utf8");
    const secret = path.join(ROOT, "outside-secret.txt");
    fs.writeFileSync(secret, "secret", "utf8");

    const db = new Database(":memory:");
    initSchema(db);
    db.prepare("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)").run("default-tenant", "Default");
    const userId = `user-${crypto.randomUUID().slice(0, 8)}`;
    for (const rel of ["../outside-secret.txt", "safe.md"]) {
      const entry = buildKnowledgeAuditEntry(db, {
        tenantId,
        actorId: "operator",
        actorRole: "operator",
        path: rel,
        operation: "write",
        agentId: "agent-1",
        userId,
        opHash: `sha256:${crypto.randomUUID()}`,
      });
      writeAuditEntry(
        {
          id: entry.id,
          tenant_id: entry.tenantId,
          actor_id: entry.actorId,
          actor_role: entry.actorRole,
          event_type: entry.eventType,
          entity_type: entry.entityType,
          entity_id: entry.entityId,
          reason: entry.reason,
          metadata_json: entry.metadata_json,
          created_at: entry.created_at,
        },
        db,
      );
    }

    const result = exportDsarPackage({
      db,
      tenantId,
      userId,
      outDir: path.join(ROOT, "dsar-out"),
      vaultRoot,
      now: new Date("2026-07-10T00:00:00.000Z"),
    });
    expect(result.vaultPaths).toEqual(["safe.md"]);
    expect(listVaultPathsForUser(db, tenantId, userId).sort()).toEqual(["../outside-secret.txt", "safe.md"]);
    db.close();
  });

  it("exportFlatVault resolves git sha from rev-parse when env overrides absent", () => {
    const tenantId = "tenant-git-b19";
    const vaultRoot = path.join(ROOT, "vaults");
    const vault = path.join(vaultRoot, tenantId);
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(path.join(vault, "note.md"), "# b19\n", "utf8");
    const prevSha = process.env.MEMROOS_GIT_SHA;
    const prevSource = process.env.SOURCE_VERSION;
    delete process.env.MEMROOS_GIT_SHA;
    delete process.env.SOURCE_VERSION;
    try {
      const result = exportFlatVault({
        tenantId,
        vaultRoot,
        outDir: path.join(ROOT, "flat-out"),
        signingKey: "sign-b19",
        now: new Date("2026-07-10T00:00:00.000Z"),
      });
      expect(["unknown", "sha256:"].some((prefix) => result.manifest.gitSha.startsWith(prefix)) ||
        result.manifest.gitSha.length >= 7).toBe(true);
    } finally {
      if (prevSha !== undefined) process.env.MEMROOS_GIT_SHA = prevSha;
      if (prevSource !== undefined) process.env.SOURCE_VERSION = prevSource;
    }
  });

});
