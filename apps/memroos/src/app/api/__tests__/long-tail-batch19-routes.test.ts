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
    listRegisteredAgents: vi.fn(() => []),
    getRemoteAgents: vi.fn(() => []),
  };
});

vi.mock("@/lib/dispatch/adapter-factory", () => ({
  selectAdapter: vi.fn(() => ({ id: "noop", label: "noop" })),
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

describe("long-tail batch19 routes — engagement, gsd, workspace, public runs", () => {
  it("POST /api/engagement/test returns agent engagement checks envelope", async () => {
    const { POST } = await import("../engagement/test/route");
    const res = await POST(jsonBody(`${LOOPBACK}/api/engagement/test`, {}) as unknown as NextRequest);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("POST /api/gsd/discuss returns 400 when body is not an object", async () => {
    const { POST } = await import("../gsd/discuss/route");
    const res = await POST(jsonBody(`${LOOPBACK}/api/gsd/discuss`, null) as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it("GET /api/workspace returns workspace snapshot for authenticated users", async () => {
    const { GET } = await import("../workspace/route");
    const res = await GET(asReq(`${LOOPBACK}/api/workspace`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("GET /api/public/v1/runs/[runId] returns 401 without tenant bearer", async () => {
    const { GET } = await import("../public/v1/runs/[runId]/route");
    const res = await GET(asReq(`${LOOPBACK}/api/public/v1/runs/run-1`), {
      params: Promise.resolve({ runId: "run-1" }),
    } as never);
    expect(res.status).toBe(401);
  });

  it("GET /api/skills returns registry listing for operators", async () => {
    const { GET } = await import("../skills/route");
    const res = await GET(asReq(`${LOOPBACK}/api/skills?limit=5`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.allSkills)).toBe(true);
  });

  it("GET /api/hive returns 403 on POST when registry write is unauthorized", async () => {
    const operatorAuth = await import("@/lib/operator-auth");
    vi.spyOn(operatorAuth, "authorizeRegistryWrite").mockReturnValue(false);
    const { POST } = await import("../hive/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/hive`, {
        agent_id: "agent-1",
        action_type: "continue",
        summary: "noop",
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(403);
    vi.restoreAllMocks();
  });
});
