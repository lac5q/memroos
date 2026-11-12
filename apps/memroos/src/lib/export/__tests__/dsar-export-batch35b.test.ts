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

const ROOT = path.join(os.tmpdir(), `dsar-export-b35b-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("dsar-export batch35b — copyVaultFiles continue guards", () => {
  it("continues when normalized relative path still contains dot-dot (92)", () => {
    const database = new Database(":memory:");
    initSchema(database);
    const tenantId = "default-tenant";
    const vaultRoot = path.join(ROOT, "vault");
    const vault = path.join(vaultRoot, tenantId);
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(path.join(vault, "legit-b35b.md"), "ok", "utf8");
    const userId = `user-b35b-${randomUUID().slice(0, 8)}`;
    const tricky = `safe/../legit-b35b.md`;
    const entry = buildKnowledgeAuditEntry(database, {
      tenantId,
      actorId: "operator",
      actorRole: "operator",
      path: tricky,
      operation: "write",
      agentId: "agent-b35b",
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

    const result = exportDsarPackage({
      db: database,
      tenantId,
      userId,
      outDir: path.join(ROOT, "out"),
      vaultRoot,
      now: new Date("2026-11-12T00:00:00.000Z"),
    });
    expect(result.vaultPaths).toEqual(["legit-b35b.md"]);
    database.close();
  });

  it("continues when resolved file path escapes vault root (96)", () => {
    const database = new Database(":memory:");
    initSchema(database);
    const tenantId = "default-tenant";
    const vaultRoot = path.join(ROOT, "vault-escape");
    const vault = path.join(vaultRoot, tenantId);
    fs.mkdirSync(vault, { recursive: true });
    const outsideDir = path.join(ROOT, "outside-b35b");
    fs.mkdirSync(outsideDir, { recursive: true });
    const outsideFile = path.join(outsideDir, "escape-b35b.md");
    fs.writeFileSync(outsideFile, "leak", "utf8");
    const relOutside = path.relative(vault, outsideFile);
    const userId = `user-escape-b35b-${randomUUID().slice(0, 8)}`;
    const entry = buildKnowledgeAuditEntry(database, {
      tenantId,
      actorId: "operator",
      actorRole: "operator",
      path: relOutside,
      operation: "write",
      agentId: "agent-b35b",
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

    const result = exportDsarPackage({
      db: database,
      tenantId,
      userId,
      outDir: path.join(ROOT, "out2"),
      vaultRoot,
      now: new Date("2026-11-12T00:00:00.000Z"),
    });
    expect(result.vaultPaths).toEqual([]);
    database.close();
  });
});
