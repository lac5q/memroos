// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { MarketplaceGovernanceError, publishSkill } from "../marketplace";

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
         VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '2.0.0', '', '', '', '', ?, 100, '[]', 'batch30', ?, '', ?, 'signed', 'enabled', 'sig-b30')`,
      )
      .run(name, body, new Date().toISOString(), hash).lastInsertRowid,
  );
}

describe("skillforge marketplace batch30 — registry guard and governance catch", () => {
  it("findRegistryRow returns null for whitespace-only skillId (124)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const result = publishSkill(db, {
      skillId: "   ",
      name: "whitespace-id",
      description: "d",
      author: "a",
      tags: [],
      category: "general",
      changelog: "c",
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe("missing_skill_id");
    db.close();
  });

  it("publishSkill maps MarketplaceGovernanceError from the outer catch (459)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `gov-b30-${randomUUID().slice(0, 6)}`;
    const skillId = insertRegistryRow(db, name);
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO skill_marketplace")) {
        throw new MarketplaceGovernanceError("governance blocked batch30", "lifecycle_blocked");
      }
      return originalPrepare(sql);
    });
    const result = publishSkill(db, {
      skillId: String(skillId),
      name: "Listed",
      description: "d",
      author: "a",
      tags: [],
      category: "general",
      changelog: "c",
      sourceHarness: "memroos",
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe("lifecycle_blocked");
    vi.restoreAllMocks();
    db.close();
  });
});
