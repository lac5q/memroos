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

describe("dsar batch27 — materialize not found, audit link inventory", () => {
  it("executeDsarDelete returns dsar_request_not_found for unknown request ids", async () => {
    const database = freshDb();
    const result = await executeDsarDelete(database, {
      requestId: `ghost-b27-${randomUUID()}`,
      planHash: "abc",
      actorId: "operator",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("dsar_request_not_found");
  });
});
