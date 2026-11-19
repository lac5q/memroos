import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { serializeQmdUpdate, finalizeQmdUpdate } from "../qmd";

describe("QMD Serializer", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
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
  });

  it("VAL-MEM-012: qmd updates are serialized with bounded freshness states", () => {
    const state = serializeQmdUpdate(db, "target/path.md", "content");
    
    expect(state.status).toBe("pending");
    expect(state.id).toContain("qmd_upd_");
    
    const finalized = finalizeQmdUpdate(db, state.id, "success");
    expect(finalized.status).toBe("success");
    expect(finalized.lastSuccessTimestamp).toBeDefined();
    
    // Test failure doesn't advance lastSuccessTimestamp
    const failState = serializeQmdUpdate(db, "target/path2.md", "content2");
    const failedFinal = finalizeQmdUpdate(db, failState.id, "failed");
    expect(failedFinal.status).toBe("failed");
    expect(failedFinal.lastSuccessTimestamp).toBeFalsy();
  });

  it("tolerates missing qmd tables", () => {
    const bareDb = new Database(":memory:");
    const state = serializeQmdUpdate(bareDb, "orphan/path.md", "content");
    expect(state.status).toBe("pending");

    const finalized = finalizeQmdUpdate(bareDb, state.id, "timeout");
    expect(finalized.status).toBe("timeout");
  });

  it("reports unknown update ids when the table exists", () => {
    expect(() => finalizeQmdUpdate(db, "missing-update", "success")).toThrow(/not found/i);
  });

  it("rethrows unexpected database errors during finalize", () => {
    const broken = {
      prepare: () => ({
        get: () => {
          throw new Error("disk failure");
        },
        run: () => undefined,
      }),
    } as unknown as Database.Database;
    expect(() => finalizeQmdUpdate(broken, "id-1", "success")).toThrow(/disk failure/);
  });

  it("records cancelled outcomes without advancing last success", () => {
    const state = serializeQmdUpdate(db, "target/path3.md", "content3");
    const cancelled = finalizeQmdUpdate(db, state.id, "cancelled");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.lastSuccessTimestamp).toBeFalsy();
  });
});
