// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { finalizeQmdUpdate, serializeQmdUpdate } from "@/lib/memory/qmd";

describe("memory/qmd batch32 — rethrow non-missing-table errors", () => {
  it("serializeQmdUpdate rethrows insert failures other than missing table (49)", () => {
    const db = new Database(":memory:");
    const broken = {
      prepare: () => ({
        run: () => {
          throw new Error("disk I/O batch32");
        },
      }),
    } as unknown as Database.Database;
    expect(() => serializeQmdUpdate(broken, `/tmp/${randomUUID()}.md`, "body-b32")).toThrow(/disk I\/O batch32/);
    db.close();
  });

  it("finalizeQmdUpdate rethrows update failures other than missing table (98)", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE memory_qmd_updates (
        id TEXT PRIMARY KEY,
        target_path TEXT,
        source_hash TEXT,
        status TEXT,
        freshness_timestamp TEXT,
        last_success_timestamp TEXT
      );
    `);
    const pending = serializeQmdUpdate(db, "docs/b32.md", "payload-b32");
    const broken = {
      prepare: (sql: string) => {
        if (sql.includes("SELECT")) {
          return db.prepare(sql);
        }
        return {
          run: () => {
            throw new Error("locked batch32");
          },
        };
      },
    } as unknown as Database.Database;
    expect(() => finalizeQmdUpdate(broken, pending.id, "success")).toThrow(/locked batch32/);
    db.close();
  });
});
