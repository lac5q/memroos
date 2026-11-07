// @vitest-environment node
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
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

const LOOPBACK = "http://localhost";
const operatorSession = {
  userId: "op-1",
  role: "operator" as const,
  email: "op@example.com",
  displayName: "Operator",
  tenantId: "default-tenant",
};
const adminSession = { ...operatorSession, role: "admin" as const };

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

function jsonPost(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("batch14c — mid-list API routes (unc≈2)", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockAuthenticateAgent.mockReset();
    mockAuthorizeRegistryWrite.mockReset();
    mockAuthenticateUser.mockResolvedValue(operatorSession);
    mockAuthenticateAgent.mockReturnValue({ id: "agent-1" });
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    vi.resetModules();
  });

  it("GET /api/admin/compliance requires admin auth", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../admin/compliance/route");
    expect((await GET(asReq(`${LOOPBACK}/api/admin/compliance`))).status).toBe(401);
  });

  it("PUT /api/admin/compliance rejects missing JSON body", async () => {
    mockAuthenticateUser.mockResolvedValue(adminSession);
    const { PUT } = await import("../admin/compliance/route");
    const res = await PUT(
      new Request(`${LOOPBACK}/api/admin/compliance`, { method: "PUT" }) as unknown as NextRequest
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/agent-checkpoints/metrics returns 500 when metrics throw", async () => {
    vi.doMock("@/lib/agent-checkpoints", () => ({
      getCheckpointMetrics: vi.fn(() => {
        throw new Error("metrics unavailable");
      }),
    }));
    const { GET } = await import("../agent-checkpoints/metrics/route");
    const res = await GET(new Request(`${LOOPBACK}/api/agent-checkpoints/metrics`));
    expect(res.status).toBe(500);
  });

  it("POST /api/orchestration rejects missing taskSummary", async () => {
    const { POST } = await import("../orchestration/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/orchestration`, {}));
    expect(res.status).toBe(400);
  });

  it("POST /api/orchestration returns 502 when client throws", async () => {
    vi.doMock("@/lib/orchestration/client", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/orchestration/client")>();
      return {
        ...actual,
        postOrchestrationTask: vi.fn(async () => {
          throw new Error("orchestrator down");
        }),
      };
    });
    const { POST } = await import("../orchestration/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/orchestration`, { taskSummary: "sync docs" }));
    expect(res.status).toBe(502);
  });

  it("POST /api/artifact-gate/save rejects unauthenticated agent callers", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { POST } = await import("../artifact-gate/save/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/artifact-gate/save`, { path: "x" }) as unknown as NextRequest);
    expect(res.status).toBe(401);
  });

  it("GET /api/cache/stats returns cache metrics envelope", async () => {
    const { GET } = await import("../cache/stats/route");
    const res = GET();
    expect(res.status).toBe(200);
    expect((await res.json()).metrics).toBeDefined();
  });

  it("GET /api/directives/diff rejects missing JSON body when authed", async () => {
    mockAuthenticateUser.mockResolvedValue(adminSession);
    const { GET } = await import("../directives/diff/route");
    const res = await GET(new NextRequest(`${LOOPBACK}/api/directives/diff?tenant=default-tenant`));
    expect(res.status).toBe(400);
  });

  it("GET /api/escalations returns list for authed operator", async () => {
    const { GET } = await import("../escalations/route");
    const res = await GET(asReq(`${LOOPBACK}/api/escalations`));
    expect(res.status).toBe(200);
  });

  it("POST /api/meeting/join rejects invalid JSON", async () => {
    const { POST } = await import("../meeting/join/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/meeting/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      })
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/memory/health returns envelope", async () => {
    const { GET } = await import("../memory/health/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory/health`));
    expect(res.status).toBe(200);
  });

  it("GET /api/shared-space/history requires agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { GET } = await import("../shared-space/history/route");
    expect((await GET(asReq(`${LOOPBACK}/api/shared-space/history?spaceId=s1`))).status).toBe(401);
  });

  it("GET /api/space-cache/history requires spaceId query", async () => {
    const { GET } = await import("../space-cache/history/route");
    expect((await GET(asReq(`${LOOPBACK}/api/space-cache/history`))).status).toBe(400);
  });

  it("POST /api/skills/review rejects missing skillId", async () => {
    const { POST } = await import("../skills/review/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/skills/review`, {}));
    expect(res.status).toBe(400);
  });

  it("GET /api/agents/versions rejects registry write when unauthorized", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { GET } = await import("../agents/versions/route");
    const res = await GET(new Request(`${LOOPBACK}/api/agents/versions?agentId=a1`));
    expect(res.status).toBe(403);
  });

  it("POST /api/agents/versions/rollback rejects invalid JSON", async () => {
    const { POST } = await import("../agents/versions/rollback/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/agents/versions/rollback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/native-memory/ingest rejects missing payload", async () => {
    const { POST } = await import("../native-memory/ingest/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/native-memory/ingest`, {}));
    expect(res.status).toBe(400);
  });

  it("POST /api/orchestration/federated/execute rejects empty task", async () => {
    const { POST } = await import("../orchestration/federated/execute/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/orchestration/federated/execute`, {}));
    expect(res.status).toBe(400);
  });

  it("POST /api/policy/knowledge rejects missing action", async () => {
    const { POST } = await import("../policy/knowledge/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/policy/knowledge`, {}) as unknown as NextRequest);
    expect(res.status).toBe(400);
  });
});
