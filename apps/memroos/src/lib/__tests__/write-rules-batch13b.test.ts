// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  createDocumentDirectoryEntry,
  createWriteRule,
  deleteWriteRule,
  getWriteRules,
  resolveWriteTarget,
  updateWriteRule,
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

describe("write-rules batch13b — optimistic locking and resolve", () => {
  it("createWriteRule rejects duplicate data_type in the same space", () => {
    const database = freshDb();
    const spaceId = `space-${crypto.randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    createWriteRule(database, {
      spaceId,
      dataType: "incident",
      targetDocument: "runbook",
      actorId: "operator",
    });
    expect(() =>
      createWriteRule(database, {
        spaceId,
        dataType: "incident",
        targetDocument: "other-doc",
        actorId: "operator",
      })
    ).toThrow(/already exists/);
  });

  it("updateWriteRule enforces expected version token", () => {
    const database = freshDb();
    const spaceId = `space-${crypto.randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    const rule = createWriteRule(database, {
      spaceId,
      dataType: "note",
      targetDocument: "notes",
      actorId: "operator",
    });
    expect(() =>
      updateWriteRule(database, rule.id, {
        expectedVersion: 99,
        actorId: "operator",
        targetDocument: "notes-v2",
      })
    ).toThrow(/version conflict/);
  });

  it("resolveWriteTarget uses default_doc fallback when no rule matches", () => {
    const database = freshDb();
    const spaceId = `space-${crypto.randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    createWriteRule(database, {
      spaceId,
      dataType: "__default__",
      targetDocument: "catch-all",
      fallbackRule: "default_doc",
      actorId: "operator",
    });
    const resolved = resolveWriteTarget(database, spaceId, "unknown-type");
    expect(resolved.matched).toBe(true);
    expect(resolved.targetDocument).toBe("catch-all");
    expect(resolved.receiptReason).toBe("fallback");
  });

  it("resolveWriteTarget rejects unknown data types when fallback is reject", () => {
    const database = freshDb();
    const spaceId = `space-${crypto.randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    createWriteRule(database, {
      spaceId,
      dataType: "ticket",
      targetDocument: "tickets",
      fallbackRule: "reject",
      actorId: "operator",
    });
    const resolved = resolveWriteTarget(database, spaceId, "unknown-type");
    expect(resolved.matched).toBe(false);
    expect(resolved.targetDocument).toBeNull();
  });

  it("deleteWriteRule removes row and getWriteRules reflects deletion", () => {
    const database = freshDb();
    const spaceId = `space-${crypto.randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    const rule = createWriteRule(database, {
      spaceId,
      dataType: "log",
      targetDocument: "logs",
      actorId: "operator",
    });
    deleteWriteRule(database, rule.id, { expectedVersion: 1, actorId: "operator" });
    expect(getWriteRules(database, spaceId)).toHaveLength(0);
  });

  it("createDocumentDirectoryEntry requires name and actor", () => {
    const database = freshDb();
    expect(() =>
      createDocumentDirectoryEntry(database, {
        spaceId: "space-1",
        name: "",
        actorId: "operator",
      })
    ).toThrow(/name is required/);
  });
});
