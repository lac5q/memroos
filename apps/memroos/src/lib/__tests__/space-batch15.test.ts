// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  addSpaceMember,
  createSpace,
  filterBySpace,
  getSpaceDefaultLabels,
} from "@/lib/space";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("space batch15 — id fallback, validation, labels, filter", () => {
  it("generateSpaceId uses randomBytes fallback when randomUUID is unavailable", () => {
    vi.stubGlobal("crypto", {
      ...crypto,
      randomUUID: undefined,
      randomBytes: crypto.randomBytes,
    });
    const db = new Database(":memory:");
    initSchema(db);
    db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('default-tenant', 'Default')`).run();
    const space = createSpace(db, { tenantId: "default-tenant", name: `Fallback-${crypto.randomUUID().slice(0, 6)}` });
    expect(space.id.startsWith("spc_")).toBe(true);
    db.close();
  });

  it("createSpace rejects empty names and rethrows non-unique insert errors", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(() => createSpace(db, { tenantId: "default-tenant", name: "   " })).toThrow(/name is required/);
    db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('default-tenant', 'Default')`).run();
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: unknown) => {
      const stmt = originalPrepare(sql as string);
      if (typeof sql === "string" && sql.includes("INSERT INTO spaces")) {
        return {
          run: () => {
            throw new Error("disk io error");
          },
          get: stmt.get.bind(stmt),
          all: stmt.all.bind(stmt),
        } as ReturnType<typeof db.prepare>;
      }
      return stmt;
    });
    expect(() => createSpace(db, { tenantId: "default-tenant", name: "Ops2" })).toThrow(/disk io error/);
    db.close();
  });

  it("createSpace throws when read-back row is missing", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('default-tenant', 'Default')`).run();
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: unknown) => {
      const stmt = originalPrepare(sql as string);
      if (typeof sql === "string" && sql.includes("FROM spaces WHERE id = ?")) {
        return { get: () => undefined, run: stmt.run.bind(stmt), all: stmt.all.bind(stmt) } as ReturnType<
          typeof db.prepare
        >;
      }
      return stmt;
    });
    expect(() => createSpace(db, { tenantId: "default-tenant", name: "Ghost" })).toThrow(/not found on read-back/);
    db.close();
  });

  it("addSpaceMember validates spaceId and memberId", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(() =>
      addSpaceMember(db, { spaceId: "", memberId: "u1", memberType: "human" }),
    ).toThrow(/spaceId is required/);
    expect(() =>
      addSpaceMember(db, { spaceId: "sp-1", memberId: "", memberType: "human" }),
    ).toThrow(/memberId is required/);
    db.close();
  });

  it("getSpaceDefaultLabels returns {} for missing space and non-object JSON", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(getSpaceDefaultLabels(db, "missing")).toEqual({});
    db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('default-tenant', 'Default')`).run();
    db.prepare(
      `INSERT INTO spaces (id, tenant_id, name, default_labels_json, created_at)
       VALUES ('sp-array', 'default-tenant', 'Arr', '[]', datetime('now'))`,
    ).run();
    expect(getSpaceDefaultLabels(db, "sp-array")).toEqual({});
    db.close();
  });

  it("filterBySpace returns all rows when space name is blank and drops non-matching legacy rows", () => {
    const rows = [
      { space_id: "sp-1", project: "Alpha" },
      { space_id: null, project: "Beta" },
    ];
    expect(filterBySpace(rows, "   ")).toEqual(rows);
    expect(filterBySpace(rows, "Alpha", "sp-9")).toHaveLength(1);
    expect(filterBySpace([{ space_id: null, project: null }], "Alpha")).toHaveLength(0);
  });
});
