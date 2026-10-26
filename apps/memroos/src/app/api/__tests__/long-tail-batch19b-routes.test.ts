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
  queryGraphMemory: vi.fn(async () => ({ results: [] })),
  mem0HealthTimeoutMs: () => 1000,
  neo4jConfig: () => ({ password: "test", url: "http://localhost:7474" }),
}));

const LOOPBACK = "http://localhost";

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

beforeEach(() => {
  mockAuthenticateUser.mockReset();
  mockAuthenticateAgent.mockReset();
  mockAuthorizeRegistryWrite.mockReset();
  mockAuthenticateUser.mockResolvedValue({
    userId: "op-1",
    role: "operator",
    email: "op@example.com",
    displayName: "Operator",
    tenantId: "default-tenant",
  });
  mockAuthenticateAgent.mockReturnValue({ id: "agent-1" });
  mockAuthorizeRegistryWrite.mockReturnValue(true);
});

describe("long-tail batch19b routes — health, recall, agents", () => {
  it("GET /api/health returns service matrix JSON", async () => {
    const { GET } = await import("../health/route");
    const res = await GET(asReq(`${LOOPBACK}/api/health`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.services)).toBe(true);
  });

  it("GET /api/recall returns 400 for invalid cross_project scope", async () => {
    const { GET } = await import("../recall/route");
    const res = await GET(asReq(`${LOOPBACK}/api/recall?crossProject=true`));
    expect(res.status).toBe(400);
  });

  it("GET /api/agents/[id] returns 404 for unknown ids", async () => {
    const { GET } = await import("../agents/[id]/route");
    const res = await GET(asReq(`${LOOPBACK}/api/agents/missing-${randomUUID().slice(0, 8)}`), {
      params: Promise.resolve({ id: "missing-agent" }),
    } as never);
    expect(res.status).toBe(404);
  });

  it("GET /api/memory/graph returns graph health envelope", async () => {
    const { GET } = await import("../memory/graph/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory/graph`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBeDefined();
  });
});

describe("long-tail batch19b routes — proposals and dispatch", () => {
  it("GET /api/memory/proposals lists pending proposals for operators", async () => {
    const { GET } = await import("../memory/proposals/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory/proposals?limit=5`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.proposals)).toBe(true);
  });

  it("POST /api/dispatch returns 400 when body is not an object", async () => {
    const { POST } = await import("../dispatch/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(400);
  });
});
