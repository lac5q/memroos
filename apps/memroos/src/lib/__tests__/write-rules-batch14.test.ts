// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  createDocumentDirectoryEntry,
  createWriteRule,
  deleteDocumentDirectoryEntry,
  deleteWriteRule,
  updateDocumentDirectoryEntry,
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

describe("write-rules batch14 — directory CRUD and validation edges", () => {
  it("updateWriteRule rejects empty actor, targetDocument, and invalid fallbackRule", () => {
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
        expectedVersion: 1,
        actorId: "  ",
        targetDocument: "notes-v2",
      }),
    ).toThrow(/actorId is required/);
    expect(() =>
      updateWriteRule(database, rule.id, {
        expectedVersion: 1,
        actorId: "operator",
        targetDocument: "   ",
      }),
    ).toThrow(/targetDocument cannot be empty/);
    expect(() =>
      updateWriteRule(database, rule.id, {
        expectedVersion: 1,
        actorId: "operator",
        fallbackRule: "invalid",
      }),
    ).toThrow(/fallbackRule must be/);
  });

  it("deleteWriteRule and deleteDocumentDirectoryEntry require actor and version match", () => {
    const database = freshDb();
    const spaceId = `space-${crypto.randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    const rule = createWriteRule(database, {
      spaceId,
      dataType: "log",
      targetDocument: "logs",
      actorId: "operator",
    });
    expect(() => deleteWriteRule(database, rule.id, { expectedVersion: 1, actorId: "" })).toThrow(
      /actorId is required/,
    );
    expect(() => deleteWriteRule(database, 9999, { expectedVersion: 1, actorId: "operator" })).toThrow(/not found/);

    const entry = createDocumentDirectoryEntry(database, {
      spaceId,
      name: "Runbooks",
      actorId: "operator",
    });
    expect(() =>
      deleteDocumentDirectoryEntry(database, entry.id, { expectedVersion: 99, actorId: "operator" }),
    ).toThrow(/version conflict/);
    expect(() =>
      deleteDocumentDirectoryEntry(database, entry.id, { expectedVersion: 1, actorId: "" }),
    ).toThrow(/actorId is required/);
  });

  it("createDocumentDirectoryEntry rejects duplicates and empty fields", () => {
    const database = freshDb();
    const spaceId = `space-${crypto.randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    createDocumentDirectoryEntry(database, { spaceId, name: "Docs", actorId: "operator" });
    expect(() =>
      createDocumentDirectoryEntry(database, { spaceId, name: "Docs", actorId: "operator" }),
    ).toThrow(/already exists/);
    expect(() =>
      createDocumentDirectoryEntry(database, { spaceId, name: "   ", actorId: "operator" }),
    ).toThrow(/name is required/);
  });

  it("updateDocumentDirectoryEntry enforces optimistic locking and duplicate names", () => {
    const database = freshDb();
    const spaceId = `space-${crypto.randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    const a = createDocumentDirectoryEntry(database, { spaceId, name: "Alpha", actorId: "operator" });
    createDocumentDirectoryEntry(database, { spaceId, name: "Beta", actorId: "operator" });
    expect(() =>
      updateDocumentDirectoryEntry(database, a.id, {
        expectedVersion: 1,
        actorId: "operator",
        name: "Beta",
      }),
    ).toThrow(/already exists/);
    expect(() =>
      updateDocumentDirectoryEntry(database, 404, {
        expectedVersion: 1,
        actorId: "operator",
        name: "Missing",
      }),
    ).toThrow(/not found/);
  });
});
