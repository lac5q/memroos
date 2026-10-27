// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { exportSkillPackage, importSkillPackage, syncSkillsWithAgent } from "../multi-agent";

describe("skillforge multi-agent batch20b", () => {
  it("exportSkillPackage returns error when skill id is missing", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const result = exportSkillPackage(db, "999999");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
    db.close();
  });

  it("importSkillPackage rejects packages without passing eval receipts", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const result = importSkillPackage(db, {
      id: "pkg-1",
      skillId: "42",
      name: "Imported",
      content: "# Skill",
      metadata: {
        version: "1.0.0",
        author: "tester",
        tags: ["a"],
        evalReceipts: [{ provider: "local", model: "m", dimensions: { quality: 0.2 }, timestamp: "2026-07-01T00:00:00.000Z" }],
      },
      compatibility: ["memroos"],
      exportedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
    expect(result.errors.join(" ")).toMatch(/Eval validation failed/);
    db.close();
  });

  it("syncSkillsWithAgent aggregates export failures per skill id", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const result = syncSkillsWithAgent(db, "http://localhost:9999", ["missing-1", "missing-2"]);
    expect(result.success).toBe(false);
    expect(result.synced).toBe(0);
    expect(result.errors.length).toBe(2);
    db.close();
  });
});
