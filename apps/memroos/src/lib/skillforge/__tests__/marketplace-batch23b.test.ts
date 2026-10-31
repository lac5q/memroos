// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as marketplace from "../marketplace";

function insertRegistryRow(db: Database.Database, name: string, harness = "memroos"): number {
  const body = `---\nname: ${name}\n---\n# ${name}`;
  const hash = createHash("sha256").update(body).digest("hex");
  return Number(
    db
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
            evidence_examples, content_hash, trust_level, lifecycle_state, signature)
         VALUES (?, '', 'ops', ?, 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'batch23b', ?, '', ?, 'signed', 'enabled', ?)`,
      )
      .run(name, harness, body, new Date().toISOString(), hash, "sig-b23b")
      .lastInsertRowid,
  );
}

describe("skillforge marketplace batch23b — registry lookup by numeric id", () => {
  it("publishSkill resolves numeric skill ids", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillName = `market-b23b-${randomUUID().slice(0, 6)}`;
    const skillId = insertRegistryRow(db, skillName, "codex");
    const byId = marketplace.publishSkill(db, {
      skillId: String(skillId),
      name: skillName,
      description: "listed by id",
      author: "author",
      tags: ["batch23b"],
      category: "general",
      changelog: "initial",
    });
    expect(byId.success).toBe(true);
    db.close();
  });
});
