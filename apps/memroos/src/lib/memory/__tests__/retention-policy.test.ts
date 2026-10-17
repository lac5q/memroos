// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  createRetentionPolicy,
  evaluateRetentionDeadline,
  evaluateRetentionPolicy,
  emitRetentionReceipt,
  listRetentionReceipts,
  parseJsonObject,
  registerRetentionRecord,
  scopeHash,
  sha256Hex,
  stableJson,
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

describe("memory retention policy selection", () => {
  it("selects the most specific ontology and security-label scoped policy", () => {
    const database = freshDb();
    createRetentionPolicy(database, {
      id: "policy-general",
      name: "general notes",
      ontologyType: "memory.note",
      securityLabel: { sensitivity: "*" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha" },
      priority: 10,
      durationDays: 30,
      actorId: "operator-1",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    createRetentionPolicy(database, {
      id: "policy-pii",
      name: "pii notes",
      ontologyType: "memory.note",
      securityLabel: { sensitivity: "pii", visibility: "private" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha", spaceId: "ops" },
      priority: 10,
      durationDays: 7,
      actorId: "operator-1",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const evaluation = evaluateRetentionPolicy(database, {
      tenantId: "default-tenant",
      ontologyType: "memory.note",
      securityLabel: { sensitivity: "pii", visibility: "private" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha", spaceId: "ops" },
      createdAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-01-02T00:00:00.000Z"),
    });

    expect(evaluation.decision).toBe("selected");
    expect(evaluation.selectedPolicy?.id).toBe("policy-pii");
    expect(evaluation.deadline).toBe("2026-01-08T00:00:00.000Z");
    expect(evaluation.conflictPolicyIds).toEqual([]);
  });

  it("fails closed when overlapping equal-priority policies tie", () => {
    const database = freshDb();
    for (const id of ["policy-a", "policy-b"]) {
      createRetentionPolicy(database, {
        id,
        name: id,
        ontologyType: "memory.claim",
        securityLabel: { sensitivity: "contract" },
        purpose: "dispatch",
        scope: { tenantId: "default-tenant", project: "alpha" },
        priority: 50,
        durationDays: 1,
        actorId: "operator-1",
      });
    }

    const evaluation = evaluateRetentionPolicy(database, {
      tenantId: "default-tenant",
      ontologyType: "memory.claim",
      securityLabel: { sensitivity: "contract" },
      purpose: "dispatch",
      scope: { tenantId: "default-tenant", project: "alpha" },
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(evaluation.decision).toBe("conflict");
    expect(evaluation.reason).toBe("overlapping_equal_priority_policies");
    expect(evaluation.conflictPolicyIds).toEqual(["policy-a", "policy-b"]);
    expect(evaluation.selectedPolicy).toBeNull();
  });

  it("does not infer policy when required storage dimensions are absent", () => {
    const database = freshDb();
    createRetentionPolicy(database, {
      id: "policy-one",
      name: "safe notes",
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha" },
      priority: 1,
      durationDays: 14,
      actorId: "operator-1",
    });

    const evaluation = evaluateRetentionPolicy(database, {
      tenantId: "default-tenant",
      ontologyType: "memory.note",
      securityLabel: {},
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha" },
    });

    expect(evaluation.decision).toBe("policy_unavailable");
    expect(evaluation.reason).toBe("missing_security_label");
  });

  it("uses UTC deadline boundaries explicitly for before, exact, and after decisions", () => {
    expect(evaluateRetentionDeadline("2026-01-02T00:00:00.000Z", new Date("2026-01-01T23:59:59.999Z"))).toBe("active");
    expect(evaluateRetentionDeadline("2026-01-02T00:00:00.000Z", new Date("2026-01-02T00:00:00.000Z"))).toBe("expired");
    expect(evaluateRetentionDeadline("2026-01-02T00:00:00.000Z", new Date("2026-01-02T00:00:00.001Z"))).toBe("expired");
  });

  it("registers records with non-sensitive selection receipts", () => {
    const database = freshDb();
    createRetentionPolicy(database, {
      id: "policy-secret",
      name: "secret retention",
      ontologyType: "memory.event",
      securityLabel: { sensitivity: "secret", visibility: "private" },
      purpose: "evidence-bundle",
      scope: { tenantId: "default-tenant", project: "alpha" },
      priority: 3,
      durationDays: 0,
      actorId: "operator-1",
    });

    const result = registerRetentionRecord(database, {
      recordType: "message",
      recordId: "msg-1",
      ontologyType: "memory.event",
      securityLabel: { sensitivity: "secret", visibility: "private" },
      purpose: "evidence-bundle",
      scope: { tenantId: "default-tenant", project: "alpha" },
      contentHash: "sha256:abc",
      actorId: "operator-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(result.record.policy_id).toBe("policy-secret");
    const receiptJson = JSON.stringify(result.receipt);
    expect(receiptJson).toContain("msg-1");
    expect(receiptJson).toContain("sha256");
    expect(receiptJson).not.toContain("my secret memory text");
    expect(receiptJson).not.toMatch(/embedding|vector|password|token/i);
  });

  it("handles empty arrays in scope as never matching", () => {
    const database = freshDb();
    createRetentionPolicy(database, {
      id: "policy-empty-array",
      name: "empty array scope",
      ontologyType: "memory.note",
      securityLabel: { sensitivity: "pii" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: [] }, // Never matches anything
      priority: 10,
      durationDays: 30,
      actorId: "operator-1",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const evaluation = evaluateRetentionPolicy(database, {
      tenantId: "default-tenant",
      ontologyType: "memory.note",
      securityLabel: { sensitivity: "pii" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha" },
    });

    expect(evaluation.decision).toBe("policy_unavailable");
  });

  it("parses invalid JSON objects as empty records", () => {
    expect(parseJsonObject("{")).toEqual({});
    expect(parseJsonObject(null)).toEqual({});
    expect(stableJson([1, { b: 2, a: 1 }])).toContain("1");
    expect(scopeHash({ tenantId: "default-tenant", project: "alpha" })).toHaveLength(64);
    expect(sha256Hex("x")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects invalid policy inputs and sensitive receipt metadata", () => {
    const database = freshDb();
    expect(() =>
      createRetentionPolicy(database, {
        name: "bad",
        ontologyType: "memory.note",
        securityLabel: { sensitivity: "internal" },
        purpose: "recall",
        durationDays: -1,
        actorId: "operator-1",
      })
    ).toThrow(/durationDays/);

    expect(() =>
      emitRetentionReceipt(database, {
        recordType: "message",
        recordId: "msg-sensitive",
        decision: "active",
        reason: "test",
        actorId: "operator-1",
        scope: { tenantId: "default-tenant" },
        metadata: { password: "secret-value" },
      })
    ).toThrow(/cannot contain raw memory/i);
  });

  it("matches wildcard ontology and array scope selectors", () => {
    const database = freshDb();
    createRetentionPolicy(database, {
      id: "policy-wild",
      name: "wildcard",
      ontologyType: "*",
      securityLabel: { sensitivity: "internal" },
      purpose: "*",
      scope: { tenantId: "default-tenant", project: ["alpha", "beta"] },
      priority: 1,
      durationDays: 3,
      actorId: "operator-1",
    });
    const evaluation = evaluateRetentionPolicy(database, {
      tenantId: "default-tenant",
      ontologyType: "memory.event",
      securityLabel: { sensitivity: "internal" },
      purpose: "dispatch",
      scope: { tenantId: "default-tenant", project: "beta" },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(evaluation.decision).toBe("selected");
    expect(evaluation.selectedPolicy?.id).toBe("policy-wild");
  });

  it("lists retention receipts filtered by record id and run key", () => {
    const database = freshDb();
    createRetentionPolicy(database, {
      id: "policy-list",
      name: "list receipts",
      ontologyType: "memory.note",
      securityLabel: { sensitivity: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha" },
      priority: 1,
      durationDays: 7,
      actorId: "operator-1",
    });
    registerRetentionRecord(database, {
      recordType: "message",
      recordId: "msg-list",
      ontologyType: "memory.note",
      securityLabel: { sensitivity: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha" },
      actorId: "operator-1",
    });
    const receipts = listRetentionReceipts(database, { recordId: "msg-list", limit: 5 });
    expect(receipts.length).toBeGreaterThan(0);
    expect(receipts[0]?.recordId).toBe("msg-list");
  });
});
