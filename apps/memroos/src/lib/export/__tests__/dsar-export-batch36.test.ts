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
import { exportDsarPackage } from "../dsar-export";

const ROOT = path.join(os.tmpdir(), `dsar-export-b36-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

function seedAuditWrite(
  database: Database.Database,
  tenantId: string,
  userId: string,
  relPath: string,
) {
  const entry = buildKnowledgeAuditEntry(database, {
    tenantId,
    actorId: "operator",
    actorRole: "operator",
    path: relPath,
    operation: "write",
    agentId: "agent-b36",
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
    database,
  );
}

describe("dsar-export batch36 — copyVaultFiles guards", () => {
  it("continues when normalized path still contains double-dot segment (92)", () => {
    const database = new Database(":memory:");
    initSchema(database);
    const tenantId = "default-tenant";
    const vaultRoot = path.join(ROOT, "vault-dots");
    const vault = path.join(vaultRoot, tenantId);
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(path.join(vault, "legit-b36.md"), "ok", "utf8");
    const userId = `user-dots-b36-${randomUUID().slice(0, 8)}`;
    seedAuditWrite(database, tenantId, userId, "segment..dots/legit-b36.md");

    const result = exportDsarPackage({
      db: database,
      tenantId,
      userId,
      outDir: path.join(ROOT, "out-dots"),
      vaultRoot,
      now: new Date("2026-11-12T00:00:00.000Z"),
    });
    expect(result.vaultPaths).toEqual([]);
    database.close();
  });

  it("continues when resolved path escapes vault root (96)", () => {
    const database = new Database(":memory:");
    initSchema(database);
    const tenantId = "default-tenant";
    const vaultRoot = path.join(ROOT, "vault-escape-b36");
    const vault = path.join(vaultRoot, tenantId);
    fs.mkdirSync(vault, { recursive: true });
    const outsideDir = path.join(ROOT, "outside-b36");
    fs.mkdirSync(outsideDir, { recursive: true });
    const outsideFile = path.join(outsideDir, "escape-b36.md");
    fs.writeFileSync(outsideFile, "leak", "utf8");
    const relOutside = path.relative(vault, outsideFile);
    const userId = `user-escape-b36-${randomUUID().slice(0, 8)}`;
    seedAuditWrite(database, tenantId, userId, relOutside);

    const result = exportDsarPackage({
      db: database,
      tenantId,
      userId,
      outDir: path.join(ROOT, "out-escape"),
      vaultRoot,
      now: new Date("2026-11-12T00:00:00.000Z"),
    });
    expect(result.vaultPaths).toEqual([]);
    database.close();
  });
});
