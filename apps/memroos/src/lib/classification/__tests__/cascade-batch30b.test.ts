// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { classifyText, decideClassificationReview } from "../cascade";

afterEach(() => {
  // per-test db.close()
});

describe("classification cascade batch30b — chunk scan and review guard", () => {
  it("scanForClassification skips input_too_long matches across chunks (line 272)", () => {
    const body = `${"token ".repeat(900)}secret=${"x".repeat(40)}`;
    const result = classifyText({
      content: body,
      sourceType: "message",
      metadata: {},
    });
    expect(result.reasonCodes.some((c) => c.includes("input_too_long"))).toBe(false);
    expect(result.reasonCodes.length).toBeGreaterThan(0);
  });

  it("decideClassificationReview rejects already-closed reviews (line 543)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const artifactId = `art-b30b-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO raw_artifacts
        (id, tenant_id, source_type, source_id, session_id, artifact_uri, artifact_path, content_hash, created_at)
       VALUES (?, 'default-tenant', 'message', 'src', 'sess', 'vault://art', '/tmp/art', 'sha256:abc', '2026-01-01T00:00:00Z')`,
    ).run(artifactId);
    const reviewId = `rev-b30b-${randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO classification_reviews
        (id, tenant_id, artifact_id, source_type, source_id, session_id, status, reason_codes_json, evidence_spans_json,
         proposed_visibility, proposed_domain, proposed_sensitivity, proposed_policy, created_at)
       VALUES (?, 'default-tenant', ?, 'message', 'src', 'sess', 'approved', '[]', '[]',
               'private', 'engineering', 'internal', 'sealed', '2026-01-01T00:00:00Z')`,
    ).run(reviewId, artifactId);

    expect(() =>
      decideClassificationReview(db, reviewId, {
        decision: "approve",
        reviewerId: "operator-b30b",
      }),
    ).toThrow(/already approved/);

    expect(() =>
      decideClassificationReview(db, `missing-${randomUUID()}`, {
        decision: "approve",
        reviewerId: "operator-b30b",
      }),
    ).toThrow(/not found/i);
    db.close();
  });
});
