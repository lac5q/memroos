// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeDsarVerificationHash, submitDsarRequest } from "../dsar";

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

describe("dsar batch16 — scope, subject, and verification guards", () => {
  it("submitDsarRequest rejects missing scope and subject identity", () => {
    const database = freshDb();

    const missingScope = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "export",
      subject: { subjectId: "subject-1" },
      scope: undefined,
      verificationMethod: "email_token",
      verificationHash: "a".repeat(64),
      actorId: "operator",
      requestId: `dsar-b16-scope-${crypto.randomUUID()}`,
    });
    expect(missingScope.ok).toBe(false);
    expect(missingScope.reason).toBe("missing_scope");

    const missingSubject = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "export",
      subject: { name: "only-name" },
      scope: { tenantId: "default-tenant", purpose: "recall" },
      verificationMethod: "email_token",
      verificationHash: "b".repeat(64),
      actorId: "operator",
      requestId: `dsar-b16-subject-${crypto.randomUUID()}`,
    });
    expect(missingSubject.ok).toBe(false);
    expect(missingSubject.reason).toBe("missing_subject_identity");
  });

  it("submitDsarRequest rejects unsupported verification methods and bad hashes", () => {
    const database = freshDb();
    const subject = { subjectId: `subject-${crypto.randomUUID().slice(0, 8)}` };
    const scope = { tenantId: "default-tenant", purpose: "recall" as const };
    const requestId = `dsar-b16-${crypto.randomUUID().slice(0, 8)}`;

    const unsupported = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "export",
      subject,
      scope,
      verificationMethod: "magic_link" as never,
      verificationHash: "b".repeat(64),
      actorId: "operator",
      requestId,
    });
    expect(unsupported.reason).toBe("unsupported_verification_method");

    const badHash = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "export",
      subject,
      scope,
      verificationMethod: "email_token",
      verificationHash: "not-a-hash",
      actorId: "operator",
      requestId: `${requestId}-2`,
    });
    expect(badHash.reason).toBe("identity_verification_failed");

    const verificationHash = computeDsarVerificationHash({
      subject,
      verificationMethod: "email_token",
      actorId: "operator",
      tenantId: "default-tenant",
    });
    const mismatch = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "export",
      subject: { subjectId: `other-${crypto.randomUUID()}` },
      scope,
      verificationMethod: "email_token",
      verificationHash: "c".repeat(64),
      actorId: "operator",
      requestId: `${requestId}-3`,
    });
    expect(mismatch.reason).toBe("identity_verification_failed");
    expect(verificationHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
