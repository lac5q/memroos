// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { publishGovernedSkill, publishSkill } from "../marketplace";

function insertRegistryRow(db: Database.Database, name: string): number {
  const body = `---\nname: ${name}\n---\n# ${name}`;
  const hash = createHash("sha256").update(body).digest("hex");
  return Number(
    db
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
            evidence_examples, content_hash, trust_level, lifecycle_state, signature)
         VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '2.1.0', '', '', '', '', ?, 100, '[]', 'batch28b', ?, '', ?, 'signed', 'enabled', 'sig-b28b')`,
      )
      .run(name, body, new Date().toISOString(), hash).lastInsertRowid,
  );
}

describe("skillforge marketplace batch28b — not found and governed publish", () => {
  it("publishSkill returns skill_not_found for unknown registry ids", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const missingId = `999999-${randomUUID().slice(0, 6)}`;
    const result = publishSkill(db, {
      skillId: missingId,
      name: "missing",
      description: "d",
      author: "a",
      tags: [],
      category: "general",
      changelog: "c",
      sourceHarness: "memroos",
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe("skill_not_found");
    db.close();
  });

  it("publishGovernedSkill succeeds for dispatchable signed registry rows", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `pub-b28b-${randomUUID().slice(0, 6)}`;
    const skillId = insertRegistryRow(db, name);
    const result = publishGovernedSkill(
      db,
      String(skillId),
      {
        name: "Listed B28B",
        description: "desc",
        author: "ops",
        tags: ["batch28b"],
        category: "general",
        changelog: "initial",
      },
      { sourceHarness: "memroos" },
    );
    expect(result.success).toBe(true);
    expect(result.listingId).toMatch(/^market-/);
    db.close();
  });
});
