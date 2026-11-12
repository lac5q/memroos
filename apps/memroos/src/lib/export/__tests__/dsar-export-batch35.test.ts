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

const ROOT = path.join(os.tmpdir(), `dsar-export-b35-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("dsar-export batch35 — copyVaultFiles guards (92, 96)", () => {
  it("skips dot-dot segments after normalization (92)", () => {
    const database = new Database(":memory:");
    initSchema(database);
    const tenantId = "default-tenant";
    const vaultRoot = path.join(ROOT, "vault");
    const vault = path.join(vaultRoot, tenantId);
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(path.join(vault, "safe-b35.md"), "safe", "utf8");
    const userId = `user-b35-${randomUUID().slice(0, 8)}`;
    for (const rel of ["safe-b35.md", "../outside-b35.md", "..\\escape-b35.md"]) {
      const entry = buildKnowledgeAuditEntry(database, {
        tenantId,
        actorId: "operator",
        actorRole: "operator",
        path: rel,
        operation: "write",
        agentId: "agent-b35",
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

    const result = exportDsarPackage({
      db: database,
      tenantId,
      userId,
      outDir: path.join(ROOT, "out"),
      vaultRoot,
      now: new Date("2026-11-12T00:00:00.000Z"),
    });
    expect(result.vaultPaths).toEqual(["safe-b35.md"]);
    database.close();
  });

  it("skips files resolved outside vault root (96)", () => {
    const database = new Database(":memory:");
    initSchema(database);
    const tenantId = "default-tenant";
    const vaultRoot = path.join(ROOT, "vault-outside");
    const vault = path.join(vaultRoot, tenantId);
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(path.join(vault, "inside-b35.md"), "inside", "utf8");
    const outside = path.join(ROOT, "leak-b35.md");
    fs.writeFileSync(outside, "outside", "utf8");
    const userId = `user-b35b-${randomUUID().slice(0, 8)}`;
  const relOutside = path.relative(vault, outside);
    const entry = buildKnowledgeAuditEntry(database, {
      tenantId,
      actorId: "operator",
      actorRole: "operator",
      path: relOutside,
      operation: "write",
      agentId: "agent-b35",
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
    expect(result.vaultPaths.every((p) => !p.includes("leak-b35"))).toBe(true);
    database.close();
  });
});
