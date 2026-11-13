// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION, initSchema } from "@/lib/db-schema";

describe("db-schema batch28 — newer-than-code guard (setSchemaVersion invalid guard unreachable)", () => {
  it("initSchema throws when SQLite user_version exceeds CURRENT_SCHEMA_VERSION (lines 258-261)", () => {
    const db = new Database(":memory:");
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION + 1}`);
    expect(() => initSchema(db)).toThrow(/newer than this code supports/);
    db.close();
  });
});
