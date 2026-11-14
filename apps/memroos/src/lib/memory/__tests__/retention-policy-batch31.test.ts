// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createRetentionPolicy, evaluateRetentionPolicy } from "../retention-policy";

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

describe("retention-policy batch31 — array selector branches", () => {
  it("matchesSelector rejects array scope values that exclude the actual project (line 204)", () => {
    const database = freshDb();
    createRetentionPolicy(database, {
      id: `pol-arr-b31-${randomUUID()}`,
      name: "array exclude b31",
      ontologyType: "memory.contact_event",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: ["beta", "gamma"] },
      durationDays: 30,
      priority: 10,
      actorId: "operator",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    const evaluation = evaluateRetentionPolicy(database, {
      tenantId: "default-tenant",
      ontologyType: "memory.contact_event",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "alpha" },
      createdAt: "2026-03-01T00:00:00.000Z",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(evaluation.decision).toBe("policy_unavailable");
    expect(evaluation.reason).toBe("no_authorized_policy");
  });

  it("specificity ignores empty array selectors when ranking policies (line 215)", () => {
    const database = freshDb();
    const scope = { tenantId: "default-tenant", project: "alpha" };
    createRetentionPolicy(database, {
      id: `pol-empty-b31-${randomUUID()}`,
      name: "empty array specificity b31",
      ontologyType: "memory.contact_event",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: [], workspace: "ops" },
      durationDays: 30,
      priority: 1,
      actorId: "operator",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    createRetentionPolicy(database, {
      id: `pol-winner-b31-${randomUUID()}`,
      name: "specific workspace b31",
      ontologyType: "memory.contact_event",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { ...scope, workspace: "ops" },
      durationDays: 30,
      priority: 1,
      actorId: "operator",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    const evaluation = evaluateRetentionPolicy(database, {
      tenantId: "default-tenant",
      ontologyType: "memory.contact_event",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { ...scope, workspace: "ops" },
      createdAt: "2026-03-01T00:00:00.000Z",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(evaluation.decision).toBe("selected");
    expect(evaluation.selectedPolicy?.name).toBe("specific workspace b31");
  });
});
