// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildKnowledgeAuditEntry } from "@/lib/audit/knowledge-chain";
import { writeAuditEntry } from "@/lib/audit/write";
import { exportFlatVault, resolveTenantVaultPath, verifyFlatExportManifest } from "../flat-export";
import { deleteDsarUser, exportDsarPackage, listVaultPathsForUser } from "../dsar-export";

const ROOT = path.join(os.tmpdir(), `export-b18b-${crypto.randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("flat + dsar export batch18b", () => {
  it("resolveTenantVaultPath prefers flat tenant directory when tenants layout missing", () => {
    const tenantId = "flat-only-tenant";
    const vaultRoot = path.join(ROOT, "vault-root");
    const flat = path.join(vaultRoot, tenantId);
    fs.mkdirSync(flat, { recursive: true });
    expect(resolveTenantVaultPath(tenantId, vaultRoot)).toBe(flat);
  });

  it("verifyFlatExportManifest rejects tampered signature", () => {
    const tenantId = "tenant-verify-b18b";
    const vault = path.join(ROOT, "tenants", tenantId);
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(path.join(vault, "note.md"), "# note\n", "utf8");
    const result = exportFlatVault({
      tenantId,
      vaultRoot: path.join(ROOT, "tenants"),
      outDir: path.join(ROOT, "out"),
      gitSha: "sha-b18b",
      signingKey: "sign-b18b",
      now: new Date("2026-07-10T00:00:00.000Z"),
    });
    const tampered = { ...result.manifest, fileCount: result.manifest.fileCount + 99 };
    expect(verifyFlatExportManifest(tampered, "sign-b18b")).toBe(false);
    expect(verifyFlatExportManifest(result.manifest, "sign-b18b")).toBe(true);
  });

  it("listVaultPathsForUser skips malformed audit metadata", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const userId = `user-${crypto.randomUUID().slice(0, 8)}`;
    writeAuditEntry(
      {
        tenant_id: "default-tenant",
        actor_id: "operator",
        actor_role: "operator",
        event_type: "knowledge.access",
        entity_type: "knowledge_document",
        entity_id: "doc:bad",
        reason: "write",
        metadata_json: "{not-json",
        created_at: new Date().toISOString(),
      },
      db,
    );
    expect(listVaultPathsForUser(db, "default-tenant", userId)).toEqual([]);
    db.close();
  });

  it("deleteDsarUser tombstones without deleting audit rows", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const userId = `user-${crypto.randomUUID().slice(0, 8)}`;
    const entry = buildKnowledgeAuditEntry(db, {
      tenantId: "default-tenant",
      actorId: "operator",
      actorRole: "operator",
      path: "docs/x.md",
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
    const del = deleteDsarUser({
      db,
      tenantId: "default-tenant",
      userId,
      tombstonedBy: "operator",
      now: new Date("2026-07-10T00:00:00.000Z"),
    });
    expect(del.auditRowsPreserved).toBe(true);
    expect(del.tombstones.length).toBeGreaterThan(0);
    const auditCount = db.prepare("SELECT COUNT(*) AS c FROM audit_entries").get() as { c: number };
    expect(auditCount.c).toBeGreaterThan(0);
    db.close();
  });

  it("exportDsarPackage defaults tenantId when blank", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const userId = `user-${crypto.randomUUID().slice(0, 8)}`;
    const outDir = path.join(ROOT, "dsar-default-tenant");
    const result = exportDsarPackage({
      db,
      tenantId: "   ",
      userId,
      outDir,
      now: new Date("2026-07-10T00:00:00.000Z"),
    });
    expect(fs.existsSync(result.archivePath)).toBe(true);
    expect(result.manifestPath).toContain("default-tenant");
    db.close();
  });
});
