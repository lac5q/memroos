// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION, initSchema } from "@/lib/db-schema";

describe("db-schema batch32 — migration guards", () => {
  // sticky: setSchemaVersion invalid-version throw (83) — migrations only pass non-negative integers.

  it("initSchema leaves user_version at CURRENT_SCHEMA_VERSION on fresh databases", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const version = db.pragma("user_version", { simple: true });
    expect(version).toBe(CURRENT_SCHEMA_VERSION);
    db.close();
  });

  it("initSchema rejects databases newer than the compiled schema", () => {
    const db = new Database(":memory:");
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION + 5}`);
    expect(() => initSchema(db)).toThrow(/newer than this code supports/);
    db.close();
  });
});
