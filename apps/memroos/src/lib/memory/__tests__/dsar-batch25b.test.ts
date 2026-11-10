// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeDsarVerificationHash, submitDsarRequest } from "../dsar";

let db: Database.Database | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

describe("dsar batch25b — verification hash stability", () => {
  it("computeDsarVerificationHash is deterministic for the same subject tuple", () => {
    db = new Database(":memory:");
    initSchema(db);
    const subject = { subjectId: `subject-${randomUUID().slice(0, 8)}` };
    const a = computeDsarVerificationHash({
      subject,
      verificationMethod: "email_token",
      actorId: "operator",
      tenantId: "default-tenant",
    });
    const b = computeDsarVerificationHash({
      subject,
      verificationMethod: "email_token",
      actorId: "operator",
      tenantId: "default-tenant",
    });
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(16);
  });

  it("submitDsarRequest rejects mismatched verification hashes", () => {
    db = new Database(":memory:");
    initSchema(db);
    const subject = { subjectId: `subject-${randomUUID().slice(0, 8)}` };
    const result = submitDsarRequest(db, {
      tenantId: "default-tenant",
      requestType: "export",
      subject,
      scope: { tenantId: "default-tenant", purpose: "recall", project: "alpha" },
      verificationMethod: "email_token",
      verificationHash: "deadbeef",
      actorId: "operator",
      requestId: `dsar-b25b-${randomUUID()}`,
    });
    expect(result.ok).toBe(false);
  });
});
