// @vitest-environment node
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateUser = vi.fn();
const mockRequireRole = vi.fn();
const mockGetProvider = vi.fn();
const mockIsApiKeyProvider = vi.fn();
const mockStoreApiKey = vi.fn();
const mockAppendActivity = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/auth/middleware-roles", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

vi.mock("@/lib/tool-auth/providers", () => ({
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
  isApiKeyProvider: (...args: unknown[]) => mockIsApiKeyProvider(...args),
}));

vi.mock("@/lib/tool-auth/credential-store", () => ({
  storeApiKeyConnection: (...args: unknown[]) => mockStoreApiKey(...args),
  appendActivityEvent: (...args: unknown[]) => mockAppendActivity(...args),
}));

const LOOPBACK = "http://localhost";
const SIGNING_KEY = path.join(process.cwd(), "data", "skill-signing-key.json");

function jsonBody(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validActivityPayload(overrides: Record<string, unknown> = {}) {
  return {
    companyId: "co-batch20",
    actorType: "agent",
    actorId: "agent-1",
    action: "issue.updated",
    entityType: "issue",
    entityId: `ent-${randomUUID().slice(0, 8)}`,
    timestamp: new Date().toISOString(),
    metadata: { apiKey: "redacted-at-source", note: "visible" },
    ...overrides,
  };
}

beforeEach(() => {
  mockAuthenticateUser.mockReset();
  mockRequireRole.mockReset();
  mockGetProvider.mockReset();
  mockIsApiKeyProvider.mockReset();
  mockStoreApiKey.mockReset();
  mockAppendActivity.mockReset();
  mockAuthenticateUser.mockResolvedValue({
    userId: "op-batch20",
    role: "operator",
    email: "op@example.com",
    displayName: "Op",
    tenantId: "default-tenant",
  });
  mockRequireRole.mockReturnValue(null);
  mockGetProvider.mockReturnValue({
    key: "circleback",
    authMode: "api-key",
    label: "Circleback",
  });
  mockIsApiKeyProvider.mockReturnValue(true);
  mockStoreApiKey.mockResolvedValue({ connectionId: `conn-${randomUUID().slice(0, 8)}` });
  delete process.env.PAPERCLIP_BASE_URL;
  vi.resetModules();
});

afterEach(() => {
  if (existsSync(SIGNING_KEY)) unlinkSync(SIGNING_KEY);
  vi.unstubAllGlobals();
});

describe("api routes batch20 — paperclip fleet and dispatch", () => {
  it("GET /api/paperclip uses empty checkpoint defaults when checkpoint is null", async () => {
    testDb
      .prepare(
        `INSERT INTO hive_delegations(task_id, from_agent, to_agent, task_summary, priority, status, checkpoint, updated_at)
         VALUES (?, 'op', 'paperclip', 'null checkpoint row', 3, 'active', NULL, datetime('now'))`,
      )
      .run(`task-${randomUUID().slice(0, 8)}`);
    const { GET } = await import("../paperclip/route");
    const body = await (await GET()).json();
    const op = body.operations.find((row: { summary: string }) => row.summary === "null checkpoint row");
    expect(op?.sessionId).toBe("");
    expect(op?.completedSteps).toEqual([]);
    expect(op?.resumeFrom).toBeNull();
  });

  it("POST /api/paperclip rejects missing requestedBy and upstream dispatch failures", async () => {
    process.env.PAPERCLIP_BASE_URL = "http://paperclip-upstream.test";
    const { POST } = await import("../paperclip/route");

    const missingRequester = await POST(
      jsonBody(`${LOOPBACK}/api/paperclip`, {
        taskSummary: "Need owner",
      }) as NextRequest,
    );
    expect(missingRequester.status).toBe(400);
    expect((await missingRequester.json()).error).toMatch(/requestedBy/i);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream rejected", { status: 502 })),
    );
    const upstreamFail = await POST(
      jsonBody(`${LOOPBACK}/api/paperclip`, {
        taskSummary: "Dispatch me",
        requestedBy: "operator",
      }) as NextRequest,
    );
    expect(upstreamFail.status).toBe(502);
    expect((await upstreamFail.json()).error).toMatch(/Upstream dispatch failed/i);

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("paperclip unreachable"))));
    const unreachable = await POST(
      jsonBody(`${LOOPBACK}/api/paperclip`, {
        taskSummary: "Dispatch me",
        requestedBy: "operator",
      }) as NextRequest,
    );
    expect(unreachable.status).toBe(502);
    expect((await unreachable.json()).error).toMatch(/unreachable/i);
  });
});

describe("api routes batch20 — paperclip activity validation", () => {
  it("POST /api/paperclip/activity rejects empty required string fields", async () => {
    const { POST } = await import("../paperclip/activity/route");
    const cases: Array<[string, Record<string, unknown>]> = [
      ["actorId", { actorId: "  " }],
      ["action", { action: "" }],
      ["entityType", { entityType: " " }],
      ["entityId", { entityId: "" }],
      ["timestamp", { timestamp: " " }],
    ];

    for (const [field, patch] of cases) {
      const res = await POST(jsonBody(`${LOOPBACK}/api/paperclip/activity`, validActivityPayload(patch)) as NextRequest);
      expect(res.status, field).toBe(400);
      expect((await res.json()).error).toMatch(new RegExp(field, "i"));
    }
  });

  it("POST /api/paperclip/activity ingests event and redacts sensitive metadata keys", async () => {
    const { POST } = await import("../paperclip/activity/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/paperclip/activity`, validActivityPayload()) as NextRequest,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const row = testDb
      .prepare(`SELECT metadata_json FROM audit_entries WHERE id = ?`)
      .get(body.auditId) as { metadata_json: string };
    const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
    expect(metadata.apiKey).toBeUndefined();
    expect(metadata.note).toBe("visible");
  });
});

describe("api routes batch20 — tools connect api-key and policy knowledge", () => {
  it("POST /api/tools/connect/api-key validates provider and vault writes", async () => {
    const { POST } = await import("../tools/connect/api-key/route");

    mockAuthenticateUser.mockResolvedValueOnce(null);
    const unauth = await POST(
      jsonBody(`${LOOPBACK}/api/tools/connect/api-key`, {
        providerKey: "circleback",
        credentials: { apiKey: "1234567890" },
      }) as NextRequest,
    );
    expect(unauth.status).toBe(401);

    mockGetProvider.mockReturnValueOnce(null);
    const missingProvider = await POST(
      jsonBody(`${LOOPBACK}/api/tools/connect/api-key`, {
        providerKey: "missing",
        credentials: { apiKey: "12345678" },
      }) as NextRequest,
    );
    expect(missingProvider.status).toBe(404);

    const shortKey = await POST(
      jsonBody(`${LOOPBACK}/api/tools/connect/api-key`, {
        providerKey: "circleback",
        credentials: { apiKey: "short" },
      }) as NextRequest,
    );
    expect(shortKey.status).toBe(400);
    expect((await shortKey.json()).error).toBe("api_key_required");

    mockStoreApiKey.mockRejectedValueOnce(new Error("vault sealed"));
    const vaultFail = await POST(
      jsonBody(`${LOOPBACK}/api/tools/connect/api-key`, {
        providerKey: "circleback",
        credentials: { key: "1234567890" },
      }) as NextRequest,
    );
    expect(vaultFail.status).toBe(500);
    expect((await vaultFail.json()).error).toBe("vault_write_failed");
    expect(mockAppendActivity).toHaveBeenCalled();

    const ok = await POST(
      jsonBody(`${LOOPBACK}/api/tools/connect/api-key`, {
        providerKey: "circleback",
        credentials: { apiKey: "1234567890" },
      }) as NextRequest,
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).connectionId).toBeTruthy();
  });

  it("POST /api/policy/knowledge enforces role, reference, deny, and allow envelopes", async () => {
    mockRequireRole.mockReturnValueOnce(
      Response.json({ error: "forbidden role" }, { status: 403 }),
    );
    const { POST } = await import("../policy/knowledge/route");
    const forbidden = await POST(jsonBody(`${LOOPBACK}/api/policy/knowledge`, { action: "knowledge.read" }) as NextRequest);
    expect(forbidden.status).toBe(403);

    const invalidJson = await POST(
      new Request(`${LOOPBACK}/api/policy/knowledge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }) as NextRequest,
    );
    expect(invalidJson.status).toBe(400);

    const missingRef = await POST(
      jsonBody(`${LOOPBACK}/api/policy/knowledge`, { action: "knowledge.read" }) as NextRequest,
    );
    expect(missingRef.status).toBe(400);
    expect((await missingRef.json()).error).toBe("ontology_reference_required");

    const recordId = `knowledge-${randomUUID().slice(0, 8)}`;
    const { ensureCanonicalUpperOntology } = await import("@/lib/ontology/registry");
    const ontology = ensureCanonicalUpperOntology(testDb, "operator");
    testDb
      .prepare(
        `INSERT INTO ontology_versioned_records
          (id, tenant_id, space_id, record_type, record_id, qualified_type, ontology_id,
           ontology_version, ontology_content_hash, mapping_path_json, created_at, source_id, source_hash)
         VALUES (?, ?, ?, 'knowledge', ?, 'memory', ?, ?, ?, '[]', ?, ?, ?)`,
      )
      .run(
        `versioned-${recordId}`,
        "default-tenant",
        "knowledge-space-b20",
        recordId,
        ontology.ontologyId,
        ontology.version,
        ontology.contentHash,
        new Date().toISOString(),
        `source-${recordId}`,
        `sha256:${"c".repeat(64)}`,
      );
    testDb
      .prepare(
        `INSERT INTO ontology_source_lifecycle
          (tenant_id, space_id, source_id, source_hash, status, updated_at, updated_by, reason_code)
         VALUES (?, ?, ?, ?, 'active', ?, 'operator', 'test')`,
      )
      .run(
        "default-tenant",
        "knowledge-space-b20",
        `source-${recordId}`,
        `sha256:${"c".repeat(64)}`,
        new Date().toISOString(),
      );
    testDb
      .prepare(
        `INSERT INTO ontology_derivative_validity
          (id, tenant_id, space_id, source_id, source_hash, derivative_type, derivative_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'versioned_record', ?, 'authoritative', ?)`,
      )
      .run(
        `valid-${recordId}`,
        "default-tenant",
        "knowledge-space-b20",
        `source-${recordId}`,
        `sha256:${"c".repeat(64)}`,
        `versioned-${recordId}`,
        new Date().toISOString(),
      );

    testDb.exec(`CREATE TRIGGER deny_policy_receipt_audit_b20 BEFORE INSERT ON audit_entries
      WHEN NEW.event_type = 'policy.decision' BEGIN SELECT RAISE(ABORT, 'fault-injected'); END;`);
    const denied = await POST(
      jsonBody(`${LOOPBACK}/api/policy/knowledge`, {
        action: "knowledge.read",
        ontologyReference: {
          tenantId: "default-tenant",
          spaceId: "knowledge-space-b20",
          recordType: "knowledge",
          recordId,
        },
      }) as NextRequest,
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).outcome).toBe("deny");
    testDb.exec(`DROP TRIGGER IF EXISTS deny_policy_receipt_audit_b20;`);

    const allowed = await POST(
      jsonBody(`${LOOPBACK}/api/policy/knowledge`, {
        action: "knowledge.read",
        ontologyReference: {
          tenantId: "default-tenant",
          spaceId: "knowledge-space-b20",
          recordType: "knowledge",
          recordId,
        },
      }) as NextRequest,
    );
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).ok).toBe(true);
  });
});
