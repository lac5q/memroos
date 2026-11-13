// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { executeDsarDelete } from "../dsar";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("dsar batch32 — materializeExisting not-found parity", () => {
  it("executeDsarDelete returns dsar_request_not_found when row is absent (line 727 parity)", async () => {
    const database = freshDb();
    const result = await executeDsarDelete(database, {
      requestId: `dsar_missing_b32_${randomUUID()}`,
      planHash: "a".repeat(64),
      actorId: "operator-b32",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("dsar_request_not_found");
  });

});
