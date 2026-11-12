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

const ROOT = path.join(os.tmpdir(), `dsar-export-b33-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("dsar-export batch33 — vault traversal guards", () => {
  it("copyVaultFiles skips normalized traversal and resolves vault-root boundary (92, 96)", () => {
    const database = new Database(":memory:");
    initSchema(database);
    const tenantId = "default-tenant";
    const vaultRoot = path.join(ROOT, "vault");
    const vault = path.join(vaultRoot, tenantId);
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(path.join(vault, "inside-b33.md"), "inside", "utf8");
    const outside = path.join(ROOT, "outside-b33.md");
    fs.writeFileSync(outside, "outside", "utf8");
    const userId = `user-b33-${randomUUID().slice(0, 8)}`;

    for (const rel of ["inside-b33.md", path.relative(vault, outside), "..\\..\\outside-b33.md", "../other-tenant/secret.md"]) {
      const entry = buildKnowledgeAuditEntry(database, {
        tenantId,
        actorId: "operator",
        actorRole: "operator",
        path: rel,
        operation: "read",
        agentId: "agent-b33",
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
      outDir: path.join(ROOT, "out-b33"),
      vaultRoot,
      now: new Date("2026-11-10T00:00:00.000Z"),
    });
    expect(result.vaultPaths).toEqual(["inside-b33.md"]);
    database.close();
  });
});
