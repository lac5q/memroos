// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  checkDispatchEligibility,
  publishGovernedSkill,
  publishSkill,
  searchListings,
} from "../marketplace";

function insertRow(
  db: Database.Database,
  name: string,
  harness: string,
  overrides: Partial<{
    dispatch_status: string;
    completeness_pct: number;
    lifecycle_state: string | null;
    raw_body: string;
    content_hash: string;
    signature: string | null;
  }> = {},
): number {
  const body = overrides.raw_body ?? `---\nname: ${name}\n---\n# ${name}`;
  const hash = overrides.content_hash ?? createHash("sha256").update(body).digest("hex");
  return Number(
    db
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
            evidence_examples, content_hash, trust_level, lifecycle_state, signature)
         VALUES (?, '', 'ops', ?, 'low', ?, '1.0.0', '', '', '', '', ?, ?, '[]', 'batch35', ?, '', ?, 'signed', ?, ?)`,
      )
      .run(
        name,
        harness,
        overrides.dispatch_status ?? "enabled",
        body,
        overrides.completeness_pct ?? 100,
        new Date().toISOString(),
        hash,
        overrides.lifecycle_state ?? "enabled",
        overrides.signature ?? "sig-b35",
      )
      .lastInsertRowid,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("skillforge marketplace batch35", () => {
  it("findRegistryRow returns null for blank skillId (124)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(() =>
      publishSkill(db, {
        skillId: "   ",
        name: "x",
        description: "d",
        author: "a",
        tags: [],
        category: "general",
        changelog: "c",
      }),
    ).not.toThrow();
    const result = publishSkill(db, {
      skillId: "   ",
      name: "x",
      description: "d",
      author: "a",
      tags: [],
      category: "general",
      changelog: "c",
    });
    expect(result.success).toBe(false);
    db.close();
  });

  it("publishSkill resolves numeric registry id strings (128–141)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `numeric-b35-${randomUUID().slice(0, 6)}`;
    const skillId = insertRow(db, name, "memroos");
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
    expect(result.success).toBe(true);
    db.close();
  });

  it("publishGovernedSkill rejects quarantine rejected skills (247–249)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `quar-b35-${randomUUID().slice(0, 6)}`;
    const skillId = insertRow(db, name, "memroos");
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_quarantine (skill_id, stage, scanner_result, eval_score, approval_status, created_at, updated_at)
       VALUES (?, 'rejected', '{}', 0, 'rejected', ?, ?)`,
    ).run(skillId, now, now);
    const result = publishGovernedSkill(
      db,
      String(skillId),
      { name: "Q", description: "d", author: "a", tags: [], category: "general", changelog: "c" },
      { sourceHarness: "memroos" },
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("quarantine_rejected");
    db.close();
  });

  it("checkDispatchEligibility allows null lifecycle legacy rows", () => {
    const base = {
      id: 1,
      name: "skill",
      source_harness: "memroos",
      dispatch_status: "enabled",
      completeness_pct: 100,
      lifecycle_state: null,
      content_hash: createHash("sha256").update("body").digest("hex"),
      raw_body: "body",
      signature: "sig",
      version: "1.0.0",
    };
    expect(checkDispatchEligibility(base).eligible).toBe(true);
  });

  it("searchListings applies tag filter and rating sort branches", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `tag-b35-${randomUUID().slice(0, 6)}`;
    const skillId = insertRow(db, name, "memroos");
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_marketplace (id, skill_id, name, description, author, tags, version, changelog, rating, review_count, download_count, category, published_at, updated_at, deprecated)
       VALUES (?, ?, ?, ?, 'a', '["batch35"]', '1.0.0', 'c', 4.2, 2, 1, 'general', ?, ?, 0)`,
    ).run(`list-b35-${randomUUID().slice(0, 4)}`, String(skillId), name, "tagged listing", now, now);
    const { listings } = searchListings(db, { tags: ["batch35"], sortBy: "rating", limit: 5, offset: 0 });
    expect(listings.some((l) => l.skillId === String(skillId))).toBe(true);
    db.close();
  });

  it("publishSkill surfaces skill_not_found via governance wrapper", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const result = publishSkill(db, {
      skillId: `missing-b35-${randomUUID().slice(0, 8)}`,
      name: "X",
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

  it("returns ambiguous_harness when name exists in multiple harnesses", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `ambig-b35-${randomUUID().slice(0, 6)}`;
    insertRow(db, name, "memroos");
    insertRow(db, name, "codex");
    const result = publishGovernedSkill(
      db,
      name,
      { name: "L", description: "d", author: "a", tags: [], category: "general", changelog: "c" },
      {},
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("ambiguous_harness");
    db.close();
  });
});
