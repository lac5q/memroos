// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateAgentKey = vi.fn();
const mockAuthorizeRegistryWrite = vi.fn();
const mockSearchVector = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentKey: (...args: unknown[]) => mockAuthenticateAgentKey(...args),
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () =>
    Response.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
}));

vi.mock("@/lib/memory/backends", () => ({
  searchVectorMemory: (...args: unknown[]) => mockSearchVector(...args),
}));

vi.mock("@/lib/memory/policy-gate", () => ({
  extractMemoryLabelSnapshot: () => ({}),
  filterAuthorizedMemoryItems: (_db: unknown, items: unknown[]) => items,
}));

const LOOPBACK = "http://localhost";

beforeEach(() => {
  mockAuthenticateAgentKey.mockReset();
  mockAuthorizeRegistryWrite.mockReset();
  mockSearchVector.mockReset();
  delete process.env.MEMROOS_AGENT_API_KEY;
  delete process.env.MEMROOS_AUDIT_ALLOW_REMOTE;
  mockAuthorizeRegistryWrite.mockReturnValue(true);
  vi.resetModules();
});

afterEach(() => {
  delete process.env.MEMROOS_AGENT_API_KEY;
  delete process.env.MEMROOS_AUDIT_ALLOW_REMOTE;
});

describe("api routes batch21 — audit/knowledge", () => {
  it("POST returns 401 without bearer and 403 with wrong shared key", async () => {
    process.env.MEMROOS_AGENT_API_KEY = "audit-shared-key-b21";
    const { POST } = await import("../audit/knowledge/route");

    const missing = await POST(
      new NextRequest(`${LOOPBACK}/api/audit/knowledge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenant_id: "t1",
          agent_id: "a1",
          operation: "read",
          path: "/x",
          op_hash: "sha256:abcd1234",
        }),
      }),
    );
    expect(missing.status).toBe(401);

    const invalid = await POST(
      new NextRequest(`${LOOPBACK}/api/audit/knowledge`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer wrong-key",
        },
        body: JSON.stringify({
          tenant_id: "t1",
          agent_id: "a1",
          operation: "read",
          path: "/x",
          op_hash: "sha256:abcd1234",
        }),
      }),
    );
    expect(invalid.status).toBe(403);
  });

  it("POST accepts per-agent ak_ keys and empty user_id string", async () => {
    mockAuthenticateAgentKey.mockReturnValue({ id: "agent-mcp" });
    const { POST } = await import("../audit/knowledge/route");
    const res = await POST(
      new NextRequest(`${LOOPBACK}/api/audit/knowledge`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer ak_test_agent_key",
        },
        body: JSON.stringify({
          tenant_id: `tenant-${randomUUID().slice(0, 8)}`,
          user_id: "",
          agent_id: "agent-mcp",
          operation: "search",
          path: "/vault/doc.md",
          op_hash: "sha256:abcd1234",
        }),
      }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).ok).toBe(true);
  });

  it("POST returns 400 for invalid JSON and validation errors", async () => {
    process.env.MEMROOS_AGENT_API_KEY = "audit-shared-key-b21";
    const { POST } = await import("../audit/knowledge/route");

    const badJson = await POST(
      new NextRequest(`${LOOPBACK}/api/audit/knowledge`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer audit-shared-key-b21",
        },
        body: "{not-json",
      }),
    );
    expect(badJson.status).toBe(400);

    const invalidBody = await POST(
      new NextRequest(`${LOOPBACK}/api/audit/knowledge`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer audit-shared-key-b21",
        },
        body: JSON.stringify({
          tenant_id: "",
          agent_id: "a1",
          operation: "read",
          path: "/x",
          op_hash: "short",
        }),
      }),
    );
    expect(invalidBody.status).toBe(400);
    expect((await invalidBody.json()).error).toMatch(/validation failed/i);
  });
});

describe("api routes batch21 — memory/search result shaping", () => {
  it("GET filters memories wrapper and numeric vector ids", async () => {
    mockSearchVector.mockResolvedValue({
      memories: [{ id: 42, text: "batch21 memory hit" }],
    });
    const { GET } = await import("../memory/search/route");
    const res = await GET(new NextRequest(`${LOOPBACK}/api/memory/search?q=batch21&limit=3`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.result.memories).toHaveLength(1);

    mockSearchVector.mockResolvedValue("not-an-array");
    const scalar = await GET(new NextRequest(`${LOOPBACK}/api/memory/search?q=scalar`));
    expect((await scalar.json()).result).toBe("not-an-array");
  });
});
