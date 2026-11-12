// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { scopeHash } from "@/lib/memory/retention-policy";
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

describe("dsar batch35b — verification and type guards", () => {
  it("submitDsarRequest rejects bad verification hash shape (201-202)", () => {
    const database = freshDb();
    const result = submitDsarRequest(database, {
      requestType: "export",
      subject: { userId: `user-b35b-${randomUUID().slice(0, 6)}` },
      scope: { tenantId: "default-tenant", purpose: "recall" },
      verificationMethod: "password_reauth",
      verificationHash: "not-a-hex",
      actorId: "operator-b35b",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("identity_verification_failed");
  });

  it("submitDsarRequest rejects unsupported verification method (198-199)", () => {
    const database = freshDb();
    const subject = { userId: `user-method-b35b-${randomUUID().slice(0, 6)}` };
    const result = submitDsarRequest(database, {
      requestType: "export",
      subject,
      scope: { tenantId: "default-tenant", purpose: "recall" },
      verificationMethod: "carrier_pigeon" as never,
      verificationHash: "a".repeat(64),
      actorId: "operator-b35b",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unsupported_verification_method");
  });

  it("executeDsarDelete rejects non-delete request type (595-606)", async () => {
    const database = freshDb();
    const requestId = `dsar_export_b35b_${randomUUID()}`;
    const subjectHash = "e".repeat(64);
    database
      .prepare(
        `INSERT INTO memory_dsar_requests
         (id, tenant_id, request_type, subject_hash, selector_hashes_json, verification_method,
          verification_hash, scope_json, scope_hash, status, result_json, created_by, created_at)
         VALUES (?, 'default-tenant', 'export', ?, '{}', 'email_token', ?, '{}', ?, 'verified', '{}', 'operator-b35b', ?)`,
      )
      .run(requestId, subjectHash, "f".repeat(64), scopeHash({ tenantId: "default-tenant" }), "2026-11-12T00:00:00.000Z");

    const result = await executeDsarDelete(database, {
      requestId,
      planHash: "d".repeat(64),
      actorId: "operator-b35b",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("dsar_request_not_delete");
  });

  it("submitDsarRequest rejects verification hash mismatch (242-243)", () => {
    const database = freshDb();
    const subject = { userId: `user-mismatch-b35b-${randomUUID().slice(0, 6)}` };
    const result = submitDsarRequest(database, {
      requestType: "export",
      subject,
      scope: { tenantId: "default-tenant", purpose: "recall" },
      verificationMethod: "password_reauth",
      verificationHash: computeDsarVerificationHash({
        subject: { userId: "someone-else" },
        verificationMethod: "password_reauth",
        actorId: "operator-b35b",
        tenantId: "default-tenant",
      }),
      actorId: "operator-b35b",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("identity_verification_failed");
    const deniedCount = (
      database.prepare(`SELECT COUNT(*) AS c FROM memory_dsar_requests WHERE status = 'denied'`).get() as { c: number }
    ).c;
    expect(deniedCount).toBeGreaterThanOrEqual(1);
  });
});
