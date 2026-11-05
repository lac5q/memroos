// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  createRetentionPolicy,
  evaluateRetentionDeadline,
  evaluateRetentionPolicy,
} from "../retention-policy";

let db: Database.Database | null = null;

function freshDb(): Database.Database {
  db = new Database(":memory:");
  initSchema(db);
  return db;
}

afterEach(() => {
  db?.close();
  db = null;
});

describe("retention-policy batch20 — validation, conflicts, and deadline evaluation", () => {
  it("createRetentionPolicy rejects blank policy names", () => {
    const database = freshDb();
    expect(() =>
      createRetentionPolicy(database, {
        name: "   ",
        ontologyType: "memory.contact_event",
        securityLabel: { visibility: "internal" },
        purpose: "recall",
        scope: { tenantId: "default-tenant" },
        durationDays: 30,
        actorId: "operator",
      }),
    ).toThrow(/name is required/);
  });

  it("evaluateRetentionPolicy returns conflict for equal-priority overlapping policies", () => {
    const database = freshDb();
    const scope = { tenantId: "default-tenant", project: "alpha" };
    const base = {
      ontologyType: "memory.contact_event",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope,
      durationDays: 30,
      priority: 5,
      actorId: "operator",
      now: new Date("2026-01-01T00:00:00.000Z"),
    };
    createRetentionPolicy(database, { ...base, id: `pol-a-${crypto.randomUUID()}`, name: "policy A" });
    createRetentionPolicy(database, { ...base, id: `pol-b-${crypto.randomUUID()}`, name: "policy B" });
    const evaluation = evaluateRetentionPolicy(database, {
      tenantId: "default-tenant",
      ontologyType: "memory.contact_event",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope,
      createdAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(evaluation.decision).toBe("conflict");
    expect(evaluation.reason).toBe("overlapping_equal_priority_policies");
  });

  it("evaluateRetentionPolicy rejects empty array scope selectors", () => {
    const database = freshDb();
    createRetentionPolicy(database, {
      id: `pol-array-${crypto.randomUUID()}`,
      name: "array scope",
      ontologyType: "memory.contact_event",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: [] },
      durationDays: 30,
      priority: 1,
      actorId: "operator",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const evaluation = evaluateRetentionPolicy(database, {
      tenantId: "default-tenant",
      ontologyType: "memory.contact_event",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha" },
      createdAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    expect(evaluation.decision).not.toBe("selected");
  });

  it("evaluateRetentionDeadline treats null deadlines as policy_unavailable", () => {
    expect(evaluateRetentionDeadline(null, new Date("2026-01-01T00:00:00.000Z"))).toBe("policy_unavailable");
  });

  it("evaluateRetentionDeadline marks past deadlines expired", () => {
    expect(evaluateRetentionDeadline("2020-01-01T00:00:00.000Z", new Date("2026-01-01T00:00:00.000Z"))).toBe(
      "expired",
    );
  });
});
