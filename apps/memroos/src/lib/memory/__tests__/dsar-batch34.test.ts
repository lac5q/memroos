// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  computeDsarVerificationHash,
  executeDsarDelete,
  submitDsarRequest,
} from "../dsar";

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

describe("dsar batch34 — verification guards and not-found delete", () => {
  it("submitDsarRequest rejects missing subject fields (190–196)", () => {
    const database = freshDb();
    const result = submitDsarRequest(database, {
      requestType: "export",
      subject: {},
      scope: { tenantId: "default-tenant", purpose: "recall" },
      verificationMethod: "email_token",
      verificationHash: "a".repeat(64),
      actorId: "operator-b34",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/subject|missing/i);
  });

  it("submitDsarRequest rejects unsupported verification method (198)", () => {
    const database = freshDb();
    const subject = { userId: `user-b34-${randomUUID().slice(0, 6)}` };
    const result = submitDsarRequest(database, {
      requestType: "export",
      subject,
      scope: { tenantId: "default-tenant", purpose: "recall" },
      verificationMethod: "sms_otp" as "email_token",
      verificationHash: "a".repeat(64),
      actorId: "operator-b34",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unsupported_verification_method");
  });

  it("submitDsarRequest rejects invalid verification hash (201)", () => {
    const database = freshDb();
    const subject = { userId: `user-b34-${randomUUID().slice(0, 6)}` };
    const result = submitDsarRequest(database, {
      requestType: "export",
      subject,
      scope: { tenantId: "default-tenant", purpose: "recall" },
      verificationMethod: "email_token",
      verificationHash: "not-hex",
      actorId: "operator-b34",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("identity_verification_failed");
  });

  it("executeDsarDelete returns dsar_request_not_found (727 parity)", async () => {
    const database = freshDb();
    const missingId = `dsar_missing_b34_${randomUUID()}`;
    const result = await executeDsarDelete(database, {
      requestId: missingId,
      planHash: "planhash-b34",
      actorId: "operator-b34",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("dsar_request_not_found");
    expect(result.requestId).toBe(missingId);
  });

  it("executeDsarDelete rejects non-delete request types (285 parity)", async () => {
    const database = freshDb();
    const subject = { userId: `user-b34-${randomUUID().slice(0, 6)}` };
    const requestId = `dsar_wrong_type_${randomUUID()}`;
    const verificationHash = computeDsarVerificationHash({
      subject,
      verificationMethod: "email_token",
      actorId: "operator-b34",
      tenantId: "default-tenant",
    });
    submitDsarRequest(database, {
      requestType: "export",
      subject,
      scope: { tenantId: "default-tenant", purpose: "recall" },
      verificationMethod: "email_token",
      verificationHash,
      actorId: "operator-b34",
      requestId,
    });
    const result = await executeDsarDelete(database, {
      requestId,
      planHash: "planhash-b34",
      actorId: "operator-b34",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("dsar_request_not_delete");
  });
});
