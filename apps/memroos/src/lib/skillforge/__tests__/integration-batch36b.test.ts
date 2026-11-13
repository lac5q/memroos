// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { initSchema } from "@/lib/db-schema";
import { updateSkillRegistry } from "../integration";
import type { SkillForgeProposal } from "../types";

let db: Database.Database | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe("skillforge integration batch36b", () => {
  it("updateSkillRegistry returns structured error when id is invalid (267)", () => {
    db = new Database(":memory:");
    initSchema(db);
    const proposal = {
      sourceSkillId: `not-numeric-${randomUUID().slice(0, 6)}`,
      sourceVersion: "1.0.0",
    } as SkillForgeProposal;
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("UPDATE skill_registry")) {
        throw new Error("forced batch36b registry failure");
      }
      return originalPrepare(sql);
    });
    const result = updateSkillRegistry(db, proposal);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/forced batch36b/i);
  });
});
