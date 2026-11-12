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

describe("dsar batch28c — idempotent materialize and audit link guard", () => {
  it("materializeExisting returns exported rows on duplicate request id (lines 211-212, 725-752)", () => {
    const database = freshDb();
    const subject = { userId: `user-28c-${randomUUID().slice(0, 6)}` };
    const tenantId = "default-tenant";
    const actorId = "operator-28c";
    const requestId = `dsar_28c_${randomUUID()}`;
    const verificationHash = computeDsarVerificationHash({
      subject,
      verificationMethod: "email_token",
      actorId,
      tenantId,
    });
    const scope = { tenantId, purpose: "dsar_export" };
    const first = submitDsarRequest(database, {
      requestType: "export",
      subject,
      scope,
      verificationMethod: "email_token",
      verificationHash,
      actorId,
      requestId,
    });
    database
      .prepare(`UPDATE memory_dsar_requests SET status = 'exported', result_json = ? WHERE id = ?`)
      .run(JSON.stringify({ reason: "export_complete_batch28c" }), requestId);

    const second = submitDsarRequest(database, {
      requestType: "export",
      subject,
      scope,
      verificationMethod: "email_token",
      verificationHash,
      actorId,
      requestId,
    });
    expect(second.requestId).toBe(requestId);
    expect(second.status).toBe("exported");
    expect(first.requestId).toBe(requestId);
  });

  it("dedupe lookup reuses prior request via materializeExisting (lines 229-231)", () => {
    const database = freshDb();
    const subject = { userId: `dedupe-28c-${randomUUID().slice(0, 6)}` };
    const tenantId = "default-tenant";
    const actorId = "operator-dedupe";
    const verificationHash = computeDsarVerificationHash({
      subject,
      verificationMethod: "oauth_subject",
      actorId,
      tenantId,
    });
    const scope = { tenantId, purpose: "dsar_export" };
    const originalId = `dsar_orig_${randomUUID()}`;
    submitDsarRequest(database, {
      requestType: "export",
      subject,
      scope,
      verificationMethod: "oauth_subject",
      verificationHash,
      actorId,
      requestId: originalId,
    });
    database
      .prepare(`UPDATE memory_dsar_requests SET status = 'exported' WHERE id = ?`)
      .run(originalId);

    const replay = submitDsarRequest(database, {
      requestType: "export",
      subject,
      scope,
      verificationMethod: "oauth_subject",
      verificationHash,
      actorId,
      requestId: `dsar_new_${randomUUID()}`,
    });
    expect(replay.requestId).toBe(originalId);
    expect(replay.status).toBe("exported");
  });

  it("materializeExisting tolerates malformed result_json on exported rows (lines 739-741)", () => {
    const database = freshDb();
    const subject = { userId: `malformed-28c-${randomUUID().slice(0, 6)}` };
    const tenantId = "default-tenant";
    const actorId = "operator-malformed";
    const verificationHash = computeDsarVerificationHash({
      subject,
      verificationMethod: "signed_assertion",
      actorId,
      tenantId,
    });
    const requestId = `dsar_malformed_${randomUUID()}`;
    submitDsarRequest(database, {
      requestType: "export",
      subject,
      scope: { tenantId, purpose: "dsar_export" },
      verificationMethod: "signed_assertion",
      verificationHash,
      actorId,
      requestId,
    });
    database
      .prepare(`UPDATE memory_dsar_requests SET status = 'exported', result_json = '{bad' WHERE id = ?`)
      .run(requestId);

    const replay = submitDsarRequest(database, {
      requestType: "export",
      subject,
      scope: { tenantId, purpose: "dsar_export" },
      verificationMethod: "signed_assertion",
      verificationHash,
      actorId,
      requestId,
    });
    expect(replay.status).toBe("exported");
    expect(replay.requestId).toBe(requestId);
  });
});
