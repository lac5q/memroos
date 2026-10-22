// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { computeDsarVerificationHash, executeDsarDelete, submitDsarRequest } from "../dsar";

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

describe("dsar batch13b — delete execution guardrails", () => {
  it("executeDsarDelete fails when request id is unknown", async () => {
    const database = freshDb();
    const result = await executeDsarDelete(database, {
      requestId: `missing-${crypto.randomUUID()}`,
      planHash: "abc",
      actorId: "operator",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("dsar_request_not_found");
  });

  it("executeDsarDelete refuses export-type requests", async () => {
    const database = freshDb();
    const requestId = `exp-${crypto.randomUUID()}`;
    database
      .prepare(
        `INSERT INTO memory_dsar_requests
         (id, tenant_id, subject_hash, request_type, status, verification_method, verification_hash, scope_hash, created_by)
         VALUES (?, 'default-tenant', ?, 'export', 'pending', 'email_token', ?, '{}', 'operator')`
      )
      .run(requestId, "subject-export", "hash");
    const result = await executeDsarDelete(database, {
      requestId,
      planHash: "plan",
      actorId: "operator",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("dsar_request_not_delete");
  });

  it("executeDsarDelete fails when delete request has no plan attached", async () => {
    const database = freshDb();
    const requestId = `del-${crypto.randomUUID()}`;
    database
      .prepare(
        `INSERT INTO memory_dsar_requests
         (id, tenant_id, subject_hash, request_type, status, verification_method, verification_hash, scope_hash, created_by)
         VALUES (?, 'default-tenant', ?, 'delete', 'pending', 'email_token', ?, '{}', 'operator')`
      )
      .run(requestId, "subject-delete", "hash");
    const result = await executeDsarDelete(database, {
      requestId,
      planHash: "plan",
      actorId: "operator",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("dsar_plan_missing");
  });

  it("computeDsarVerificationHash is stable for identical inputs", () => {
    const payload = {
      subject: { subjectId: "subject-1" },
      verificationMethod: "email_token" as const,
      actorId: "operator",
      tenantId: "default-tenant",
    };
    const a = computeDsarVerificationHash(payload);
    const b = computeDsarVerificationHash(payload);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("submitDsarRequest persists denied row when verification hash mismatches", () => {
    const database = freshDb();
    const result = submitDsarRequest(database, {
      tenantId: "default-tenant",
      requestType: "export",
      subject: { subjectId: "subject-deny-b13b" },
      scope: { tenantId: "default-tenant", purpose: "recall" },
      verificationMethod: "email_token",
      verificationHash: "0".repeat(64),
      actorId: "operator",
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("denied");
    const row = database
      .prepare(`SELECT status FROM memory_dsar_requests WHERE id = ?`)
      .get(result.requestId) as { status: string };
    expect(row.status).toBe("denied");
  });
});
