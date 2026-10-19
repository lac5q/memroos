// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildKnowledgeAuditEntry } from "@/lib/audit/knowledge-chain";
import { writeAuditEntry } from "@/lib/audit/write";
import {
  deleteDsarUser,
  exportDsarPackage,
  listVaultPathsForUser,
} from "@/lib/export/dsar-export";

let tmpRoot: string;
let db: Database.Database;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dsar-export-"));
  db = new Database(":memory:");
  initSchema(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function seedKnowledgeWrite(
  database: Database.Database,
  opts: { tenantId: string; userId: string; path: string }
): void {
  const entry = buildKnowledgeAuditEntry(database, {
    tenantId: opts.tenantId,
    actorId: "operator-1",
    actorRole: "operator",
    path: opts.path,
    operation: "write",
    agentId: "agent-1",
    userId: opts.userId,
    opHash: `sha256:${crypto.createHash("sha256").update(opts.path).digest("hex")}`,
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
    database
  );
}

describe("dsar-export (ENTOPS-08)", () => {
  it("ignores malformed audit metadata when listing vault paths", () => {
    db.prepare(
      `INSERT INTO audit_entries (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "bad-meta",
      "default-tenant",
      "operator",
      "operator",
      "knowledge_access",
      "knowledge",
      "k1",
      null,
      "{not-json",
      new Date().toISOString()
    );
    expect(listVaultPathsForUser(db, "default-tenant", "operator")).toEqual([]);
  });

  it("lists vault paths authored by the user from knowledge audit", () => {
    seedKnowledgeWrite(db, {
      tenantId: "default-tenant",
      userId: "user-a",
      path: "shared/notes.md",
    });
    seedKnowledgeWrite(db, {
      tenantId: "default-tenant",
      userId: "user-b",
      path: "private/other.md",
    });
    const paths = listVaultPathsForUser(db, "default-tenant", "user-a");
    expect(paths).toEqual(["shared/notes.md"]);
  });

  it("skips vault paths that escape the tenant root", () => {
    seedKnowledgeWrite(db, {
      tenantId: "default-tenant",
      userId: "user-escape",
      path: "../outside.md",
    });
    const vaultRoot = path.join(tmpRoot, "knowledge-escape");
    fs.mkdirSync(path.join(vaultRoot, "tenants", "default-tenant"), { recursive: true });
    const result = exportDsarPackage({
      tenantId: "default-tenant",
      userId: "user-escape",
      outDir: path.join(tmpRoot, "out-traversal"),
      vaultRoot,
      db,
      now: new Date("2026-07-16T21:00:00.000Z"),
    });
    expect(result.fileCount).toBe(0);
    expect(result.vaultPaths).toEqual([]);
  });

  it("exportDsarPackage archives vault files + audit NDJSON", () => {
    const vaultRoot = path.join(tmpRoot, "knowledge");
    const tenantVault = path.join(vaultRoot, "tenants", "default-tenant");
    fs.mkdirSync(path.join(tenantVault, "shared"), { recursive: true });
    fs.writeFileSync(path.join(tenantVault, "shared", "notes.md"), "# notes\n");

    seedKnowledgeWrite(db, {
      tenantId: "default-tenant",
      userId: "user-a",
      path: "shared/notes.md",
    });

    const result = exportDsarPackage({
      tenantId: "default-tenant",
      userId: "user-a",
      outDir: path.join(tmpRoot, "out"),
      vaultRoot,
      db,
      now: new Date("2026-07-16T21:00:00.000Z"),
    });

    expect(fs.existsSync(result.archivePath)).toBe(true);
    expect(result.fileCount).toBe(1);
    expect(result.auditEntryCount).toBeGreaterThanOrEqual(1);
    expect(result.vaultPaths).toContain("shared/notes.md");
    expect(fs.existsSync(result.manifestPath)).toBe(true);
  });

  it("lists vault paths for read and delete knowledge audit operations", () => {
    seedKnowledgeWrite(db, {
      tenantId: "default-tenant",
      userId: "user-read",
      path: "shared/read.md",
    });
    const readEntry = buildKnowledgeAuditEntry(db, {
      tenantId: "default-tenant",
      actorId: "operator-1",
      actorRole: "operator",
      path: "shared/deleted.md",
      operation: "delete",
      agentId: "agent-1",
      userId: "user-read",
      opHash: "sha256:abc",
    });
    writeAuditEntry(
      {
        id: readEntry.id,
        tenant_id: readEntry.tenantId,
        actor_id: readEntry.actorId,
        actor_role: readEntry.actorRole,
        event_type: readEntry.eventType,
        entity_type: readEntry.entityType,
        entity_id: readEntry.entityId,
        reason: readEntry.reason,
        metadata_json: readEntry.metadata_json,
        created_at: readEntry.created_at,
      },
      db
    );
    expect(listVaultPathsForUser(db, "default-tenant", "user-read").sort()).toEqual([
      "shared/deleted.md",
      "shared/read.md",
    ]);
  });

  it("exportDsarPackage skips non-file vault paths during copy", () => {
    const vaultRoot = path.join(tmpRoot, "knowledge-nonfile");
    const tenantVault = path.join(vaultRoot, "tenants", "default-tenant");
    fs.mkdirSync(path.join(tenantVault, "shared"), { recursive: true });
    fs.writeFileSync(path.join(tenantVault, "shared", "notes.md"), "# notes\n");

    seedKnowledgeWrite(db, {
      tenantId: "default-tenant",
      userId: "user-dir",
      path: "shared",
    });
    seedKnowledgeWrite(db, {
      tenantId: "default-tenant",
      userId: "user-dir",
      path: "shared/notes.md",
    });

    const result = exportDsarPackage({
      tenantId: "default-tenant",
      userId: "user-dir",
      outDir: path.join(tmpRoot, "out-nonfile"),
      vaultRoot,
      db,
      now: new Date("2026-07-16T21:00:00.000Z"),
    });
    expect(result.fileCount).toBe(1);
    expect(result.vaultPaths).toEqual(["shared/notes.md"]);
  });

  it("deleteDsarUser tombstones without removing audit rows", () => {
    seedKnowledgeWrite(db, {
      tenantId: "default-tenant",
      userId: "user-del",
      path: "x.md",
    });
    const before = (
      db.prepare("SELECT COUNT(*) AS c FROM audit_entries").get() as { c: number }
    ).c;

    const result = deleteDsarUser({
      tenantId: "default-tenant",
      userId: "user-del",
      tombstonedBy: "admin",
      db,
    });

    expect(result.auditRowsPreserved).toBe(true);
    expect(result.tombstones.length).toBeGreaterThanOrEqual(1);
    const after = (
      db.prepare("SELECT COUNT(*) AS c FROM audit_entries").get() as { c: number }
    ).c;
    expect(after).toBe(before);

    const tombs = db
      .prepare("SELECT entity_id, reason FROM erasure_tombstones WHERE entity_id = ?")
      .all("user-del") as Array<{ entity_id: string; reason: string }>;
    expect(tombs.length).toBeGreaterThanOrEqual(1);
    expect(tombs.every((t) => t.reason === "dsar")).toBe(true);
  });
});
