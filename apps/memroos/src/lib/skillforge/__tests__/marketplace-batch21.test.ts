// @vitest-environment node
import { createHash } from "crypto";
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
         VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'batch21', ?, '', ?, 'signed', 'enabled', ?)`,
      )
      .run(name, body, new Date().toISOString(), hash, "sig-batch21")
      .lastInsertRowid,
  );
}

describe("skillforge marketplace batch21 — non-governance errors", () => {
  it("publishGovernedSkill wraps unexpected throws as generic failures", () => {
    const broken = {
      prepare() {
        throw new TypeError("prepare exploded");
      },
    } as unknown as Database.Database;
    const result = publishGovernedSkill(
      broken,
      "1",
      {
        name: "x",
        description: "d",
        author: "a",
        tags: [],
        category: "general",
        changelog: "c",
      },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/prepare exploded/);
  });

  it("publishSkill returns structured errors for unknown registry ids", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const result = publishSkill(db, {
      skillId: "99999",
      name: "missing",
      description: "d",
      author: "a",
      tags: [],
      category: "general",
      changelog: "c",
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe("skill_not_found");
    db.close();
  });

  it("publishSkill succeeds for governed registry rows", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertRegistryRow(db, `market-b21-${createHash("sha256").update("x").digest("hex").slice(0, 8)}`);
    const result = publishSkill(db, {
      skillId: String(skillId),
      name: "listed",
      description: "d",
      author: "a",
      tags: ["ops"],
      category: "general",
      changelog: "initial",
      sourceHarness: "memroos",
    });
    expect(result.success).toBe(true);
    expect(result.listingId).toMatch(/^market-/);
    db.close();
  });
});
