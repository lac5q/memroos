// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

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
         VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '2.0.0', '', '', '', '', ?, 100, '[]', 'batch24', ?, '', ?, 'signed', 'enabled', ?)`,
      )
      .run(name, body, new Date().toISOString(), hash, "sig-b24")
      .lastInsertRowid,
  );
}

describe("skillforge marketplace batch24 — search filters and registry lookup", () => {
  it("searchListings filters by category and minimum rating", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = insertRegistryRow(db, `market-b24-${randomUUID().slice(0, 6)}`);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_marketplace (id, skill_id, name, description, author, tags, version, changelog, rating, review_count, download_count, category, published_at, updated_at, deprecated)
       VALUES (?, ?, 'Listed', 'd', 'a', '[]', '2.0.0', 'c', 4.5, 1, 3, 'security', ?, ?, 0)`,
    ).run(`market-${skillId}`, String(skillId), now, now);
    const { listings, total } = marketplace.searchListings(db, {
      category: "security",
      minRating: 4,
      sortBy: "downloads",
      limit: 5,
    });
    expect(total).toBe(1);
    expect(listings[0]?.category).toBe("security");
    db.close();
  });

  it("publishSkill resolves registry version when findRegistryRow succeeds", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `pub-b24-${randomUUID().slice(0, 6)}`;
    const skillId = insertRegistryRow(db, name);
    const result = marketplace.publishSkill(db, {
      skillId: String(skillId),
      name: "Published",
      description: "d",
      author: "a",
      tags: ["batch24"],
      category: "general",
      changelog: "c",
    });
    expect(result.success).toBe(true);
    const row = db
      .prepare(`SELECT version FROM skill_marketplace WHERE skill_id = ?`)
      .get(String(skillId)) as { version: string };
    expect(row.version).toBe("2.0.0");
    db.close();
  });

  it("publishSkill rejects blank skill ids before registry lookup", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const result = marketplace.publishSkill(db, {
      skillId: "   ",
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
});
