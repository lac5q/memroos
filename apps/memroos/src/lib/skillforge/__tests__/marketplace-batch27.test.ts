// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { publishSkill } from "../marketplace";

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
         VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '2.1.0', '', '', '', '', ?, 100, '[]', 'batch27', ?, '', ?, 'signed', 'enabled', 'sig-b27')`,
      )
      .run(name, body, new Date().toISOString(), hash).lastInsertRowid,
  );
}

describe("skillforge marketplace batch27 — findRegistryRow guard and governance catch", () => {
  it("publishSkill rejects blank skillId before registry lookup", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const result = publishSkill(db, {
      skillId: "",
      name: "blank-id",
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

  it("publishSkill returns governance errors without rethrowing MarketplaceGovernanceError", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `gov-b27-${randomUUID().slice(0, 6)}`;
    const skillId = insertRegistryRow(db, name);
    db.prepare("UPDATE skill_registry SET lifecycle_state = 'draft' WHERE id = ?").run(skillId);
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
    expect(result.code).toBeDefined();
    db.close();
  });

  it("publishSkill surfaces unexpected registry read failures", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `read-fail-b27-${randomUUID().slice(0, 6)}`;
    const skillId = insertRegistryRow(db, name);
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("FROM skill_registry") && sql.includes("WHERE id = ?")) {
        throw new Error("registry_read_failed_batch27");
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
    expect(result.error).toMatch(/registry_read_failed_batch27/);
    vi.restoreAllMocks();
    db.close();
  });
});
