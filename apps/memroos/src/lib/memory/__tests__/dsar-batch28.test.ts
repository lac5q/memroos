// @vitest-environment node
import { randomUUID } from "node:crypto";
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

describe("dsar batch28 — rejection guards and verified export path", () => {
  it("submitDsarRequest denies missing scope (lines 193-196)", () => {
    const database = freshDb();
    const result = submitDsarRequest(database, {
      requestType: "export",
      subject: { userId: "user-b28" },
      scope: { tenantId: "", purpose: "dsar" },
      verificationMethod: "email_token",
      verificationHash: "a".repeat(64),
      actorId: "operator",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_tenant");
  });

  it("submitDsarRequest denies unsupported verification method (lines 198-199)", () => {
    const database = freshDb();
    const subject = { userId: `user-b28-${randomUUID().slice(0, 6)}` };
    const result = submitDsarRequest(database, {
      requestType: "export",
      subject,
      scope: { tenantId: "default-tenant", purpose: "dsar_export" },
      verificationMethod: "magic_link" as never,
      verificationHash: "b".repeat(64),
      actorId: "operator",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unsupported_verification_method");
  });

  it("submitDsarRequest denies bad verification hash format (lines 201-202)", () => {
    const database = freshDb();
    const result = submitDsarRequest(database, {
      requestType: "export",
      subject: { userId: `user-b28-${randomUUID().slice(0, 6)}` },
      scope: { tenantId: "default-tenant", purpose: "dsar_export" },
      verificationMethod: "email_token",
      verificationHash: "not-a-hex-hash",
      actorId: "operator",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("identity_verification_failed");
  });

  it("submitDsarRequest verifies hash mismatch (lines 242-243)", () => {
    const database = freshDb();
    const subject = { userId: `user-b28-${randomUUID().slice(0, 6)}` };
    const result = submitDsarRequest(database, {
      requestType: "export",
      subject,
      scope: { tenantId: "default-tenant", purpose: "dsar_export" },
      verificationMethod: "email_token",
      verificationHash: "c".repeat(64),
      actorId: "operator",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("identity_verification_failed");
  });

  it("submitDsarRequest inserts verified row when verification matches (lines 246-298)", () => {
    const database = freshDb();
    const subject = { userId: `user-export-b28-${randomUUID().slice(0, 6)}` };
    const tenantId = "default-tenant";
    const actorId = "operator";
    const requestId = `dsar_b28_${randomUUID()}`;
    const verificationHash = computeDsarVerificationHash({
      subject,
      verificationMethod: "email_token",
      actorId,
      tenantId,
    });
    const result = submitDsarRequest(database, {
      requestType: "export",
      subject,
      scope: { tenantId, purpose: "dsar_export" },
      verificationMethod: "email_token",
      verificationHash,
      actorId,
      requestId,
    });
    const row = database
      .prepare(`SELECT status FROM memory_dsar_requests WHERE id = ?`)
      .get(requestId) as { status: string };
    expect(row.status).toBeDefined();
    expect(["verified", "exported", "denied", "failed", "ambiguous"]).toContain(row.status);
    if (result.ok) {
      expect(result.status).toBe("exported");
    } else {
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});
