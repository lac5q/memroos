// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { writeVaultArtifact } from "@/lib/vault/writer";
import {
  classifyText,
  detectFixedSensitiveLabels,
  decideClassificationReview,
  listClassificationReviews,
  classifyVaultArtifact,
} from "../cascade";

let vaultRoot: string;

beforeEach(() => {
  vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), `cascade-b15-${crypto.randomUUID()}-`));
  vi.stubEnv("MEMROOS_VAULT_ROOT", vaultRoot);
});

afterEach(() => {
  fs.rmSync(vaultRoot, { recursive: true, force: true });
});

describe("classification cascade batch15 — nested labels, shadow, reviews", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("collectProviderLabelTokens walks nested replayMetadata objects", () => {
    const fixed = detectFixedSensitiveLabels({
      content: "routine update",
      sourceType: "message",
      metadata: {
        replayMetadata: {
          providerLabels: ["Legal Hold"],
        },
      },
    });
    expect(fixed.kinds).toContain("legal");
  });

  it("classifyText scans long content in overlapping chunks", () => {
    const padded = `${"safe intro. ".repeat(400)}Contact john@example.com for billing.`;
    const result = classifyText({
      content: padded,
      sourceType: "message",
      metadata: {},
    });
    expect(result.reasonCodes.some((c) => c.startsWith("scanner:"))).toBe(true);
  });

  it("classifyText runs shadow adjudicator when MEMROOS_CLASSIFICATION_LLM_SHADOW=1", () => {
    vi.stubEnv("MEMROOS_CLASSIFICATION_LLM_SHADOW", "1");
    const result = classifyText({
      content: "Internal engineering note about deployment.",
      sourceType: "message",
      metadata: {},
    });
    expect(result.reasonCodes.some((c) => c.startsWith("shadow:"))).toBe(true);
  });

  it("decideClassificationReview denies and redacts with nullable reviewer", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const written = writeVaultArtifact(db, {
      tenantId: "default-tenant",
      project: "p",
      sourceType: "messages",
      sourceId: "src",
      sessionId: `sess-${crypto.randomUUID()}`,
      body: "harmless",
      label: { visibility: "private", policy: "sealed", domain: "engineering", sensitivity: null },
    });
    const artifactId = written.id;
    const reviewId = `rev-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO classification_reviews (
         id, tenant_id, artifact_id, source_type, source_id, session_id, status,
         reason_codes_json, evidence_spans_json,
         proposed_visibility, proposed_domain, proposed_sensitivity, proposed_policy,
         created_at
       ) VALUES (?, 'default-tenant', ?, 'messages', 'src', NULL, 'open', '[]', '[]',
         'private', 'engineering', NULL, 'sealed', datetime('now'))`,
    ).run(reviewId, artifactId);

    const denied = decideClassificationReview(db, reviewId, {
      decision: "deny",
      reviewerId: "missing-user",
      note: "reject",
    });
    expect(denied.label).toBeNull();
    expect(denied.review.status).toBe("denied");

    const reviewId2 = `rev2-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO classification_reviews (
         id, tenant_id, artifact_id, source_type, source_id, session_id, status,
         reason_codes_json, evidence_spans_json,
         proposed_visibility, proposed_domain, proposed_sensitivity, proposed_policy,
         created_at
       ) VALUES (?, 'default-tenant', ?, 'messages', 'src', NULL, 'open', '[]', '[]',
         'private', 'hr', 'pii', 'requires_human_review', datetime('now'))`,
    ).run(reviewId2, artifactId);
    const redacted = decideClassificationReview(db, reviewId2, {
      decision: "redact",
      reviewerId: "also-missing",
    });
    expect(redacted.review.status).toBe("redacted");

    const listed = listClassificationReviews(db, { tenantId: "default-tenant", status: "all", limit: 5 });
    expect(listed.length).toBeGreaterThanOrEqual(2);
    db.close();
  });

  it("classifyVaultArtifact opens review for scanner hits on vault artifacts", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const written = writeVaultArtifact(db, {
      tenantId: "default-tenant",
      project: "p",
      sourceType: "messages",
      sourceId: "src",
      sessionId: `sess-${crypto.randomUUID()}`,
      body: "Please wire transfer to account 4111111111111111 immediately.",
      label: { visibility: "private", policy: "sealed", domain: "finance", sensitivity: "payment" },
    });
    const result = classifyVaultArtifact(db, written.id);
    expect(result.reviewId).toBeTruthy();
    db.close();
  });
});
