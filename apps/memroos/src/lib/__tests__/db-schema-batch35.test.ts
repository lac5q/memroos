// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION, getSchemaVersion, initSchema } from "@/lib/db-schema";

describe("db-schema batch35", () => {
  it("getSchemaVersion coerces string pragma values (branch near 77-78)", () => {
    const db = new Database(":memory:");
    db.pragma("user_version = 9");
    expect(getSchemaVersion(db)).toBe(9);
    db.close();
  });

  it("initSchema rejects databases newer than compiled schema", () => {
    const db = new Database(":memory:");
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION + 3}`);
    expect(() => initSchema(db)).toThrow(/newer than this code supports/);
    db.close();
  });

  it.skip("setSchemaVersion invalid negative version throw (83) — not exported and unreachable via migrations", () => {});
});
