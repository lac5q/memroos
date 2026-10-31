// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildKnowledgeAuditEntry } from "@/lib/audit/knowledge-chain";
import { writeAuditEntry } from "@/lib/audit/write";

const ROOT = path.join(os.tmpdir(), `dsar-export-b24-${randomUUID()}`);

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const realSpawn = actual.spawnSync.bind(actual);
  return {
    ...actual,
    spawnSync: (cmd: string, args: readonly string[], options?: unknown) => {
      if (cmd === "zip") {
        return { error: new Error("zip missing"), status: 1, stdout: "", stderr: "" };
      }
      return realSpawn(cmd, args as string[], options as never);
    },
  };
});

const { exportDsarPackage } = await import("../dsar-export");

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("dsar-export batch24 — archive fallback and vault root guard", () => {
  it("createArchive falls back to tar.gz when zip is unavailable", () => {
    const database = new Database(":memory:");
    initSchema(database);
    const tenantId = "default-tenant";
    const vaultRoot = path.join(ROOT, "vault");
    const vault = path.join(vaultRoot, tenantId);
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(path.join(vault, "note.md"), "vault body", "utf8");
    const userId = `user-${randomUUID().slice(0, 8)}`;
    const entry = buildKnowledgeAuditEntry(database, {
      tenantId,
      actorId: "operator",
      actorRole: "operator",
      path: "note.md",
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
      database,
    );

    const result = exportDsarPackage({
      db: database,
      tenantId,
      userId,
      outDir: path.join(ROOT, "out-tar"),
      vaultRoot,
      now: new Date("2026-07-10T00:00:00.000Z"),
    });
    expect(result.archivePath.endsWith(".tar.gz")).toBe(true);
    expect(result.vaultPaths).toEqual(["note.md"]);
    database.close();
  });

  it("copyVaultFiles skips paths that resolve outside vault root", () => {
    const database = new Database(":memory:");
    initSchema(database);
    const tenantId = "default-tenant";
    const vaultRoot = path.join(ROOT, "vault-outside");
    const vault = path.join(vaultRoot, tenantId);
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(path.join(vault, "inside.md"), "inside", "utf8");
    const outside = path.join(ROOT, "outside.md");
    fs.writeFileSync(outside, "outside", "utf8");
    const userId = `user-${randomUUID().slice(0, 8)}`;
    for (const rel of ["inside.md", path.relative(vault, outside)]) {
      const entry = buildKnowledgeAuditEntry(database, {
        tenantId,
        actorId: "operator",
        actorRole: "operator",
        path: rel,
        operation: "read",
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
        database,
      );
    }
    const result = exportDsarPackage({
      db: database,
      tenantId,
      userId,
      outDir: path.join(ROOT, "out-guard"),
      vaultRoot,
    });
    expect(result.vaultPaths).toEqual(["inside.md"]);
    database.close();
  });
});
