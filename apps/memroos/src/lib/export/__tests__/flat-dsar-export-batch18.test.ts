// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildKnowledgeAuditEntry } from "@/lib/audit/knowledge-chain";
import { writeAuditEntry } from "@/lib/audit/write";
import { computeTreeHash, exportFlatVault, resolveTenantVaultPath } from "../flat-export";
import { exportDsarPackage } from "../dsar-export";

const ROOT = path.join(os.tmpdir(), `export-b18-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("flat + dsar export batch18 — empty vaults and DSAR guards", () => {
  it("computeTreeHash returns zero files when tenant vault directory is missing", () => {
    const missingVault = path.join(ROOT, "missing-tenant-vault");
    const { fileCount, treeHash } = computeTreeHash(missingVault);
    expect(fileCount).toBe(0);
    expect(treeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("exportFlatVault creates tarball for an empty tenants layout directory", () => {
    const tenantId = "tenant-empty-b18";
    resolveTenantVaultPath(tenantId, path.join(ROOT, "tenants-root"));
    const outDir = path.join(ROOT, "flat-out");
    const result = exportFlatVault({
      tenantId,
      vaultRoot: path.join(ROOT, "tenants-root"),
      outDir,
      gitSha: "sha-empty",
      signingKey: "sign-empty",
      now: new Date("2026-07-10T00:00:00.000Z"),
    });
    expect(fs.existsSync(result.archivePath)).toBe(true);
    expect(result.manifest.fileCount).toBe(0);
  });

  it("exportDsarPackage rejects blank userId", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(() =>
      exportDsarPackage({
        db,
        tenantId: "default-tenant",
        userId: "   ",
        outDir: path.join(ROOT, "dsar-out"),
      }),
    ).toThrow(/userId required/);
    db.close();
  });

  it("exportDsarPackage skips traversal paths when copying vault files", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const userId = `user-${randomUUID().slice(0, 8)}`;
    const tenantId = "default-tenant";
    const vaultRoot = path.join(ROOT, "vault-root");
    const tenantVault = path.join(vaultRoot, "tenants", tenantId, "docs");
    fs.mkdirSync(tenantVault, { recursive: true });
    fs.writeFileSync(path.join(tenantVault, "safe.md"), "# safe\n", "utf8");

    for (const rel of ["docs/safe.md", "../outside.md"]) {
      const entry = buildKnowledgeAuditEntry(db, {
        tenantId,
        actorId: "operator",
        actorRole: "operator",
        path: rel,
        operation: "write",
        agentId: "agent-1",
        userId,
        opHash: `sha256:${randomUUID()}`,
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
      outDir: path.join(ROOT, "dsar-pack"),
      vaultRoot,
      now: new Date("2026-07-10T00:00:00.000Z"),
    });
    expect(result.vaultPaths).toEqual(["docs/safe.md"]);
    expect(fs.existsSync(result.archivePath)).toBe(true);
    db.close();
  });
});
