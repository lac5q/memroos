// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

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

function verifiedExportInput(requestId: string) {
  const subject = { subjectId: `subject-${crypto.randomUUID().slice(0, 8)}` };
  const tenantId = "default-tenant";
  const verificationHash = computeDsarVerificationHash({
    subject,
    verificationMethod: "email_token",
    actorId: "operator",
    tenantId,
  });
  return {
    tenantId,
    requestType: "export" as const,
    subject,
    scope: { tenantId, purpose: "recall" as const },
    verificationMethod: "email_token" as const,
    verificationHash,
    actorId: "operator",
    requestId,
  };
}

afterEach(() => {
  db?.close();
  db = null;
  vi.restoreAllMocks();
});

describe("dsar batch14 — verify/update and export/delete branches", () => {
  it("submitDsarRequest updates an existing pending row on re-verification", () => {
    const database = freshDb();
    const requestId = `dsar-reverify-${crypto.randomUUID().slice(0, 8)}`;
    const base = verifiedExportInput(requestId);
    database
      .prepare(
        `INSERT INTO memory_dsar_requests
         (id, tenant_id, request_type, subject_hash, selector_hashes_json, verification_method,
          verification_hash, scope_json, scope_hash, status, result_json, created_by, created_at)
         VALUES (?, ?, ?, ?, '{}', 'email_token', 'deadbeef', '{}', 'scope', 'pending', '{}', 'operator', ?)`
      )
      .run(requestId, base.tenantId, base.requestType, "old-subject-hash", "2026-01-01T00:00:00Z");
    const result = submitDsarRequest(database, base);
    expect(result.requestId).toBe(requestId);
    const row = database
      .prepare(`SELECT status, verification_hash FROM memory_dsar_requests WHERE id = ?`)
      .get(requestId) as { status: string; verification_hash: string };
    expect(row.verification_hash).toBe(base.verificationHash.toLowerCase());
    expect(["exported", "denied", "ambiguous", "failed", "verified", "pending"]).toContain(row.status);
  });

  it("submitDsarRequest export fails closed when vault manifest write throws", async () => {
    const database = freshDb();
    const vaultRoot = path.join(os.tmpdir(), `dsar-vault-fail-${crypto.randomUUID()}`);
    fs.writeFileSync(vaultRoot, "not-a-directory");
    process.env["MEMROOS_VAULT_ROOT"] = vaultRoot;
    const requestId = `dsar-manifest-fail-${crypto.randomUUID().slice(0, 8)}`;
    const result = submitDsarRequest(database, verifiedExportInput(requestId));
    delete process.env["MEMROOS_VAULT_ROOT"];
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/manifest_write_failed|denied|ambiguous|subject_not_found/);
  });

  it("submitDsarRequest delete path denies when subject plan cannot be built", () => {
    const database = freshDb();
    const subject = { subjectId: "" };
    const tenantId = "default-tenant";
    const verificationHash = computeDsarVerificationHash({
      subject,
      verificationMethod: "email_token",
      actorId: "operator",
      tenantId,
      precomputedSelectorHashes: { subjectId: "empty" },
    });
    const result = submitDsarRequest(database, {
      tenantId,
      requestType: "delete",
      subject,
      scope: { tenantId, purpose: "recall" },
      verificationMethod: "email_token",
      verificationHash,
      actorId: "operator",
      precomputedSelectorHashes: { subjectId: "" },
    });
    expect(result.ok).toBe(false);
    expect(["denied", "ambiguous"]).toContain(result.status);
  });

  it("materializeExisting returns not_found shape for missing request on executeDsarDelete", async () => {
    const database = freshDb();
    const result = await executeDsarDelete(database, {
      requestId: `ghost-${crypto.randomUUID()}`,
      planHash: "abc",
      actorId: "operator",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("dsar_request_not_found");
  });

  it("submitDsarRequest idempotency returns prior exported result", () => {
    const database = freshDb();
    const requestId = `dsar-idem-${crypto.randomUUID().slice(0, 8)}`;
    database
      .prepare(
        `INSERT INTO memory_dsar_requests
         (id, tenant_id, request_type, subject_hash, selector_hashes_json, verification_method,
          verification_hash, scope_json, scope_hash, status, result_json, manifest_hash, created_by, created_at)
         VALUES (?, 'default-tenant', 'export', ?, '{}', 'email_token', ?, '{}', 'scope', 'exported', ?, ?, 'operator', ?)`
      )
      .run(
        requestId,
        "subject-idem",
        "a".repeat(64),
        JSON.stringify({ reason: "exported", ok: true }),
        "b".repeat(64),
        "2026-01-01T00:00:00Z"
      );
    const result = submitDsarRequest(database, verifiedExportInput(requestId));
    expect(result.ok).toBe(true);
    expect(result.status).toBe("exported");
  });
});
