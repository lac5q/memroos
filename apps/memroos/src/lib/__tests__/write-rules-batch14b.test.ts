// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  checkWriteRuleDrift,
  createWriteRule,
  getDocumentDirectory,
  getWriteRules,
  resolveWriteTarget,
  validateWriteRule,
} from "@/lib/write-rules";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function ensureSpace(database: Database.Database, spaceId: string): void {
  database.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('default-tenant', 'Default')`).run();
  database
    .prepare(`INSERT OR IGNORE INTO spaces (id, tenant_id, name) VALUES (?, 'default-tenant', ?)`)
    .run(spaceId, spaceId);
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("write-rules batch14b — validate, resolve, drift", () => {
  it("validateWriteRule collects multiple field errors", () => {
    const result = validateWriteRule({ dataType: "  ", targetDocument: "", fallbackRule: "noop" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/dataType/);
    expect(result.errors.join(" ")).toMatch(/fallbackRule/);
  });

  it("resolveWriteTarget uses default_doc fallback when exact match missing", () => {
    const database = freshDb();
    const spaceId = `space-${crypto.randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    createWriteRule(database, {
      spaceId,
      dataType: "notes",
      targetDocument: "notes/default",
      fallbackRule: "default_doc",
      actorId: "operator",
    });
    const resolved = resolveWriteTarget(database, spaceId, "unknown-type");
    expect(resolved.matched).toBe(true);
    expect(resolved.receiptReason).toBe("fallback");
    expect(resolved.targetDocument).toBe("notes/default");
  });

  it("resolveWriteTarget writes mismatch audit row on reject path", () => {
    const database = freshDb();
    const spaceId = `space-${crypto.randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    const resolved = resolveWriteTarget(database, spaceId, "missing");
    expect(resolved.matched).toBe(false);
    const auditCount = (
      database.prepare(`SELECT COUNT(*) AS c FROM audit_entries WHERE event_type = 'write_rule.mismatch'`).get() as {
        c: number;
      }
    ).c;
    expect(auditCount).toBe(1);
  });

  it("checkWriteRuleDrift marks stale agent views", () => {
    const database = freshDb();
    const spaceId = `space-${crypto.randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    createWriteRule(database, {
      spaceId,
      dataType: "log",
      targetDocument: "logs/main",
      actorId: "operator",
    });
    expect(checkWriteRuleDrift(database, spaceId, 0).isStale).toBe(true);
    expect(checkWriteRuleDrift(database, spaceId, 1).isStale).toBe(false);
  });

  it("getWriteRules and getDocumentDirectory return empty arrays for unknown space", () => {
    const database = freshDb();
    expect(getWriteRules(database, "missing-space")).toEqual([]);
    expect(getDocumentDirectory(database, "missing-space")).toEqual([]);
  });
});
