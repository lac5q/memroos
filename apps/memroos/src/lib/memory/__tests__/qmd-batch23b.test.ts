// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { finalizeQmdUpdate, serializeQmdUpdate } from "@/lib/memory/qmd";

let db: Database.Database | null = null;

function qmdDb(): Database.Database {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE memory_qmd_updates (
      id TEXT PRIMARY KEY,
      target_path TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      freshness_timestamp TEXT NOT NULL,
      last_success_timestamp TEXT
    );
  `);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("memory qmd batch23b — finalize branches", () => {
  it("finalizeQmdUpdate throws when the update id is unknown", () => {
    const database = qmdDb();
    serializeQmdUpdate(database, "/vault/index.md", "body", new Date("2026-10-30T00:00:00.000Z"));
    expect(() => finalizeQmdUpdate(database, "qmd_upd_missing", "success")).toThrow(/not found/);
  });

  it("finalizeQmdUpdate records lastSuccessTimestamp only on success", () => {
    const database = qmdDb();
    const pending = serializeQmdUpdate(database, "/vault/index.md", "body-v2", new Date("2026-10-30T00:00:00.000Z"));
    const failed = finalizeQmdUpdate(database, pending.id, "failed", new Date("2026-10-30T00:00:05.000Z"));
    expect(failed.status).toBe("failed");
    expect(failed.lastSuccessTimestamp).toBeUndefined();

    const pending2 = serializeQmdUpdate(database, "/vault/other.md", "body-v3", new Date("2026-10-30T00:00:10.000Z"));
    const ok = finalizeQmdUpdate(database, pending2.id, "success", new Date("2026-10-30T00:00:15.000Z"));
    expect(ok.status).toBe("success");
    expect(ok.lastSuccessTimestamp).toBe("2026-10-30T00:00:15.000Z");
  });
});
