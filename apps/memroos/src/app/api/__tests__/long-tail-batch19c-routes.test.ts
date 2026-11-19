// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateUser = vi.fn();
const mockAuthenticateAgent = vi.fn();
const mockAuthorizeRegistryWrite = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/auth/middleware-roles", () => ({
  requireRole: () => null,
}));

vi.mock("@/lib/agent-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-registry")>();
  return {
    ...actual,
    authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgent(...args),
  };
});

vi.mock("@/lib/operator-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator-auth")>();
  return {
    ...actual,
    authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  };
});

vi.mock("@/lib/memory/backends", () => ({
  searchVectorMemory: vi.fn(async () => ({ results: [] })),
}));

const LOOPBACK = "http://localhost";

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

function jsonBody(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockAuthenticateUser.mockReset();
  mockAuthenticateAgent.mockReset();
  mockAuthorizeRegistryWrite.mockReset();
  mockAuthorizeRegistryWrite.mockReturnValue(true);
  mockAuthenticateUser.mockResolvedValue({
    userId: "op-1",
    role: "operator",
    email: "op@example.com",
    displayName: "Operator",
    tenantId: "default-tenant",
  });
  mockAuthenticateAgent.mockReturnValue({ id: "agent-1" });
  vi.resetModules();
});

describe("long-tail batch19c routes — write rules and document directory", () => {
  it("DELETE /api/write-rules/[id] returns 401 without agent auth", async () => {
    mockAuthenticateAgent.mockReturnValue(null);
    const { DELETE } = await import("../write-rules/[id]/route");
    const res = await DELETE(
      new Request(`${LOOPBACK}/api/write-rules/99`, { method: "DELETE", body: "{}" }) as unknown as NextRequest,
      { params: Promise.resolve({ id: "99" }) } as never,
    );
    expect(res.status).toBe(401);
  });

  it("DELETE /api/document-directory/[id] returns 401 without agent auth", async () => {
    mockAuthenticateAgent.mockReturnValue(null);
    const { DELETE } = await import("../document-directory/[id]/route");
    const res = await DELETE(
      new Request(`${LOOPBACK}/api/document-directory/99`, { method: "DELETE", body: "{}" }) as unknown as NextRequest,
      { params: Promise.resolve({ id: "99" }) } as never,
    );
    expect(res.status).toBe(401);
  });
});

describe("long-tail batch19c routes — agents, memory, and tools", () => {
  it("GET /api/agents/versions returns 400 when agentId is missing", async () => {
    const { GET } = await import("../agents/versions/route");
    const res = await GET(asReq(`${LOOPBACK}/api/agents/versions`));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/agentId/i);
  });

  it("GET /api/agents/versions lists versions for a registered agent", async () => {
    const agentId = `agent-${randomUUID().slice(0, 8)}`;
    const { GET } = await import("../agents/versions/route");
    const res = await GET(asReq(`${LOOPBACK}/api/agents/versions?agentId=${agentId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.versions)).toBe(true);
  });

  it("POST /api/memory/add rejects non-object JSON bodies", async () => {
    const { POST } = await import("../memory/add/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/memory/add`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[]",
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/memory/search returns vector envelope with default query", async () => {
    const { GET } = await import("../memory/search/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory/search?limit=3`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tier).toBe("vector");
  });

  it("GET /api/tools/connections returns connections envelope", async () => {
    const { GET } = await import("../tools/connections/route");
    const res = await GET(asReq(`${LOOPBACK}/api/tools/connections`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.connections)).toBe(true);
  });
});

describe("long-tail batch19c routes — escalations list and seal proposals", () => {
  it("GET /api/escalations returns open queue for operators", async () => {
    const { GET } = await import("../escalations/route");
    const res = await GET(asReq(`${LOOPBACK}/api/escalations?status=open&limit=5`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.escalations)).toBe(true);
  });

  it("GET /api/seal/proposals returns proposal list envelope", async () => {
    const { GET } = await import("../seal/proposals/route");
    const res = await GET(asReq(`${LOOPBACK}/api/seal/proposals`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.proposals)).toBe(true);
  });
});
