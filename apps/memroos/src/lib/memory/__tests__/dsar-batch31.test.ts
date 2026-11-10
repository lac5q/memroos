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

describe("dsar batch31 — idempotent replay and delete guards", () => {
  it("submitDsarRequest replays exported status via materializeExisting path", () => {
    const database = freshDb();
    const subject = { userId: `user-b31-${randomUUID().slice(0, 6)}` };
    const tenantId = "default-tenant";
    const actorId = "operator-b31";
    const requestId = `dsar_exp_${randomUUID()}`;
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
      .prepare(
        `UPDATE memory_dsar_requests SET status = 'exported', result_json = ? WHERE id = ?`,
      )
      .run(JSON.stringify({ reason: "export_complete_b31", manifestHash: "abc123" }), requestId);

    const replay = submitDsarRequest(database, {
      requestType: "export",
      subject,
      scope,
      verificationMethod: "email_token",
      verificationHash,
      actorId,
      requestId,
    });
    expect(replay.status).toBe("exported");
    expect(replay.ok).toBe(true);
    expect(replay.reason).toBe("export_complete_b31");
  });

  it("executeDsarDelete rejects non-delete request types", async () => {
    const database = freshDb();
    const subject = { userId: `user-b31-${randomUUID().slice(0, 6)}` };
    const requestId = `dsar_wrong_type_${randomUUID()}`;
    const verificationHash = computeDsarVerificationHash({
      subject,
      verificationMethod: "email_token",
      actorId: "operator-b31",
      tenantId: "default-tenant",
    });
    submitDsarRequest(database, {
      requestType: "export",
      subject,
      scope: { tenantId: "default-tenant", purpose: "recall" },
      verificationMethod: "email_token",
      verificationHash,
      actorId: "operator-b31",
      requestId,
    });

    const result = await executeDsarDelete(database, {
      requestId,
      planHash: "planhash-b31",
      actorId: "operator-b31",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("dsar_request_not_delete");
  });

  it("executeDsarDelete returns not_found for unknown request id", async () => {
    const database = freshDb();
    const missingId = `dsar_missing_b31_${randomUUID()}`;
    const result = await executeDsarDelete(database, {
      requestId: missingId,
      planHash: "planhash-b31",
      actorId: "operator-b31",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("dsar_request_not_found");
    expect(result.requestId).toBe(missingId);
  });
});
