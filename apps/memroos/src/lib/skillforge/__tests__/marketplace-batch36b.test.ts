// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { publishGovernedSkill, publishSkill } from "../marketplace";

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

describe("skillforge marketplace batch36b", () => {
  it("findRegistryRow trim guard rejects blank skill identifiers (124)", () => {
    const database = freshDb();
    const result = publishGovernedSkill(
      database,
      "   ",
      { name: "X", description: "d", author: "a", tags: [], category: "general", changelog: "c" },
      {},
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("missing_skill_id");
  });

  it("numeric registry id lookup path resolves governed publish (131–141)", () => {
    const database = freshDb();
    const body = `body-b36b-${randomUUID()}`;
    const hash = createHash("sha256").update(body, "utf8").digest("hex");
    const insert = database
      .prepare(
        `INSERT INTO skill_registry (
          name, description, owner, source_harness, risk_tier, dispatch_status,
          version, raw_body, completeness_pct, imported_by, imported_at, content_hash, trust_level, lifecycle_state, signature
        ) VALUES (?, '', 'ops', 'claude', 'low', 'enabled', '1.0.0', ?, 100, 'op', ?, ?, 'signed', 'enabled', 'sig')`,
      )
      .run(`num-b36b-${randomUUID().slice(0, 8)}`, body, new Date().toISOString(), hash);
    const id = String(insert.lastInsertRowid);
    const legacy = publishSkill(database, {
      skillId: id,
      name: "Listed",
      description: "d",
      author: "a",
      tags: [],
      category: "general",
      changelog: "c",
    });
    expect(legacy.success).toBe(true);
  });
});
