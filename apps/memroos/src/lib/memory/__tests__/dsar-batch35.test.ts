// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { scopeHash, sha256Hex, stableJson } from "@/lib/memory/retention-policy";
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

describe("dsar batch35 — delete guards, materialize, existing update", () => {
  it.skip("materializeExisting not-found arm (727) — private helper; executeDsarDelete inlines equivalent shape", () => {});

  it("executeDsarDelete rejects delete requests without plan_id (608-619)", async () => {
    const database = freshDb();
    const requestId = `dsar_noplan_b35_${randomUUID()}`;
    const subjectHash = "a".repeat(64);
    database
      .prepare(
        `INSERT INTO memory_dsar_requests
         (id, tenant_id, request_type, subject_hash, selector_hashes_json, verification_method,
          verification_hash, scope_json, scope_hash, status, result_json, created_by, created_at)
         VALUES (?, 'default-tenant', 'delete', ?, '{}', 'email_token', ?, '{}', ?, 'verified', '{}', 'operator-b35', ?)`,
      )
      .run(requestId, subjectHash, "b".repeat(64), "c".repeat(64), "2026-03-05T00:00:00.000Z");

    const result = await executeDsarDelete(database, {
      requestId,
      planHash: "d".repeat(64),
      actorId: "operator-b35",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("dsar_plan_missing");
  });

  it("submitDsarRequest materializes deleted status on idempotent replay (743)", () => {
    const database = freshDb();
    const subject = { userId: `user-b35-${randomUUID().slice(0, 6)}` };
    const tenantId = "default-tenant";
    const actorId = "operator-b35";
    const requestId = `dsar_deleted_b35_${randomUUID()}`;
    const verificationHash = computeDsarVerificationHash({
      subject,
      verificationMethod: "email_token",
      actorId,
      tenantId,
    });
    const scope = { tenantId, purpose: "recall" };
    submitDsarRequest(database, {
      requestType: "export",
      subject,
      scope,
      verificationMethod: "email_token",
      verificationHash,
      actorId,
      requestId,
    });
    database
      .prepare(`UPDATE memory_dsar_requests SET status = 'deleted', result_json = ? WHERE id = ?`)
      .run(JSON.stringify({ reason: "delete_complete_b35" }), requestId);

    const replay = submitDsarRequest(database, {
      requestType: "export",
      subject,
      scope,
      verificationMethod: "email_token",
      verificationHash,
      actorId,
      requestId,
    });
    expect(replay.ok).toBe(true);
    expect(replay.status).toBe("deleted");
    expect(replay.reason).toBe("delete_complete_b35");
  });

  it("submitDsarRequest updates an in-flight row instead of inserting duplicate (266-279)", () => {
    const database = freshDb();
    const subject = { userId: `user-update-b35-${randomUUID().slice(0, 6)}` };
    const tenantId = "default-tenant";
    const actorId = "operator-b35";
    const requestId = `dsar_update_b35_${randomUUID()}`;
    const verificationHash = computeDsarVerificationHash({
      subject,
      verificationMethod: "password_reauth",
      actorId,
      tenantId,
    });
    const scope = { tenantId, purpose: "recall" };
    const selectorHashes = { userId: sha256Hex(subject.userId!) };
    const subjectHash = sha256Hex(stableJson(selectorHashes));
    database
      .prepare(
        `INSERT INTO memory_dsar_requests
         (id, tenant_id, request_type, subject_hash, selector_hashes_json, verification_method,
          verification_hash, scope_json, scope_hash, status, result_json, created_by, created_at)
         VALUES (?, ?, 'export', ?, ?, 'email_token', ?, ?, ?, 'verified', '{}', ?, ?)`,
      )
      .run(
        requestId,
        tenantId,
        subjectHash,
        stableJson(selectorHashes),
        verificationHash.toLowerCase(),
        stableJson(scope),
        scopeHash(scope),
        actorId,
        "2026-03-05T00:00:00.000Z",
      );

    submitDsarRequest(database, {
      requestType: "export",
      subject,
      scope,
      verificationMethod: "password_reauth",
      verificationHash,
      actorId,
      requestId,
    });
    const row = database
      .prepare(`SELECT status, verification_method, verification_hash FROM memory_dsar_requests WHERE id = ?`)
      .get(requestId) as { status: string; verification_method: string; verification_hash: string };
    expect(row.verification_method).toBe("password_reauth");
    expect(row.verification_hash).toBe(verificationHash.toLowerCase());
    const duplicateCount = (
      database.prepare(`SELECT COUNT(*) AS c FROM memory_dsar_requests WHERE id = ?`).get(requestId) as { c: number }
    ).c;
    expect(duplicateCount).toBe(1);
  });
});
