// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { evaluatePromotionChecks, normalizeCategory } from "../promotion";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

function seedCandidate(database: Database.Database): string {
  const candidateId = crypto.randomUUID();
  const captureId = crypto.randomUUID();
  database
    .prepare(
      `INSERT INTO agent_session_captures
       (id, tenant_id, source_agent_id, runtime, session_id, capture_hash, captured_at, capture_health)
       VALUES (?, 'default-tenant', 'agent-1', 'test', 'session-1', ?, ?, 'ok')`,
    )
    .run(captureId, crypto.randomUUID(), "2026-07-01T00:00:00.000Z");
  database
    .prepare(
      `INSERT INTO agent_memory_candidates
       (id, tenant_id, capture_id, agent_id, memory_type, content, content_hash, status,
        belief_stage, metadata_json, created_at)
       VALUES (?, 'default-tenant', ?, 'agent-1', 'decision_intent', 'claim text', ?, 'candidate',
        'silver_candidate', ?, ?)`,
    )
    .run(
      candidateId,
      captureId,
      "a".repeat(64),
      JSON.stringify({ category: "engineering" }),
      "2026-07-01T00:00:00.000Z",
    );
  return candidateId;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("belief promotion batch17b — category normalization and checks", () => {
  it("normalizeCategory maps known labels and defaults unknown to unclassified", () => {
    expect(normalizeCategory("  ENGINEERING  ")).toBe("engineering");
    expect(normalizeCategory("not-a-category")).toBe("unclassified");
    expect(normalizeCategory(undefined)).toBe("unclassified");
  });

  it("evaluatePromotionChecks returns five deterministic checks for a seeded candidate", () => {
    const database = freshDb();
    const candidateId = seedCandidate(database);
    const checks = evaluatePromotionChecks(database, "default-tenant", candidateId, {
      now: new Date("2026-07-10T12:00:00.000Z"),
    });
    expect(checks).toHaveLength(5);
    expect(checks.map((c) => c.name)).toEqual(
      expect.arrayContaining(["provenance", "freshness", "policy", "conflict", "dedupe"]),
    );
    expect(checks.every((c) => typeof c.pass === "boolean")).toBe(true);
  });

  it("evaluatePromotionChecks throws when candidate is missing", () => {
    const database = freshDb();
    expect(() =>
      evaluatePromotionChecks(database, "default-tenant", crypto.randomUUID()),
    ).toThrow(/candidate not found/);
  });
});
