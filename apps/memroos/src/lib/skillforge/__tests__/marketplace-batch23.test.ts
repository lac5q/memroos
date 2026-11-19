// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as marketplace from "../marketplace";

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
         VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'batch23', ?, '', ?, 'signed', 'enabled', ?)`,
      )
      .run(name, body, new Date().toISOString(), hash, "sig-b23")
      .lastInsertRowid,
  );
}

describe("skillforge marketplace batch23 — findRegistryRow and publish error paths", () => {
  it("publishSkill rejects whitespace skillId via findRegistryRow guard", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const result = marketplace.publishSkill(db, {
      skillId: "  ",
      name: "x",
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

  it("publishSkill surfaces governance errors without rethrowing", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const result = marketplace.publishSkill(db, {
      skillId: "404404",
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

  it("publishSkill returns generic failure when listing insert throws", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertRegistryRow(db, `market-b23-${randomUUID().slice(0, 6)}`);
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      const stmt = originalPrepare(sql);
      if (sql.includes("INSERT INTO skill_marketplace")) {
        return {
          run: () => {
            throw new Error("insert_failed_batch23");
          },
        } as ReturnType<typeof db.prepare>;
      }
      return stmt;
    });
    const result = marketplace.publishSkill(db, {
      skillId: String(skillId),
      name: "listed",
      description: "d",
      author: "a",
      tags: [],
      category: "general",
      changelog: "c",
      sourceHarness: "memroos",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/insert_failed_batch23/);
    vi.restoreAllMocks();
    db.close();
  });
});
