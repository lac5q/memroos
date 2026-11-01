// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  checkDispatchEligibility,
  deprecateSkill,
  publishGovernedSkill,
  recordDownload,
  submitReview,
} from "../marketplace";

function insertRegistryRow(db: Database.Database, name: string, overrides: Record<string, unknown> = {}): number {
  const body = `---\nname: ${name}\n---\n# ${name}`;
  const hash = createHash("sha256").update(body).digest("hex");
  const dispatchStatus = (overrides.dispatch_status as string) ?? "enabled";
  const lifecycle = (overrides.lifecycle_state as string | null) ?? "enabled";
  const pct = (overrides.completeness_pct as number) ?? 100;
  const storedHash = (overrides.content_hash as string) ?? hash;
  return Number(
    db
      .prepare(
        `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
            evidence_examples, content_hash, trust_level, lifecycle_state, signature)
         VALUES (?, '', 'ops', 'memroos', 'low', ?, '2.0.0', '', '', '', '', ?, ?, '[]', 'batch25b', ?, '', ?, 'signed', ?, 'sig-b25b')`,
      )
      .run(name, dispatchStatus, body, pct, new Date().toISOString(), storedHash, lifecycle)
      .lastInsertRowid,
  );
}

describe("skillforge marketplace batch25b — eligibility, reviews, deprecate", () => {
  it("checkDispatchEligibility flags tamper, retired lifecycle, and incomplete rows", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `elig-b25b-${randomUUID().slice(0, 6)}`;
    const skillId = insertRegistryRow(db, name);
    const row = db.prepare(`SELECT * FROM skill_registry WHERE id = ?`).get(skillId) as {
      dispatch_status: string;
      completeness_pct: number;
      lifecycle_state: string | null;
      content_hash: string;
      raw_body: string;
    };
    expect(checkDispatchEligibility(null).eligible).toBe(false);
    expect(checkDispatchEligibility({ ...row, id: skillId, name } as never).eligible).toBe(true);

    const tampered = checkDispatchEligibility({
      ...row,
      id: skillId,
      name,
      content_hash: "f".repeat(64),
    } as never);
    expect(tampered.eligible).toBe(false);
    expect(tampered.reason).toMatch(/tamper/i);

    const retired = checkDispatchEligibility({
      ...row,
      id: skillId,
      name,
      lifecycle_state: "retired",
    } as never);
    expect(retired.eligible).toBe(false);
    expect(retired.reason).toMatch(/retired/i);

    db.close();
  });

  it("publishGovernedSkill rejects unsigned registry rows when requireSigned is set", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `unsigned-b25b-${randomUUID().slice(0, 6)}`;
    const body = `---\nname: ${name}\n---\n# u`;
    const hash = createHash("sha256").update(body).digest("hex");
    const skillId = Number(
      db
        .prepare(
          `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
              version, preconditions, allowed_tools, verification_checks, rollback_behavior,
              raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
              evidence_examples, content_hash, trust_level, lifecycle_state, signature)
           VALUES (?, '', 'ops', 'memroos', 'low', 'enabled', '1.0.0', '', '', '', '', ?, 100, '[]', 'batch25b', ?, '', ?, 'unsigned', 'enabled', NULL)`,
        )
        .run(name, body, new Date().toISOString(), hash).lastInsertRowid,
    );
    const result = publishGovernedSkill(
      db,
      String(skillId),
      {
        name: "Listed",
        description: "d",
        author: "a",
        tags: [],
        category: "general",
        changelog: "c",
      },
      { requireSigned: true },
    );
    expect(result.success).toBe(false);
    expect(result.code).toBe("unsigned");
    db.close();
  });

  it("submitReview, recordDownload, and deprecateSkill mutate marketplace rows", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const name = `market-b25b-${randomUUID().slice(0, 6)}`;
    const skillId = insertRegistryRow(db, name);
    const now = new Date().toISOString();
    const listingId = `list-${skillId}`;
    db.prepare(
      `INSERT INTO skill_marketplace (id, skill_id, name, description, author, tags, version, changelog, rating, review_count, download_count, category, published_at, updated_at, deprecated)
       VALUES (?, ?, 'Listed', 'd', 'a', '[]', '2.0.0', 'c', 0, 0, 0, 'general', ?, ?, 0)`,
    ).run(listingId, String(skillId), now, now);

    submitReview(db, listingId, { reviewer: "ops", rating: 5, text: "batch25b ok", verified: true });
    const afterReview = db.prepare(`SELECT rating, review_count FROM skill_marketplace WHERE id = ?`).get(listingId) as {
      rating: number;
      review_count: number;
    };
    expect(afterReview.review_count).toBeGreaterThan(0);

    recordDownload(db, listingId);
    const afterDl = db.prepare(`SELECT download_count FROM skill_marketplace WHERE id = ?`).get(listingId) as {
      download_count: number;
    };
    expect(afterDl.download_count).toBe(1);

    const deprecated = deprecateSkill(db, listingId, "batch25b sunset");
    expect(deprecated.success).toBe(true);
    const row = db.prepare(`SELECT deprecated FROM skill_marketplace WHERE id = ?`).get(listingId) as {
      deprecated: number;
    };
    expect(row.deprecated).toBe(1);
    db.close();
  });
});
