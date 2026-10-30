// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthorizeRegistryWrite = vi.fn();
mockAuthorizeRegistryWrite.mockReturnValue(true);
const mockSearchVector = vi.fn();
const mockAuthenticateUser = vi.fn();
const mockAuthenticateAgent = vi.fn();
const mockCheckGraphHealth = vi.fn();
const mockCheckVectorHealth = vi.fn();
const mockGetInvalidationHistory = vi.fn();
const mockReflectOnTrace = vi.fn();
const mockListProposals = vi.fn();
const mockApproveImportProposal = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () =>
    Response.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
}));

vi.mock("@/lib/memory/backends", () => ({
  searchVectorMemory: (...args: unknown[]) => mockSearchVector(...args),
  checkGraphHealth: (...args: unknown[]) => mockCheckGraphHealth(...args),
  checkVectorHealth: (...args: unknown[]) => mockCheckVectorHealth(...args),
  mem0HealthTimeoutMs: () => 15_000,
}));

vi.mock("@/lib/memory/policy-gate", () => ({
  extractMemoryLabelSnapshot: () => ({}),
  filterAuthorizedMemoryItems: (_db: unknown, items: unknown[]) => items,
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgent(...args),
}));

vi.mock("@/lib/space-cache", () => ({
  getInvalidationHistory: (...args: unknown[]) => mockGetInvalidationHistory(...args),
}));

vi.mock("@/lib/seal/service", () => ({
  SealService: class {
    listProposals = (...args: unknown[]) => mockListProposals(...args);
    reflectOnTrace = (...args: unknown[]) => mockReflectOnTrace(...args);
  },
}));

vi.mock("@/lib/skills/skill-sync", () => ({
  approveImportProposal: (...args: unknown[]) => mockApproveImportProposal(...args),
  requireHarness: (h: string) => h,
  SkillSyncError: class SkillSyncError extends Error {},
}));

vi.mock("@/app/api/skills/_sync-auth", () => ({
  authorizeSyncWrite: () => ({ ok: true as const }),
}));

const LOOPBACK = "http://localhost";

function asNext(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

beforeEach(() => {
  mockAuthorizeRegistryWrite.mockReturnValue(true);
  mockAuthenticateAgent.mockReturnValue({ id: "agent-batch22c" });
  mockAuthenticateUser.mockResolvedValue({
    userId: "op-batch22c",
    role: "operator",
    email: "op@example.com",
    displayName: "Op",
    tenantId: "default-tenant",
  });
  mockSearchVector.mockReset();
  mockGetInvalidationHistory.mockReset();
  mockReflectOnTrace.mockReset();
  mockListProposals.mockReset();
  mockApproveImportProposal.mockReset();
  mockCheckGraphHealth.mockResolvedValue({ tier: "graph", backend: "neo4j", status: "up" });
  mockCheckVectorHealth.mockResolvedValue({ tier: "vector", backend: "mem0", status: "up" });
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("api routes batch22c — memory/search helpers", () => {
  it("GET handles bare arrays, memories key, and index targets", async () => {
    mockSearchVector.mockResolvedValueOnce([{ text: "no id batch22c" }]);
    const { GET } = await import("../memory/search/route");
    const arrayRes = await GET(new NextRequest(`${LOOPBACK}/api/memory/search?q=array`));
    expect((await arrayRes.json()).result).toHaveLength(1);

    mockSearchVector.mockResolvedValueOnce({
      memories: [{ id: 42, text: "numeric id batch22c" }],
    });
    const memRes = await GET(new NextRequest(`${LOOPBACK}/api/memory/search?q=memories`));
    expect((await memRes.json()).result.memories[0].id).toBe(42);

    mockSearchVector.mockResolvedValueOnce({ other: "shape" });
    const rawRes = await GET(new NextRequest(`${LOOPBACK}/api/memory/search?q=raw`));
    expect((await rawRes.json()).result).toEqual({ other: "shape" });
  });

  it("GET returns 502 when vector search throws", async () => {
    mockSearchVector.mockRejectedValueOnce(new Error("vector down batch22c"));
    const { GET } = await import("../memory/search/route");
    const res = await GET(new NextRequest(`${LOOPBACK}/api/memory/search?q=fail`));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/vector down batch22c/i);
  });
});

describe("api routes batch22c — space-cache history", () => {
  it("GET requires agent auth and spaceId", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { GET } = await import("../space-cache/history/route");
    const unauth = await GET(asNext(`${LOOPBACK}/api/space-cache/history?spaceId=s1`));
    expect(unauth.status).toBe(401);

    mockGetInvalidationHistory.mockReturnValueOnce([{ id: "h1" }]);
    const ok = await GET(asNext(`${LOOPBACK}/api/space-cache/history?space_id=space-batch22c`, { headers: { "x-memroos-agent-id": "agent-batch22c" } }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).history).toHaveLength(1);

    mockGetInvalidationHistory.mockImplementationOnce(() => {
      throw new Error("history batch22c boom");
    });
    const err = await GET(asNext(`${LOOPBACK}/api/space-cache/history?spaceId=s1`, { headers: { "x-memroos-agent-id": "agent-batch22c" } }));
    expect(err.status).toBe(500);
  });
});

describe("api routes batch22c — connmem sync proxy", () => {
  it("POST validates source and proxies upstream", async () => {
    vi.stubEnv("CONNMEM_URL", `${LOOPBACK}:3290`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ synced: true, batch22c: randomUUID().slice(0, 8) }),
      })),
    );

    const { POST } = await import("../connmem/sync/[source]/route");
    const bad = await POST(asNext(`${LOOPBACK}/api/connmem/sync/BAD`, { method: "POST", headers: { "x-memroos-agent-id": "agent-batch22c" } }), {
      params: Promise.resolve({ source: "BAD" }),
    });
    expect(bad.status).toBe(400);

    const ok = await POST(asNext(`${LOOPBACK}/api/connmem/sync/notion`, { method: "POST", headers: { "x-memroos-agent-id": "agent-batch22c" } }), {
      params: Promise.resolve({ source: "notion" }),
    });
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);

    vi.mocked(fetch).mockRejectedValueOnce(new Error("connmem offline batch22c"));
    const down = await POST(asNext(`${LOOPBACK}/api/connmem/sync/notion`, { method: "POST", headers: { "x-memroos-agent-id": "agent-batch22c" } }), {
      params: Promise.resolve({ source: "notion" }),
    });
    expect(down.status).toBe(502);
  });
});

describe("api routes batch22c — seal proposals", () => {
  it("GET lists proposals; POST reflects trace", async () => {
    mockListProposals.mockReturnValueOnce([{ id: "p1" }]);
    const { GET, POST } = await import("../seal/proposals/route");

    const list = await GET(asNext(`${LOOPBACK}/api/seal/proposals?status=pending`));
    expect(list.status).toBe(200);
    expect((await list.json()).proposals).toHaveLength(1);

    mockReflectOnTrace.mockResolvedValueOnce([{ id: "p2" }]);
    const ok = await POST(
      new Request(`${LOOPBACK}/api/seal/proposals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ traceId: "trace-batch22c", runId: "run-batch22c" }),
      }),
    );
    expect(ok.status).toBe(200);

    mockReflectOnTrace.mockRejectedValueOnce(new Error("reflect batch22c failed"));
    const bad = await POST(
      new Request(`${LOOPBACK}/api/seal/proposals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ traceId: "t", runId: "r" }),
      }),
    );
    expect(bad.status).toBe(400);
  });
});

describe("api routes batch22c — agents versions and checkpoints", () => {
  it("creates and lists agent versions", async () => {
    const { GET, POST } = await import("../agents/versions/route");

    const missing = await GET(new Request(`${LOOPBACK}/api/agents/versions`));
    expect(missing.status).toBe(400);

    const created = await POST(
      new Request(`${LOOPBACK}/api/agents/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: "agent-batch22c",
          version: "1.0.0-batch22c",
          profile: "test",
          modelRoute: { primary: "claude" },
          systemInstructions: "Be helpful.",
        }),
      }),
    );
    expect(created.status).toBe(200);

    const listed = await GET(new Request(`${LOOPBACK}/api/agents/versions?agentId=agent-batch22c`));
    expect((await listed.json()).versions.length).toBeGreaterThan(0);
  });

  it("creates and resumes agent checkpoints", async () => {
    const { GET, POST } = await import("../agent-checkpoints/route");
    const runId = `run-${randomUUID().slice(0, 8)}`;

    const created = await POST(
      new Request(`${LOOPBACK}/api/agent-checkpoints`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          runId,
          ownerAgentId: "agent-batch22c",
          objective: "batch22c checkpoint",
          nextSafeAction: "continue",
        }),
      }),
    );
    expect(created.status).toBe(200);

    const missing = await GET(new Request(`${LOOPBACK}/api/agent-checkpoints`));
    expect(missing.status).toBe(400);

    const resumed = await GET(new Request(`${LOOPBACK}/api/agent-checkpoints?runId=${runId}`));
    expect(resumed.status).toBe(200);
    expect((await resumed.json()).checkpoint.runId).toBe(runId);
  });
});

describe("api routes batch22c — memory health and model routing", () => {
  it("GET /api/memory/health accepts registry or agent auth", async () => {
    testDb.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('last_ingest_ts', ?)").run(
      new Date(Date.now() - 48 * 3_600_000).toISOString(),
    );
    const { GET } = await import("../memory/health/route");
    const ok = await GET(new Request(`${LOOPBACK}/api/memory/health`));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.recallIngest.status).toBe("stale");
  });

  it("GET and POST model-routing recommendations", async () => {
    const { GET, POST } = await import("../model-routing/recommendations/route");
    const getRes = await GET(asNext(`${LOOPBACK}/api/model-routing/recommendations?taskType=sales&strategy=cost&limit=2`));
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.taskType).toBe("sales");
    expect(getBody.strategy).toBe("cost");

    const postRes = await POST(
      asNext(`${LOOPBACK}/api/model-routing/recommendations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskType: "marketing", strategy: "quality", limit: 3 }),
      }),
    );
    expect(postRes.status).toBe(200);
    expect((await postRes.json()).recommendations).toBeDefined();
  });
});

describe("api routes batch22c — connector-search and skills sync approve", () => {
  it("GET connector-search validates q and returns rows", async () => {
    const { GET } = await import("../internal/connector-search/route");
    const missing = await GET(asNext(`${LOOPBACK}/api/internal/connector-search`));
    expect(missing.status).toBe(400);

    const ok = await GET(asNext(`${LOOPBACK}/api/internal/connector-search?q=batch22c&limit=5&agent_id=agent-batch22c`));
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe("ok");
  });

  it("POST skills/sync/approve validates body and approves", async () => {
    mockApproveImportProposal.mockReturnValueOnce({ skill_name: "demo", status: "approved" });
    const { POST } = await import("../skills/sync/approve/route");
    const bad = await POST(
      new Request(`${LOOPBACK}/api/skills/sync/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(bad.status).toBe(400);

    const ok = await POST(
      new Request(`${LOOPBACK}/api/skills/sync/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          skill_name: "demo-skill",
          source_harness: "cursor",
          operator: "op-batch22c",
        }),
      }),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);
  });
});
