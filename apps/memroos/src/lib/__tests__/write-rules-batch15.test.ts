// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  createDocumentDirectoryEntry,
  createWriteRule,
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
  vi.restoreAllMocks();
});

describe("write-rules batch15 — insert/update error and read-back edges", () => {
  it("createWriteRule rethrows non-unique insert failures", () => {
    const database = freshDb();
    const spaceId = `space-${crypto.randomUUID().slice(0, 8)}`;
    expect(() =>
      createWriteRule(database, {
        spaceId,
        dataType: "note",
        targetDocument: "notes",
        actorId: "operator",
      }),
    ).toThrow(/FOREIGN KEY/);
  });

  it("createWriteRule throws when read-back row is missing", () => {
    const database = freshDb();
    const spaceId = `space-${crypto.randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation((sql: unknown) => {
      const stmt = originalPrepare(sql as string);
      if (
        typeof sql === "string" &&
        sql.includes("FROM write_rules WHERE id = ?") &&
        sql.includes("target_document")
      ) {
        return { get: () => undefined, run: stmt.run.bind(stmt), all: stmt.all.bind(stmt) } as ReturnType<
          typeof database.prepare
        >;
      }
      return stmt;
    });
    expect(() =>
      createWriteRule(database, {
        spaceId,
        dataType: "note",
        targetDocument: "notes",
        actorId: "operator",
      }),
    ).toThrow(/not found on read-back/);
  });

  it("updateWriteRule throws when read-back row is missing", () => {
    const database = freshDb();
    const spaceId = `space-${crypto.randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    const rule = createWriteRule(database, {
      spaceId,
      dataType: "log",
      targetDocument: "logs",
      actorId: "operator",
    });
    const originalPrepare = database.prepare.bind(database);
    let sawUpdate = false;
    vi.spyOn(database, "prepare").mockImplementation((sql: unknown) => {
      const stmt = originalPrepare(sql as string);
      if (typeof sql === "string" && sql.includes("UPDATE write_rules")) {
        sawUpdate = true;
      }
      if (
        sawUpdate &&
        typeof sql === "string" &&
        sql.includes("FROM write_rules WHERE id = ?") &&
        sql.includes("updated_at")
      ) {
        return { get: () => undefined, run: stmt.run.bind(stmt), all: stmt.all.bind(stmt) } as ReturnType<
          typeof database.prepare
        >;
      }
      return stmt;
    });
    expect(() =>
      updateWriteRule(database, rule.id, {
        expectedVersion: 1,
        actorId: "operator",
        targetDocument: "logs/v2",
      }),
    ).toThrow(/not found on read-back/);
  });

  it("createDocumentDirectoryEntry validates spaceId and rethrows non-unique errors", () => {
    const database = freshDb();
    expect(() =>
      createDocumentDirectoryEntry(database, { spaceId: "  ", name: "Docs", actorId: "operator" }),
    ).toThrow(/spaceId is required/);
    const spaceId = `space-${crypto.randomUUID().slice(0, 8)}`;
    expect(() =>
      createDocumentDirectoryEntry(database, {
        spaceId,
        name: "Orphan",
        actorId: "operator",
      }),
    ).toThrow(/FOREIGN KEY/);
  });

  it("createDocumentDirectoryEntry throws when read-back row is missing", () => {
    const database = freshDb();
    const spaceId = `space-${crypto.randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    const originalPrepare = database.prepare.bind(database);
    vi.spyOn(database, "prepare").mockImplementation((sql: unknown) => {
      const stmt = originalPrepare(sql as string);
      if (typeof sql === "string" && sql.includes("FROM document_directory WHERE id = ?")) {
        return { get: () => undefined, run: stmt.run.bind(stmt), all: stmt.all.bind(stmt) } as ReturnType<
          typeof database.prepare
        >;
      }
      return stmt;
    });
    expect(() =>
      createDocumentDirectoryEntry(database, { spaceId, name: "Runbooks", actorId: "operator" }),
    ).toThrow(/not found on read-back/);
  });

  it("updateDocumentDirectoryEntry requires actorId and rethrows non-unique rename failures", () => {
    const database = freshDb();
    const spaceId = `space-${crypto.randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    const a = createDocumentDirectoryEntry(database, { spaceId, name: "Alpha", actorId: "operator" });
    createDocumentDirectoryEntry(database, { spaceId, name: "Beta", actorId: "operator" });
    expect(() =>
      updateDocumentDirectoryEntry(database, a.id, { expectedVersion: 1, actorId: "  ", name: "Gamma" }),
    ).toThrow(/actorId is required/);
    expect(() =>
      updateDocumentDirectoryEntry(database, a.id, {
        expectedVersion: 1,
        actorId: "operator",
        name: "Beta",
      }),
    ).toThrow(/already exists/);
  });

  it("updateDocumentDirectoryEntry throws when read-back row is missing", () => {
    const database = freshDb();
    const spaceId = `space-${crypto.randomUUID().slice(0, 8)}`;
    ensureSpace(database, spaceId);
    const entry = createDocumentDirectoryEntry(database, { spaceId, name: "Docs", actorId: "operator" });
    const originalPrepare = database.prepare.bind(database);
    let sawUpdate = false;
    vi.spyOn(database, "prepare").mockImplementation((sql: unknown) => {
      const stmt = originalPrepare(sql as string);
      if (typeof sql === "string" && sql.includes("UPDATE document_directory")) {
        sawUpdate = true;
      }
      if (sawUpdate && typeof sql === "string" && sql.includes("FROM document_directory WHERE id = ?")) {
        return { get: () => undefined, run: stmt.run.bind(stmt), all: stmt.all.bind(stmt) } as ReturnType<
          typeof database.prepare
        >;
      }
      return stmt;
    });
    expect(() =>
      updateDocumentDirectoryEntry(database, entry.id, {
        expectedVersion: 1,
        actorId: "operator",
        purpose: "ops",
      }),
    ).toThrow(/not found on read-back/);
  });
});
