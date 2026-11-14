// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createRetentionPolicy, registerRetentionRecord } from "../retention-policy";
import { createSubjectErasurePlan } from "../subject-erasure";

let db: Database.Database | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe("subject-erasure batch37 — identityFingerprint hash fallback (233-234)", () => {
  it("plans erasure for records without exact subject fields or display name", () => {
    db = new Database(":memory:");
    initSchema(db!);
    createRetentionPolicy(db!, {
      id: `policy-b37-${randomUUID()}`,
      name: "subject batch37",
      ontologyType: "*",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", project: "gamma" },
      durationDays: 365,
      priority: 1,
      actorId: "operator",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    const recordId = `rec-b37-${randomUUID().slice(0, 6)}`;
    registerRetentionRecord(db!, {
      recordType: "artifact",
      recordId,
      ontologyType: "memory.note",
      securityLabel: { visibility: "internal" },
      purpose: "recall",
      scope: { tenantId: "default-tenant", purpose: "recall", project: "gamma", recordId },
      contentHash: randomUUID(),
      actorId: "operator-b37",
      createdAt: "2026-03-01T00:00:00.000Z",
      now: new Date("2026-03-01T00:00:00.000Z"),
    });
    const planned = createSubjectErasurePlan(db!, {
      subject: { recordId },
      scope: { tenantId: "default-tenant", purpose: "recall", project: "gamma" },
      actorId: "operator-b37",
      now: new Date("2026-03-02T00:00:00.000Z"),
    });
    expect(planned.ok).toBe(true);
    expect(planned.plan?.matchedRecords.length).toBe(1);
  });
});