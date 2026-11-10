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
const mockQueryGraph = vi.fn();
const mockGetMessage = vi.fn();
const mockFindReply = vi.fn();
const mockAuthenticateAgentHeaders = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentKey: (...args: unknown[]) => mockAuthenticateAgentKey(...args),
  authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgentHeaders(...args),
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () =>
    Response.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
}));

vi.mock("@/lib/memory/backends", () => ({
  searchVectorMemory: (...args: unknown[]) => mockSearchVector(...args),
  queryGraphMemory: (...args: unknown[]) => mockQueryGraph(...args),
}));

vi.mock("@/lib/memory/policy-gate", () => ({
  extractMemoryLabelSnapshot: () => ({}),
  filterAuthorizedMemoryItems: (_db: unknown, items: unknown[]) => items,
}));

vi.mock("@/lib/agent-context-bus", () => ({
  getAgentContextMessage: (...args: unknown[]) => mockGetMessage(...args),
  findReplyForAgentContextMessage: (...args: unknown[]) => mockFindReply(...args),
}));

const LOOPBACK = "http://localhost";

beforeEach(() => {
  mockAuthenticateAgentKey.mockReset();
  mockAuthorizeRegistryWrite.mockReset();
  mockSearchVector.mockReset();
  mockQueryGraph.mockReset();
  mockGetMessage.mockReset();
  mockFindReply.mockReset();
  mockAuthenticateAgentHeaders.mockReset();
  delete process.env.MEMROOS_AGENT_API_KEY;
  delete process.env.MEMROOS_AUDIT_ALLOW_REMOTE;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.MEMROOS_AGENT_API_KEY;
  delete process.env.MEMROOS_AUDIT_ALLOW_REMOTE;
});

describe("api routes batch20c — audit/knowledge", () => {
  it("POST returns 404 for remote forwarded requests", async () => {
    const { POST } = await import("../audit/knowledge/route");
    const res = await POST(
      new NextRequest(`${LOOPBACK}/api/audit/knowledge`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.1",
        },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("POST accepts null user_id and writes audit with shared agent key", async () => {
    process.env.MEMROOS_AGENT_API_KEY = "shared-agent-key-b20c";
    const { POST } = await import("../audit/knowledge/route");
    const res = await POST(
      new NextRequest(`${LOOPBACK}/api/audit/knowledge`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer shared-agent-key-b20c",
        },
        body: JSON.stringify({
          tenant_id: `tenant-${randomUUID().slice(0, 8)}`,
          user_id: null,
          agent_id: "agent-mcp",
          operation: "read",
          path: "/vault/doc.md",
          op_hash: "sha256:abcd1234",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.entryHash).toBeTruthy();
  });

  it("POST returns 503 when no agent key is configured", async () => {
    const { POST } = await import("../audit/knowledge/route");
    const res = await POST(
      new NextRequest(`${LOOPBACK}/api/audit/knowledge`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer missing" },
        body: JSON.stringify({
          tenant_id: "t1",
          agent_id: "a1",
          operation: "search",
          path: "/x",
          op_hash: "sha256:abcd1234",
        }),
      }),
    );
    expect(res.status).toBe(503);
  });
});

describe("api routes batch20c — memory search and graph", () => {
  it("GET /api/memory/search returns 401 when registry write unauthorized", async () => {
    mockAuthorizeRegistryWrite.mockReturnValue(false);
    const { GET } = await import("../memory/search/route");
    const res = await GET(new NextRequest(`${LOOPBACK}/api/memory/search?q=test`));
    expect(res.status).toBe(401);
  });

  it("GET /api/memory/search returns 502 when vector backend throws", async () => {
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    mockSearchVector.mockRejectedValue(new Error("vector_down"));
    const { GET } = await import("../memory/search/route");
    const res = await GET(new NextRequest(`${LOOPBACK}/api/memory/search?q=test`));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/vector_down/);
  });

  it("GET /api/memory/graph wraps results array shape", async () => {
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    mockQueryGraph.mockResolvedValue({ results: [{ node: { id: "n1" } }] });
    const { GET } = await import("../memory/graph/route");
    const res = await GET(new NextRequest(`${LOOPBACK}/api/memory/graph?q=neo&limit=5`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tier).toBe("graph");
  });
});

describe("api routes batch20c — agent context message by id", () => {
  it("GET returns 403 when agent is neither sender nor recipient", async () => {
    mockAuthenticateAgentHeaders.mockReturnValue({ id: "outsider" });
    mockGetMessage.mockReturnValue({ id: "m1", fromAgent: "a", toAgent: "b" });
    const { GET } = await import("../agent-context/messages/[id]/route");
    const res = await GET(
      new NextRequest(`${LOOPBACK}/api/agent-context/messages/m1`, {
        headers: { "x-agent-id": "outsider" },
      }),
      { params: Promise.resolve({ id: "m1" }) },
    );
    expect(res.status).toBe(403);
  });

  it("GET wait_for=reply returns timedOut when no reply arrives", async () => {
    mockAuthenticateAgentHeaders.mockReturnValue({ id: "agent-a" });
    mockGetMessage.mockReturnValue({ id: "m1", fromAgent: "agent-a", toAgent: "agent-b" });
    mockFindReply.mockReturnValue(null);
    const { GET } = await import("../agent-context/messages/[id]/route");
    const res = await GET(
      new NextRequest(`${LOOPBACK}/api/agent-context/messages/m1?wait_for=reply&wait_ms=1`, {
        headers: { "x-agent-id": "agent-a" },
      }),
      { params: Promise.resolve({ id: "m1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timedOut).toBe(true);
    expect(body.reply).toBeNull();
  });
});
