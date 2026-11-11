// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  createDocumentDirectoryEntry,
  createWriteRule,
  getDocumentDirectory,
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

describe("write-rules batch34 — validation branches and directory guards", () => {
  it("validateWriteRule rejects invalid fallbackRule (135–138)", () => {
    const result = validateWriteRule({
      dataType: "note",
      targetDocument: "notes",
      fallbackRule: "invalid-b34",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/fallbackRule/);
  });

  it("createWriteRule requires actorId (161–164)", () => {
    const database = freshDb();
    const spaceId = `space-b34-${randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    expect(() =>
      createWriteRule(database, {
        spaceId,
        dataType: "note",
        targetDocument: "notes",
        actorId: "  ",
      }),
    ).toThrow(/actorId is required/);
  });

  it("createDocumentDirectoryEntry requires name (512–513)", () => {
    const database = freshDb();
    const spaceId = `space-b34-${randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    expect(() =>
      createDocumentDirectoryEntry(database, {
        spaceId,
        name: "  ",
        actorId: "operator-b34",
      }),
    ).toThrow(/name is required/);
  });

  it("getDocumentDirectory returns empty for blank spaceId (583–584)", () => {
    const database = freshDb();
    expect(getDocumentDirectory(database, "   ")).toEqual([]);
  });

  it("createDocumentDirectoryEntry stores optional purpose and resourceId (515–516)", () => {
    const database = freshDb();
    const spaceId = `space-b34-${randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    const entry = createDocumentDirectoryEntry(database, {
      spaceId,
      name: "Runbooks",
      purpose: "operator",
      resourceId: `res-b34-${randomUUID().slice(0, 6)}`,
      actorId: "operator-b34",
    });
    expect(entry.purpose).toBe("operator");
    expect(entry.resourceId).toMatch(/^res-b34-/);
  });
});
