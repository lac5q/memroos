// @vitest-environment node
import { randomUUID } from "node:crypto";
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

describe("batch14c — easy API long-tail routes", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockAuthenticateAgent.mockReset();
    mockAuthorizeRegistryWrite.mockReset();
    mockAuthenticateUser.mockResolvedValue(operatorSession);
    mockAuthenticateAgent.mockReturnValue({ id: "agent-1" });
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    vi.resetModules();
    vi.doUnmock("@/lib/a2a/card-ingestion");
    vi.doUnmock("@/lib/context-sources");
    vi.doUnmock("@/lib/observe-health");
    vi.doUnmock("@/lib/parsers");
  });

  it("GET /api/activity returns 500 when response serialization throws", async () => {
    vi.doMock("next/server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("next/server")>();
      return {
        ...actual,
        NextResponse: {
          ...actual.NextResponse,
          json: vi.fn(() => {
            throw new Error("activity boom");
          }),
        },
      };
    });
    const { GET } = await import("../activity/route");
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "activity boom" });
  });

  it("GET /api/gitnexus returns 500 when response serialization throws", async () => {
    vi.doMock("next/server", async (importOriginal) => {
      const actual = await importOriginal<typeof import("next/server")>();
      return {
        ...actual,
        NextResponse: {
          ...actual.NextResponse,
          json: vi.fn(() => {
            throw new Error("gitnexus boom");
          }),
        },
      };
    });
    const { GET } = await import("../gitnexus/route");
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it("GET /api/memory returns 500 when parser throws", async () => {
    vi.doMock("@/lib/parsers", () => ({
      parseClaudeMemory: vi.fn(async () => {
        throw new Error("parse failed");
      }),
    }));
    const { GET } = await import("../memory/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory?source=claude`));
    expect(res.status).toBe(500);
  });

  it("GET /api/context/health requires auth", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../context/health/route");
    expect((await GET(asReq(`${LOOPBACK}/api/context/health`))).status).toBe(401);
  });

  it("GET /api/context/health returns 500 when evaluation throws", async () => {
    vi.doMock("@/lib/context-sources", () => ({
      loadContextSourceContracts: vi.fn(() => []),
      evaluateContextSources: vi.fn(() => {
        throw new Error("context eval failed");
      }),
    }));
    const { GET } = await import("../context/health/route");
    const res = await GET(asReq(`${LOOPBACK}/api/context/health`));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "context eval failed" });
  });

  it("GET /api/observe/health returns 500 when harness listing throws", async () => {
    vi.doMock("@/lib/observe-health", () => ({
      listObserveHarnessHealth: vi.fn(() => {
        throw new Error("observe down");
      }),
    }));
    const { GET } = await import("../observe/health/route");
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it("GET /api/memory-lifecycle/audit returns 400 on verify failure", async () => {
    vi.doMock("@/lib/audit/memory-chain", () => ({
      verifyMemoryAuditChain: vi.fn(() => {
        throw new Error("chain broken");
      }),
    }));
    const { GET } = await import("../memory-lifecycle/audit/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory-lifecycle/audit`));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "chain broken" });
  });

  it("POST /api/agent-memory/capture returns 400 when capture throws", async () => {
    vi.doMock("@/lib/agent-memory-continuity", () => ({
      captureCodingAgentSession: vi.fn(() => {
        throw new Error("capture rejected");
      }),
    }));
    const { POST } = await import("../agent-memory/capture/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/agent-memory/capture`, { sessionId: "s1" }) as unknown as NextRequest
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "capture rejected" });
  });

  it("POST /api/agent-memory/handoff returns 400 when handoff throws", async () => {
    vi.doMock("@/lib/agent-memory-continuity", () => ({
      buildCodingAgentHandoffPack: vi.fn(() => {
        throw new Error("handoff failed");
      }),
    }));
    const { POST } = await import("../agent-memory/handoff/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/agent-memory/handoff`, { fromAgent: "a", toAgent: "b" }) as unknown as NextRequest
    );
    expect(res.status).toBe(400);
  });

  it("PATCH /api/cron-health rejects invalid JSON", async () => {
    const { PATCH } = await import("../cron-health/route");
    const res = await PATCH(
      new Request(`${LOOPBACK}/api/cron-health`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: "{",
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/dsar/delete rejects invalid JSON for admin", async () => {
    mockAuthenticateUser.mockResolvedValue(adminSession);
    const { POST } = await import("../dsar/delete/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/dsar/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }) as unknown as NextRequest
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/dsar/export rejects invalid JSON for admin", async () => {
    mockAuthenticateUser.mockResolvedValue(adminSession);
    const { POST } = await import("../dsar/export/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/dsar/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{bad",
      }) as unknown as NextRequest
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/evidence/task-bundles rejects invalid JSON", async () => {
    const { POST } = await import("../evidence/task-bundles/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/evidence/task-bundles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[]",
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/gsd/discuss returns 400 when council throws", async () => {
    vi.doMock("@/lib/gsd/discuss", () => ({
      runBoundedDiscussCouncil: vi.fn(() => {
        throw new Error("discuss council error");
      }),
    }));
    const { POST } = await import("../gsd/discuss/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/gsd/discuss`, {
        topic: "t",
        roles: [],
        contributions: [],
        verdict: { decision: "approve", summary: "ok" },
      }) as unknown as NextRequest
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "discuss council error" });
  });

  it("POST /api/a2a/agents/register rejects missing cardUrl", async () => {
    const { POST } = await import("../a2a/agents/register/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/a2a/agents/register`, {}));
    expect(res.status).toBe(400);
  });

  it("POST /api/a2a/agents/register returns 500 on unexpected ingest error", async () => {
    vi.doMock("@/lib/a2a/card-ingestion", () => ({
      ingestA2aAgentCard: vi.fn(async () => {
        throw new Error("network fail");
      }),
    }));
    const { POST } = await import("../a2a/agents/register/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/a2a/agents/register`, { cardUrl: "https://example/card.json" })
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "INTERNAL" });
  });

  it("POST /api/agents/register rejects invalid platform", async () => {
    const { POST } = await import("../agents/register/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/agents/register`, {
        id: "x",
        name: "X",
        role: "dev",
        platform: "invalid-platform",
        protocol: "rest",
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/agents/register rejects non-object body", async () => {
    const { POST } = await import("../agents/register/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/agents/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify("string-body"),
      })
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/tools/usage returns 503 when Nango is not configured", async () => {
    const { ToolAuthConfigError } = await import("@/lib/tool-auth/nango-client");
    vi.doMock("@/lib/tool-auth/nango-client", () => ({
      getNangoUsage: vi.fn(async () => {
        throw new ToolAuthConfigError("missing secret");
      }),
      ToolAuthConfigError,
      ToolAuthUpstreamError: class ToolAuthUpstreamError extends Error {
        status = 502;
      },
    }));
    const { GET } = await import("../tools/usage/route");
    const res = await GET(asReq(`${LOOPBACK}/api/tools/usage`));
    expect(res.status).toBe(503);
  });

  it("GET /api/tools/connections falls back to vault on config error", async () => {
    const { ToolAuthConfigError } = await import("@/lib/tool-auth/nango-client");
    vi.doMock("@/lib/tool-auth/nango-client", () => ({
      listNangoConnections: vi.fn(async () => {
        throw new ToolAuthConfigError("nango off");
      }),
      ToolAuthConfigError,
      ToolAuthUpstreamError: class ToolAuthUpstreamError extends Error {
        status = 502;
      },
    }));
    const { GET } = await import("../tools/connections/route");
    const res = await GET(asReq(`${LOOPBACK}/api/tools/connections`));
    expect(res.status).toBe(200);
    expect((await res.json()).connections).toBeDefined();
  });

  it("GET /api/public/v1/runs/[runId] requires tenant auth", async () => {
    const { GET } = await import("../public/v1/runs/[runId]/route");
    const res = await GET(asReq(`${LOOPBACK}/api/public/v1/runs/${randomUUID()}`), {
      params: Promise.resolve({ runId: "run-1" }),
    } as never);
    expect(res.status).toBe(401);
  });

  it("GET /api/seal/jobs/[id]/evidence returns 404 for unknown job", async () => {
    const { GET } = await import("../seal/jobs/[id]/evidence/route");
    const res = await GET(asReq(`${LOOPBACK}/api/seal/jobs/missing-job/evidence`), {
      params: Promise.resolve({ id: "missing-job" }),
    } as never);
    expect(res.status).toBe(404);
  });

  it("GET /api/users/[userId]/api-keys forbids cross-user listing", async () => {
    const { GET } = await import("../users/[userId]/api-keys/route");
    const res = await GET(asReq(`${LOOPBACK}/api/users/other-user/api-keys`), {
      params: Promise.resolve({ userId: "other-user" }),
    } as never);
    expect(res.status).toBe(403);
  });

  it("POST /api/memory/policy-lab rejects empty variants", async () => {
    const { POST } = await import("../memory/policy-lab/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/memory/policy-lab`, { variants: [] }) as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it("POST /api/memory/policy-lab rejects malformed variant", async () => {
    const { POST } = await import("../memory/policy-lab/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/memory/policy-lab`, { variants: [{ name: "x" }] }) as unknown as NextRequest
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/evidence/task-bundles requires taskId", async () => {
    const { GET } = await import("../evidence/task-bundles/route");
    const res = await GET(asReq(`${LOOPBACK}/api/evidence/task-bundles`));
    expect(res.status).toBe(400);
  });
});
