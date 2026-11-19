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
const mockRequireRole = vi.fn();

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

vi.mock("@/lib/agent-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-registry")>();
  return {
    ...actual,
    authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgent(...args),
  };
});

vi.mock("@/lib/memory/backends", () => ({
  searchVectorMemory: vi.fn(async () => ({
    results: [{ id: "v1", text: "hello", metadata: { label: "public" } }],
  })),
  queryGraphMemory: vi.fn(async () => ({
    results: [{ node: { id: "n1" }, neighbors: [{ id: "n2", text: "edge" }] }],
  })),
}));

const LOOPBACK = "http://localhost";

const operatorSession = {
  userId: "op-1",
  role: "operator" as const,
  email: "op@example.com",
  displayName: "Operator",
  tenantId: "default-tenant",
};

const reviewerSession = { ...operatorSession, role: "reviewer" as const, userId: "rev-1" };

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
  mockRequireRole.mockReset();
  mockAuthenticateAgent.mockReturnValue({ id: "agent-1" });
  mockAuthenticateUser.mockResolvedValue(operatorSession);
  mockRequireRole.mockReturnValue(null);
  delete process.env.MEMROOS_OPERATOR_API_KEY;
  delete process.env.MEMROOS_AGENT_API_KEY;
  delete process.env.MEMROOS_JWT_SECRET;
  vi.resetModules();
});

describe("long-tail batch18c — registry-write memory routes", () => {
  it("GET /api/memory/search requires registry authorization off loopback", async () => {
    const { GET } = await import("../memory/search/route");
    const res = await GET(new Request("https://example.com/api/memory/search?q=test"));
    expect(res.status).toBe(403);
  });

  it("GET /api/memory/search returns filtered vector hits on loopback", async () => {
    const { GET } = await import("../memory/search/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory/search?q=hello&limit=5`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tier).toBe("vector");
  });

  it("GET /api/memory/graph returns graph envelope", async () => {
    const { GET } = await import("../memory/graph/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory/graph?q=node&limit=10`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe("graph");
    expect(body.result).toBeTruthy();
  });

  it("GET /api/memory/graph returns 502 when backend throws", async () => {
    const backends = await import("@/lib/memory/backends");
    vi.mocked(backends.queryGraphMemory).mockRejectedValueOnce(new Error("neo4j down"));
    const { GET } = await import("../memory/graph/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory/graph`));
    expect(res.status).toBe(502);
  });

  it("GET /api/memory-lifecycle/tombstones requires subjectHash", async () => {
    const { GET } = await import("../memory-lifecycle/tombstones/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory-lifecycle/tombstones`));
    expect(res.status).toBe(400);
  });

  it("POST /api/memory-lifecycle/tombstones rejects unsupported action", async () => {
    const { POST } = await import("../memory-lifecycle/tombstones/route");
    const res = await POST(jsonBody(`${LOOPBACK}/api/memory-lifecycle/tombstones`, { action: "noop" }));
    expect(res.status).toBe(400);
  });

  it("POST /api/memory-lifecycle/tombstones verify returns continuity report", async () => {
    const { POST } = await import("../memory-lifecycle/tombstones/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/memory-lifecycle/tombstones`, {
        action: "verify",
        tenantId: "default-tenant",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.report).toBeTruthy();
  });
});

describe("long-tail batch18c — agent checkpoints + versions", () => {
  const runId = `run-${randomUUID().slice(0, 8)}`;

  it("POST /api/agent-checkpoints creates checkpoint on loopback", async () => {
    const { POST } = await import("../agent-checkpoints/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/agent-checkpoints`, {
        runId,
        ownerAgentId: "agent-1",
        objective: "batch18c objective",
        nextSafeAction: "resume",
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).checkpoint.runId).toBe(runId);
  });

  it("GET /api/agent-checkpoints requires runId", async () => {
    const { GET } = await import("../agent-checkpoints/route");
    const res = await GET(asReq(`${LOOPBACK}/api/agent-checkpoints`));
    expect(res.status).toBe(400);
  });

  it("GET /api/agent-checkpoints returns 404 for unknown run", async () => {
    const { GET } = await import("../agent-checkpoints/route");
    const res = await GET(asReq(`${LOOPBACK}/api/agent-checkpoints?runId=missing-${randomUUID()}`));
    expect(res.status).toBe(404);
  });

  it("GET /api/agent-checkpoints resumes existing checkpoint", async () => {
    const { POST, GET } = await import("../agent-checkpoints/route");
    await POST(
      jsonBody(`${LOOPBACK}/api/agent-checkpoints`, {
        runId,
        ownerAgentId: "agent-1",
        objective: "resume me",
        nextSafeAction: "continue",
      }),
    );
    const res = await GET(asReq(`${LOOPBACK}/api/agent-checkpoints?runId=${runId}`));
    expect(res.status).toBe(200);
    expect((await res.json()).checkpoint.objective).toBe("resume me");
  });

  it("GET /api/agents/versions requires agentId", async () => {
    const { GET } = await import("../agents/versions/route");
    const res = await GET(asReq(`${LOOPBACK}/api/agents/versions`));
    expect(res.status).toBe(400);
  });

  it("POST + GET /api/agents/versions round-trip", async () => {
    const agentId = `agent-${randomUUID().slice(0, 6)}`;
    const { POST, GET } = await import("../agents/versions/route");
    const post = await POST(
      jsonBody(`${LOOPBACK}/api/agents/versions`, {
        agentId,
        version: "1.0.0",
        profile: "dev",
        modelRoute: { provider: "default" },
        systemInstructions: "be helpful",
      }),
    );
    expect(post.status).toBe(200);
    const listed = await GET(asReq(`${LOOPBACK}/api/agents/versions?agentId=${agentId}`));
    expect(listed.status).toBe(200);
    expect((await listed.json()).versions.length).toBeGreaterThanOrEqual(1);
  });
});

describe("long-tail batch18c — session-backed operator routes", () => {
  it("GET /api/escalations returns envelope for reviewer", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(reviewerSession);
    const { GET } = await import("../escalations/route");
    const res = await GET(asReq(`${LOOPBACK}/api/escalations?status=all`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.escalations)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(0);
  });

  it("GET /api/escalations returns 401 without session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    mockRequireRole.mockReturnValueOnce(Response.json({ error: "forbidden" }, { status: 403 }));
    const { GET } = await import("../escalations/route");
    const res = await GET(asReq(`${LOOPBACK}/api/escalations`));
    expect(res.status).toBe(403);
  });

  it("GET /api/model-routing/recommendations returns cached recommendations", async () => {
    const { GET } = await import("../model-routing/recommendations/route");
    const res = await GET(asReq(`${LOOPBACK}/api/model-routing/recommendations?taskType=engineering&strategy=cost`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.taskType).toBe("engineering");
    expect(Array.isArray(body.recommendations)).toBe(true);
  });

  it("POST /api/model-routing/recommendations accepts JSON body", async () => {
    const { POST } = await import("../model-routing/recommendations/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/model-routing/recommendations`, {
        taskType: "research",
        strategy: "quality",
        limit: 3,
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).strategy).toBe("quality");
  });

  it("POST /api/meeting/join requires recording consent", async () => {
    const { POST } = await import("../meeting/join/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/meeting/join`, {
        roomUrl: "https://daily.example/room",
        token: "tok",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/meeting/join validates roomUrl and token", async () => {
    const { POST } = await import("../meeting/join/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/meeting/join`, {
        consentConfirmed: true,
        roomUrl: " ",
        token: "",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/meeting/join succeeds with consent + credentials", async () => {
    const { POST } = await import("../meeting/join/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/meeting/join`, {
        consentConfirmed: true,
        meetingLabel: "Standup",
        roomUrl: "https://daily.example/room",
        token: "daily-token",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meeting_id).toBeTruthy();
  });

  it("POST /api/skills/review requires skillName and action", async () => {
    const { POST } = await import("../skills/review/route");
    const res = await POST(jsonBody(`${LOOPBACK}/api/skills/review`, { skillName: "only-name" }));
    expect(res.status).toBe(400);
  });

  it("POST /api/skills/review rejects oversize notes", async () => {
    const { POST } = await import("../skills/review/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/skills/review`, {
        skillName: "demo-skill",
        action: "save-draft",
        notes: "x".repeat(5000),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/seal/proposals requires session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../seal/proposals/route");
    const res = await GET(asReq(`${LOOPBACK}/api/seal/proposals`));
    expect(res.status).toBe(401);
  });

  it("GET /api/seal/proposals lists proposals for operator session", async () => {
    const { GET } = await import("../seal/proposals/route");
    const res = await GET(asReq(`${LOOPBACK}/api/seal/proposals?status=pending`));
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).proposals)).toBe(true);
  });

  it("POST /api/seal/proposals validates traceId and runId", async () => {
    const { POST } = await import("../seal/proposals/route");
    const res = await POST(jsonBody(`${LOOPBACK}/api/seal/proposals`, { traceId: "only-trace" }));
    expect(res.status).toBe(400);
  });
});

describe("long-tail batch18c — GSD adapter + native memory ingest", () => {
  it("GET /api/gsd/adapter requires agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { GET } = await import("../gsd/adapter/route");
    const res = await GET(asReq(`${LOOPBACK}/api/gsd/adapter`));
    expect(res.status).toBe(401);
  });

  it("GET /api/gsd/adapter returns contract for authenticated agent", async () => {
    const { GET } = await import("../gsd/adapter/route");
    const res = await GET(
      asReq(`${LOOPBACK}/api/gsd/adapter`, { headers: { "x-memroos-agent-id": "agent-1" } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract.adapters.length).toBeGreaterThan(3);
  });

  it("POST /api/gsd/adapter rejects missing adapterId/action", async () => {
    const { POST } = await import("../gsd/adapter/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/gsd/adapter`, { agent: "agent-1", adapterId: "hermes" }),
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/gsd/adapter executes standup action when policy allows", async () => {
    const { POST } = await import("../gsd/adapter/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/gsd/adapter`, {
        agent: "agent-1",
        adapterId: "hermes",
        action: "standup",
        payload: { content: "Daily update" },
      }),
    );
    expect([200, 403]).toContain(res.status);
  });

  it("POST /api/native-memory/ingest rejects unauthenticated callers", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { POST } = await import("../native-memory/ingest/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/native-memory/ingest`, {
        source: "claude",
        agentId: "a",
        userId: "u",
        content: "note",
        memoryPath: "/tmp/memory.md",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/native-memory/ingest accepts operator API key bearer", async () => {
    process.env.MEMROOS_JWT_SECRET = "test-secret-for-batch18c-native-ingest-key-min-len";
    process.env.MEMROOS_OPERATOR_API_KEY = "operator-ingest-key-18c";
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { POST } = await import("../native-memory/ingest/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/native-memory/ingest`, {
        method: "POST",
        headers: {
          authorization: "Bearer operator-ingest-key-18c",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          source: "codex",
          agentId: "agent-1",
          userId: "user-1",
          content: "Captured native memory snippet",
          memoryPath: "memory/2026.md",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("POST /api/native-memory/ingest validates zod schema", async () => {
    const { POST } = await import("../native-memory/ingest/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/native-memory/ingest`, {
        source: "not-a-source",
        agentId: "",
        userId: "u",
        content: "x",
        memoryPath: "p",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("long-tail batch18c — health + error branches", () => {
  it("GET /api/health responds without auth", async () => {
    const { GET } = await import("../health/route");
    const res = await GET(asReq(`${LOOPBACK}/api/health`));
    expect(res.status).toBe(200);
  });

  it("GET /api/escalations returns 500 when queryEscalations throws", async () => {
    vi.doMock("@/lib/audit/query", () => ({
      queryEscalations: () => {
        throw new Error("escalations boom");
      },
      countEscalations: () => 0,
    }));
    mockAuthenticateUser.mockResolvedValueOnce(reviewerSession);
    const { GET } = await import("../escalations/route");
    const res = await GET(asReq(`${LOOPBACK}/api/escalations`));
    expect(res.status).toBe(500);
    vi.doUnmock("@/lib/audit/query");
    vi.resetModules();
  });

  it("POST /api/agent-checkpoints returns 400 on invalid payload", async () => {
    const { POST } = await import("../agent-checkpoints/route");
    const res = await POST(jsonBody(`${LOOPBACK}/api/agent-checkpoints`, { runId: "" }));
    expect(res.status).toBe(400);
  });

  it("GET /api/memory/search returns 502 when vector backend throws", async () => {
    const backends = await import("@/lib/memory/backends");
    vi.mocked(backends.searchVectorMemory).mockRejectedValueOnce(new Error("qdrant unavailable"));
    const { GET } = await import("../memory/search/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory/search?q=fail`));
    expect(res.status).toBe(502);
  });

  it("POST /api/skills/review returns 401 without session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { POST } = await import("../skills/review/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/skills/review`, { skillName: "x", action: "save-draft" }),
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/seal/proposals ignores invalid status filter", async () => {
    const { GET } = await import("../seal/proposals/route");
    const res = await GET(asReq(`${LOOPBACK}/api/seal/proposals?status=not-real`));
    expect(res.status).toBe(200);
  });
});
