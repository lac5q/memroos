// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { promoteCandidate } from "../promotion";

const TENANT = "default-tenant";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  initSchema(db);
  db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)`).run(TENANT, "Default");
  return db;
}

describe("belief promotion batch19b — missing candidate guardrails", () => {
  let db: Database.Database;

  afterEach(() => {
    db.close();
  });

  it("promoteCandidate throws when candidate id is unknown", () => {
    db = freshDb();
    expect(() =>
      promoteCandidate(db, {
        candidateId: randomUUID(),
        tenantId: TENANT,
        actor: { id: "operator", role: "operator" },
        category: "pricing",
      }),
    ).toThrow(/candidate not found/i);
  });
});
