// @vitest-environment node
import { randomUUID } from "node:crypto";
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

describe("dsar batch30 — not-found guard and idempotent replay", () => {
  it("executeDsarDelete mirrors materializeExisting not-found branch (line 727 parity)", async () => {
    const database = freshDb();
    const missingId = `dsar_missing_b30_${randomUUID()}`;
    const result = await executeDsarDelete(database, {
      requestId: missingId,
      planHash: "planhash-b30",
      actorId: "operator-b30",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("dsar_request_not_found");
    expect(result.requestId).toBe(missingId);
    expect(result.subjectHash).toBe("");
  });

  it("submitDsarRequest replays exported delete rows without re-verifying", () => {
    const database = freshDb();
    const subject = { userId: `user-b30-${randomUUID().slice(0, 6)}` };
    const tenantId = "default-tenant";
    const actorId = "operator-b30";
    const requestId = `dsar_del_${randomUUID()}`;
    const verificationHash = computeDsarVerificationHash({
      subject,
      verificationMethod: "email_token",
      actorId,
      tenantId,
    });
    const scope = { tenantId, purpose: "recall" };
    submitDsarRequest(database, {
      requestType: "delete",
      subject,
      scope,
      verificationMethod: "email_token",
      verificationHash,
      actorId,
      requestId,
    });
    database
      .prepare(`UPDATE memory_dsar_requests SET status = 'deleted', result_json = ? WHERE id = ?`)
      .run(JSON.stringify({ reason: "delete_complete_b30" }), requestId);

    const replay = submitDsarRequest(database, {
      requestType: "delete",
      subject,
      scope,
      verificationMethod: "email_token",
      verificationHash,
      actorId,
      requestId,
    });
    expect(replay.status).toBe("deleted");
    expect(replay.ok).toBe(true);
    expect(replay.reason).toBe("delete_complete_b30");
  });
});
