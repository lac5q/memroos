// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  createRetentionPolicy,
  evaluateRetentionDeadline,
  evaluateRetentionPolicy,
  listRetentionReceipts,
  parseJsonObject,
  registerRetentionRecord,
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

describe("retention-policy batch34b", () => {
  it("parseJsonObject rejects arrays and createRetentionPolicy honors enabled flag (172, 266)", () => {
    const database = freshDb();
    expect(parseJsonObject(JSON.stringify(["not", "object"]))).toEqual({});

    const row = createRetentionPolicy(database, {
      id: `pol-off-b34b-${randomUUID()}`,
      name: "disabled retention",
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant" },
      durationDays: 30,
      enabled: false,
      actorId: "operator",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(row.enabled).toBe(0);
  });

  it("rejects non-integer priority and wildcard policy matching (274, 375–376)", () => {
    const database = freshDb();
    expect(() =>
      createRetentionPolicy(database, {
        id: `pol-bad-priority-${randomUUID()}`,
        name: "bad priority",
        ontologyType: "memory.note",
        securityLabel: { visibility: "internal" },
        purpose: "recall",
        scope: { tenantId: "default-tenant" },
        durationDays: 30,
        priority: 1.5 as never,
        actorId: "operator",
      }),
    ).toThrow(/priority must be an integer/i);

    createRetentionPolicy(database, {
      id: `pol-wild-b34b-${randomUUID()}`,
      name: "wildcard ontology",
      ontologyType: "*",
      securityLabel: { visibility: "internal" },
      purpose: "*",
      scope: { tenantId: "default-tenant", project: "alpha" },
      durationDays: 7,
      priority: 2,
      actorId: "operator",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });

    const selected = evaluateRetentionPolicy(database, {
      tenantId: "default-tenant",
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha" },
      createdAt: "2026-03-01T00:00:00.000Z",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(selected.decision).toBe("selected");
    expect(selected.selectedPolicy?.ontology_type).toBe("*");
  });

  it("detects equal-priority conflicts and deadline states (346, 399–423)", () => {
    const database = freshDb();
    const tag = randomUUID().slice(0, 8);
    const base = {
      name: `conflict twin ${tag}`,
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha" },
      durationDays: 30,
      priority: 5,
      actorId: "operator",
      now: new Date("2026-03-01T00:00:00.000Z"),
    };
    createRetentionPolicy(database, { ...base, id: `pol-a-${randomUUID()}`, version: "v1" });
    createRetentionPolicy(database, { ...base, id: `pol-b-${randomUUID()}`, version: "v2" });

    const conflict = evaluateRetentionPolicy(database, {
      tenantId: "default-tenant",
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha" },
      createdAt: "2026-03-01T00:00:00.000Z",
    });
    expect(conflict.decision).toBe("conflict");
    expect(conflict.conflictPolicyIds).toHaveLength(2);

    const missingContext = evaluateRetentionPolicy(database, {
      tenantId: "default-tenant",
      ontologyType: "memory.note",
      purpose: "recall",
      scope: { tenantId: "default-tenant" },
    } as never);
    expect(missingContext.decision).toBe("policy_unavailable");
    expect(missingContext.reason).toBe("missing_security_label");

    expect(evaluateRetentionDeadline(null, new Date())).toBe("policy_unavailable");
    expect(evaluateRetentionDeadline("2020-01-01T00:00:00.000Z", new Date("2026-01-01T00:00:00.000Z"))).toBe("expired");
  });

  it("registerRetentionRecord defaults scope and lists receipts with empty JSON (540, 680–681)", () => {
    const database = freshDb();
    createRetentionPolicy(database, {
      id: `pol-reg-b34b-${randomUUID()}`,
      name: "register scope default",
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant" },
      durationDays: 14,
      actorId: "operator",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });

    const recordId = `rec-b34b-${randomUUID().slice(0, 8)}`;
    const { record } = registerRetentionRecord(database, {
      recordType: "message",
      recordId,
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      contentHash: randomUUID(),
      actorId: "operator",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(JSON.parse(record.scope_json).recordType).toBe("message");

    database
      .prepare(
        `UPDATE memory_retention_receipts
         SET derivative_outcomes_json = '', metadata_json = ''
         WHERE record_id = ?`,
      )
      .run(recordId);

    const receipts = listRetentionReceipts(database, { recordId, limit: 5 });
    expect(receipts[0]?.derivativeOutcomes).toEqual([]);
    expect(receipts[0]?.metadata).toEqual({});
  });
});
