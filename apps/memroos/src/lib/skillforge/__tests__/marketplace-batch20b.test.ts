// @vitest-environment node
import { createHash } from "crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { checkDispatchEligibility, publishGovernedSkill } from "../marketplace";

function insertRegistryRow(
  db: Database.Database,
  row: {
    name: string;
    dispatch_status: string;
    completeness_pct: number;
    lifecycle_state: string | null;
    raw_body: string;
    content_hash: string;
    signature?: string | null;
  },
): number {
  const info = db
    .prepare(
      `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
          version, preconditions, allowed_tools, verification_checks, rollback_behavior,
          raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
          evidence_examples, content_hash, trust_level, lifecycle_state, signature)
       VALUES (?, '', 'ops', 'memroos', 'low', ?, '1.0.0', '', '', '', '', ?, ?, '[]', 'batch20b', ?, '', ?, 'signed', ?, ?)`,
    )
    .run(
      row.name,
      row.dispatch_status,
      row.raw_body,
      row.completeness_pct,
      new Date().toISOString(),
      row.content_hash,
      row.lifecycle_state,
      row.signature ?? null,
    );
  return Number(info.lastInsertRowid);
}

describe("skillforge marketplace batch20b", () => {
  it("checkDispatchEligibility flags tampered content hashes", () => {
    const body = "# Skill body";
    const goodHash = createHash("sha256").update(body).digest("hex");
    const eligibility = checkDispatchEligibility({
      id: 1,
      name: "tampered",
      source_harness: "memroos",
      dispatch_status: "enabled",
      completeness_pct: 100,
      lifecycle_state: "enabled",
      content_hash: goodHash,
      raw_body: `${body}-changed`,
      signature: null,
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toMatch(/tamper/i);
  });

  it("checkDispatchEligibility rejects retired lifecycle", () => {
    const eligibility = checkDispatchEligibility({
      id: 2,
      name: "retired",
      source_harness: "memroos",
      dispatch_status: "enabled",
      completeness_pct: 100,
      lifecycle_state: "retired",
      content_hash: null,
      raw_body: null,
      signature: null,
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toMatch(/retired/i);
  });

  it("publishGovernedSkill throws MarketplaceGovernanceError for unknown skills", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const missing = publishGovernedSkill(db, "missing-skill-b20b", {
      name: "Missing",
      description: "n/a",
      author: "test",
      tags: [],
      category: "ops",
      changelog: "none",
    });
    expect(missing.success).toBe(false);
    expect(missing.code).toBe("skill_not_found");
    db.close();
  });

  it("publishGovernedSkill succeeds for governed enabled registry row", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const body = "---\nname: batch20b\n---\n# Body";
    const hash = createHash("sha256").update(body).digest("hex");
    const registryId = insertRegistryRow(db, {
      name: "batch20b-skill",
      dispatch_status: "enabled",
      completeness_pct: 100,
      lifecycle_state: "enabled",
      raw_body: body,
      content_hash: hash,
      signature: "sig-batch20b",
    });
    const listing = publishGovernedSkill(
      db,
      String(registryId),
      {
        name: "Batch20b Skill",
        description: "Coverage skill",
        author: "tester",
        tags: ["coverage"],
        category: "ops",
        changelog: "initial",
      },
      { requireSigned: true, actor: "tester" },
    );
    expect(listing.success).toBe(true);
    expect(listing.listingId).toMatch(/^market-/);
    db.close();
  });
});
