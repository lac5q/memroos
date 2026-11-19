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
import { exportDsarPackage, listVaultPathsForUser } from "../dsar-export";

const ROOT = path.join(os.tmpdir(), `dsar-b20-${crypto.randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("dsar-export batch20 — traversal guards and archive fallback", () => {
  it("copyVaultFiles skips normalized traversal paths and missing files", () => {
    const tenantId = "default-tenant";
    const vaultRoot = path.join(ROOT, "vault");
    const vault = path.join(vaultRoot, tenantId);
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(path.join(vault, "present.md"), "ok", "utf8");

    const db = new Database(":memory:");
    initSchema(db);
    db.prepare("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)").run(tenantId, "Default");
    const userId = `user-${crypto.randomUUID().slice(0, 8)}`;
    for (const rel of ["../../etc/passwd", "missing.md", "present.md"]) {
      const entry = buildKnowledgeAuditEntry(db, {
        tenantId,
        actorId: "operator",
        actorRole: "operator",
        path: rel,
        operation: "read",
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
      outDir: path.join(ROOT, "out"),
      vaultRoot,
      now: new Date("2026-07-10T00:00:00.000Z"),
    });
    expect(result.vaultPaths).toEqual(["present.md"]);
    expect(listVaultPathsForUser(db, tenantId, userId).sort()).toEqual(
      ["../../etc/passwd", "missing.md", "present.md"].sort(),
    );
    db.close();
  });

  it("exportDsarPackage requires userId", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(() =>
      exportDsarPackage({
        db,
        tenantId: "default-tenant",
        userId: "  ",
        outDir: path.join(ROOT, "empty-user"),
        vaultRoot: path.join(ROOT, "vault-empty"),
      }),
    ).toThrow(/userId required/);
    db.close();
  });
});
