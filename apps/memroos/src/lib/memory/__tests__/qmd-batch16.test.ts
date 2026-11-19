// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { finalizeQmdUpdate, serializeQmdUpdate } from "@/lib/memory/qmd";

describe("memory/qmd batch16", () => {
  it("serializes and finalizes updates when memory_qmd_updates table is absent", () => {
    const db = new Database(":memory:");
    const pending = serializeQmdUpdate(db, "/tmp/batch16-target.md", "batch16 source body");
    expect(pending.status).toBe("pending");
    expect(pending.targetPath).toBe("/tmp/batch16-target.md");

    const finalized = finalizeQmdUpdate(db, pending.id, "success", new Date("2026-10-23T12:00:00.000Z"));
    expect(finalized.status).toBe("success");
    expect(finalized.lastSuccessTimestamp).toBe("2026-10-23T12:00:00.000Z");
    db.close();
  });

  it("throws when finalizing an unknown update id in a populated table", () => {
    const db = new Database(":memory:");
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
    expect(() => finalizeQmdUpdate(db, "missing-batch16-id", "failed")).toThrow(
      /QMD update missing-batch16-id not found/,
    );
    db.close();
  });
});
