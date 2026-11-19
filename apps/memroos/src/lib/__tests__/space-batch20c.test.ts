// @vitest-environment node
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  createSpace,
  filterBySpace,
  getSpaceDefaultLabels,
  getSpacesForUser,
  isSpaceMember,
  resolveSpaceId,
} from "@/lib/space";

describe("space batch20c", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("getSpacesForUser returns empty for blank user id", () => {
    expect(getSpacesForUser(db, "  ")).toEqual([]);
  });

  it("filterBySpace matches legacy project name when space_id absent", () => {
    const rows = [
      { project: "Alpha", space_id: null },
      { project: "Beta", space_id: null },
    ];
    expect(filterBySpace(rows, "Alpha")).toHaveLength(1);
  });

  it("getSpaceDefaultLabels tolerates corrupt JSON", () => {
    const space = createSpace(db, { tenantId: "default-tenant", name: `Space-${crypto.randomUUID().slice(0, 6)}` });
    db.prepare(`UPDATE spaces SET default_labels_json = ? WHERE id = ?`).run("{not-json", space.id);
    expect(getSpaceDefaultLabels(db, space.id)).toEqual({});
  });

  it("resolveSpaceId and isSpaceMember round-trip membership", () => {
    const userId = `user-${crypto.randomUUID()}`;
    const space = createSpace(db, {
      tenantId: "default-tenant",
      name: `Team-${crypto.randomUUID().slice(0, 6)}`,
      defaultLabels: { visibility: "internal" },
    });
    db.prepare(
      `INSERT INTO space_members (space_id, member_id, member_type, role) VALUES (?, ?, 'human', 'member')`,
    ).run(space.id, userId);
    expect(resolveSpaceId(db, "default-tenant", space.name)).toBe(space.id);
    expect(isSpaceMember(db, space.id, userId)).toBe(true);
    expect(getSpacesForUser(db, userId).map((s) => s.id)).toContain(space.id);
  });
});
