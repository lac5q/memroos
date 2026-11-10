// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { publishSkill, searchListings } from "../marketplace";

function insertRegistryRow(db: Database.Database, name: string, overrides: Record<string, unknown> = {}): number {
  const body = `---\nname: ${name}\n---\n# ${name}`;
  const hash = (overrides.content_hash as string) ?? createHash("sha256").update(body).digest("hex");
  const lifecycle = (overrides.lifecycle_state as string | null) ?? "enabled";
  return Number(
    db
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
            evidence_examples, content_hash, trust_level, lifecycle_state, signature)
         VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '2.1.0', '', '', '', '', ?, 100, '[]', 'batch26', ?, '', ?, 'signed', ?, 'sig-b26')`,
      )
      .run(name, body, new Date().toISOString(), hash, lifecycle).lastInsertRowid,
  );
}

describe("skillforge marketplace batch26 — publish rethrow and search dispatch denials", () => {
  it("publishSkill surfaces unexpected registry lookup failures from enforceRegistryBoundPublish", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `pub-fail-b26-${randomUUID().slice(0, 6)}`;
    const skillId = insertRegistryRow(db, name);
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("FROM skill_registry") && sql.includes("WHERE id = ?")) {
        throw new Error("registry_read_failed_batch26");
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
    expect(result.error).toMatch(/registry_read_failed_batch26/);
    vi.restoreAllMocks();
    db.close();
  });

  it("searchListings marks listings not dispatchable when registry row fails eligibility", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `search-b26-${randomUUID().slice(0, 6)}`;
    const skillId = insertRegistryRow(db, name, { content_hash: "0".repeat(64) });
    const listingId = `list-b26-${skillId}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_marketplace (id, skill_id, name, description, author, tags, version, changelog, rating, review_count, download_count, category, published_at, updated_at, deprecated)
       VALUES (?, ?, 'Listed', 'd', 'a', '[]', '2.1.0', 'c', 5, 1, 0, 'general', ?, ?, 0)`,
    ).run(listingId, String(skillId), now, now);

    const { listings } = searchListings(db, { query: "Listed" });
    expect(listings).toHaveLength(1);
    expect(listings[0]?.isDispatchable).toBe(false);
    expect(listings[0]?.dispatchDenialReason).toMatch(/tamper/i);
    db.close();
  });

  it("publishSkill returns governance errors without rethrowing MarketplaceGovernanceError", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const result = publishSkill(db, {
      skillId: "999999",
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
});
