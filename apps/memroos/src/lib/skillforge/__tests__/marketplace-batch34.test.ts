// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  MarketplaceGovernanceError,
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
         VALUES (?, '', 'ops', ?, 'low', ?, '1.0.0', '', '', '', '', ?, ?, '[]', 'batch34', ?, '', ?, 'signed', ?, ?)`,
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
        overrides.signature ?? "sig-b34",
      )
      .lastInsertRowid,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("skillforge marketplace batch34 — dispatch branches and search filters", () => {
  it("checkDispatchEligibility covers disabled, incomplete, retired, and tamper branches", () => {
    const base = {
      id: 1,
      name: "skill",
      source_harness: "memroos",
      dispatch_status: "enabled",
      completeness_pct: 100,
      lifecycle_state: "enabled",
      content_hash: "a".repeat(64),
      raw_body: "body",
      signature: "sig",
      version: "1.0.0",
    };
    expect(checkDispatchEligibility(null).eligible).toBe(false);
    expect(checkDispatchEligibility({ ...base, dispatch_status: "disabled" }).reason).toMatch(/not enabled/);
    expect(checkDispatchEligibility({ ...base, completeness_pct: 50 }).reason).toMatch(/incomplete/);
    expect(checkDispatchEligibility({ ...base, lifecycle_state: "retired" }).reason).toMatch(/retired/);
    expect(
      checkDispatchEligibility({ ...base, content_hash: "b".repeat(64) }).reason,
    ).toMatch(/tamper/i);
  });

  it("publishSkill returns ambiguous_harness when name exists in multiple harnesses (165–171)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `ambig-b34-${randomUUID().slice(0, 6)}`;
    insertRow(db, name, "memroos");
    insertRow(db, name, "codex");
    const result = publishSkill(db, {
      skillId: name,
      name: "Listed",
      description: "d",
      author: "a",
      tags: [],
      category: "general",
      changelog: "c",
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe("ambiguous_harness");
    db.close();
  });

  it("publishGovernedSkill rejects unsigned skills when requireSigned is set (304–308)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `unsigned-b34-${randomUUID().slice(0, 6)}`;
    const skillId = insertRow(db, name, "memroos", { signature: "" });
    const result = publishGovernedSkill(
      db,
      String(skillId),
      {
        name: "Unsigned",
        description: "d",
        author: "ops",
        tags: [],
        category: "general",
        changelog: "c",
      },
      { requireSigned: true, sourceHarness: "memroos" },
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("unsigned");
    db.close();
  });

  it("searchListings filters, sorts, and marks non-dispatchable listings (211–345, 497, 519)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const okName = `ok-b34-${randomUUID().slice(0, 6)}`;
    const badName = `bad-b34-${randomUUID().slice(0, 6)}`;
    const okId = insertRow(db, okName, "memroos");
    const badId = insertRow(db, badName, "memroos", { dispatch_status: "disabled" });
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO skill_marketplace (id, skill_id, name, description, author, tags, version, changelog, rating, review_count, download_count, category, published_at, updated_at, deprecated)
       VALUES (?, ?, ?, ?, 'a', '[]', '1.0.0', 'c', 4.5, 1, 3, 'general', ?, ?, 0)`,
    ).run(`list-ok-b34-${randomUUID().slice(0, 4)}`, String(okId), okName, "ok desc", now, now);
    db.prepare(
      `INSERT INTO skill_marketplace (id, skill_id, name, description, author, tags, version, changelog, rating, review_count, download_count, category, published_at, updated_at, deprecated)
       VALUES (?, ?, ?, ?, 'a', '["batch34"]', '1.0.0', 'c', 1.0, 0, 0, 'general', ?, ?, 0)`,
    ).run(`list-bad-b34-${randomUUID().slice(0, 4)}`, String(badId), badName, "disabled skill", now, now);

    const { listings, total } = searchListings(db, {
      query: "disabled skill",
      minRating: 0,
      sortBy: "newest",
      limit: 10,
      offset: 0,
    });
    expect(total).toBeGreaterThanOrEqual(1);
    const disabled = listings.find((l) => l.skillId === String(badId));
    expect(disabled?.isDispatchable).toBe(false);
    expect(disabled?.dispatchDenialReason).toMatch(/not enabled/);
    db.close();
  });

  it("publishSkill maps MarketplaceGovernanceError from insert failures (391, 461)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `gov-b34-${randomUUID().slice(0, 6)}`;
    const skillId = insertRow(db, name, "memroos");
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO skill_marketplace")) {
        throw new MarketplaceGovernanceError("blocked batch34", "lifecycle_blocked");
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
    db.close();
  });
});
