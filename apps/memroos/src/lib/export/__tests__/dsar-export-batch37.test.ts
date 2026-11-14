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

const ROOT = path.join(os.tmpdir(), `dsar-export-b37-${randomUUID()}`);

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
    agentId: "agent-b37",
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

describe("dsar-export batch37 — copyVaultFiles escape guard (96)", () => {
  it("skips files whose resolved path escapes vault root", () => {
    const database = new Database(":memory:");
    initSchema(database);
    const tenantId = "default-tenant";
    const vaultRoot = path.join(ROOT, "vault-escape-b37");
    const vault = path.join(vaultRoot, tenantId);
    fs.mkdirSync(vault, { recursive: true });
    const outsideDir = path.join(ROOT, "outside-b37");
    fs.mkdirSync(outsideDir, { recursive: true });
    const outsideFile = path.join(outsideDir, "escape-b37.md");
    fs.writeFileSync(outsideFile, "leak", "utf8");
    const relOutside = path.relative(vault, outsideFile);
    const userId = `user-escape-b37-${randomUUID().slice(0, 8)}`;
    seedAuditWrite(database, tenantId, userId, relOutside);

    const result = exportDsarPackage({
      db: database,
      tenantId,
      userId,
      outDir: path.join(ROOT, "out-escape"),
      vaultRoot,
      now: new Date("2026-11-14T00:00:00.000Z"),
    });
    expect(result.vaultPaths).toEqual([]);
    database.close();
  });
});