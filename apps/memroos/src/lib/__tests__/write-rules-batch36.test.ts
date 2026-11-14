// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  createDocumentDirectoryEntry,
  createWriteRule,
  updateDocumentDirectoryEntry,
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

describe("write-rules batch36 — validation and optimistic locking", () => {
  it("validateWriteRule accepts default_doc fallback (135-141)", () => {
    const result = validateWriteRule({
      dataType: "note",
      targetDocument: "notes",
      fallbackRule: "default_doc",
    });
    expect(result.valid).toBe(true);
  });

  it("createWriteRule rejects blank spaceId (163-164)", () => {
    const database = freshDb();
    expect(() =>
      createWriteRule(database, {
        spaceId: "  ",
        dataType: "note",
        targetDocument: "notes",
        actorId: "operator-b36",
      }),
    ).toThrow(/spaceId is required/);
  });

  it("createWriteRule rejects duplicate data_type in same space (189-192)", () => {
    const database = freshDb();
    const spaceId = `space-b36-${randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    const input = {
      spaceId,
      dataType: `dtype-b36-${randomUUID().slice(0, 6)}`,
      targetDocument: "notes",
      actorId: "operator-b36",
    };
    createWriteRule(database, input);
    expect(() => createWriteRule(database, input)).toThrow(/already exists/i);
  });

  it("updateDocumentDirectoryEntry throws on version conflict (627-630)", () => {
    const database = freshDb();
    const spaceId = `space-b36-${randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    const entry = createDocumentDirectoryEntry(database, {
      spaceId,
      name: `Doc B36 ${randomUUID().slice(0, 4)}`,
      actorId: "operator-b36",
    });
    expect(() =>
      updateDocumentDirectoryEntry(database, entry.id, {
        actorId: "operator-b36",
        expectedVersion: entry.version + 1,
        name: "Renamed B36",
      }),
    ).toThrow(/version conflict/i);
  });

  it("createDocumentDirectoryEntry rejects duplicate name in space (530-533)", () => {
    const database = freshDb();
    const spaceId = `space-b36-${randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    const name = `Duplicate B36 ${randomUUID().slice(0, 4)}`;
    createDocumentDirectoryEntry(database, { spaceId, name, actorId: "operator-b36" });
    expect(() => createDocumentDirectoryEntry(database, { spaceId, name, actorId: "operator-b36" })).toThrow(
      /already exists/i,
    );
  });
});
