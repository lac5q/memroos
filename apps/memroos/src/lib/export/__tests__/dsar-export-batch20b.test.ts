// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { AUDIT_EVENT_TYPES } from "@/lib/audit/event-types";
import { exportDsarPackage } from "../dsar-export";

const ROOT = path.join(os.tmpdir(), `dsar-b20b-${crypto.randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("dsar-export batch20b — archive error and traversal leftovers", () => {
  it("copyVaultFiles skips paths that escape vault root after normalization", () => {
    const tenantId = "default-tenant";
    const vaultRoot = path.join(ROOT, "vault");
    const vault = path.join(vaultRoot, tenantId);
    fs.mkdirSync(vault, { recursive: true });
    fs.writeFileSync(path.join(vault, "inside.md"), "ok", "utf8");

    const db = new Database(":memory:");
    initSchema(db);
    db.prepare("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)").run(tenantId, "Default");
    const userId = `user-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO audit_entries
        (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
       VALUES (?, ?, 'operator', 'operator', ?, 'vault_file', 'f1', 'read', ?, datetime('now'))`,
    ).run(
      randomUUID(),
      tenantId,
      AUDIT_EVENT_TYPES.KNOWLEDGE_ACCESS,
      JSON.stringify({ path: "../outside.md", operation: "read", userId }),
    );

    const result = exportDsarPackage({
      db,
      tenantId,
      userId,
      outDir: path.join(ROOT, "out-safe"),
      vaultRoot,
      now: new Date("2026-07-10T00:00:00.000Z"),
    });
    expect(result.vaultPaths).toEqual([]);
    db.close();
  });

  it("createArchive throws when zip and tar both fail", async () => {
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return {
        ...actual,
        spawnSync: vi.fn((cmd: string) => {
          if (cmd === "zip" || cmd === "tar") {
            return {
              status: 1,
              stdout: "",
              stderr: "archive tool failed",
              pid: 0,
              signal: null,
              output: [null, "", "archive tool failed"],
              error: undefined,
            };
          }
          return actual.spawnSync(cmd);
        }),
      };
    });
    vi.resetModules();
    const { exportDsarPackage: exportWithBrokenArchive } = await import("../dsar-export");

    const tenantId = "default-tenant";
    const vaultRoot = path.join(ROOT, "vault2");
    fs.mkdirSync(path.join(vaultRoot, tenantId), { recursive: true });
    const db = new Database(":memory:");
    initSchema(db);
    db.prepare("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)").run(tenantId, "Default");
    const userId = `user-${crypto.randomUUID().slice(0, 8)}`;

    expect(() =>
      exportWithBrokenArchive({
        db,
        tenantId,
        userId,
        outDir: path.join(ROOT, "out-fail"),
        vaultRoot,
      }),
    ).toThrow(/archive failed/i);
    db.close();
    vi.doUnmock("node:child_process");
    vi.resetModules();
  });
});

function randomUUID(): string {
  return crypto.randomUUID();
}
