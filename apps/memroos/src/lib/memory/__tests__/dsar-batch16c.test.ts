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

describe("dsar batch16c — verification hash and duplicate requests", () => {
  it("computeDsarVerificationHash is stable for same subject and method", () => {
    const subject = { subjectId: "subject-abc" };
    const input = {
      subject,
      verificationMethod: "email_token" as const,
      actorId: "operator",
      tenantId: "default-tenant",
    };
    const a = computeDsarVerificationHash(input);
    const b = computeDsarVerificationHash(input);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("submitDsarRequest rejects export when verification hash does not match subject", () => {
    const database = freshDb();
    const subject = { subjectId: `subject-${crypto.randomUUID().slice(0, 8)}` };
    const result = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "export",
      subject,
      scope: { tenantId: "default-tenant", purpose: "recall" },
      verificationMethod: "email_token",
      verificationHash: "f".repeat(64),
      actorId: "operator",
      requestId: `dsar-b16c-${crypto.randomUUID()}`,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("identity_verification_failed");
  });

  it("submitDsarRequest rejects delete requests with ambiguous subject selectors", () => {
    const database = freshDb();
    const subject = { email: "user@example.com", phone: "+15551212" };
    const hash = computeDsarVerificationHash({
      subject,
      verificationMethod: "oauth_subject",
      actorId: "operator",
      tenantId: "default-tenant",
    });
    const result = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "delete",
      subject,
      scope: { tenantId: "default-tenant", purpose: "erasure" },
      verificationMethod: "oauth_subject",
      verificationHash: hash,
      actorId: "operator",
      requestId: `dsar-del-${crypto.randomUUID()}`,
    });
    expect(result.ok).toBe(false);
    expect(["ambiguous", "missing_subject_identity"]).toContain(result.reason);
  });
});
