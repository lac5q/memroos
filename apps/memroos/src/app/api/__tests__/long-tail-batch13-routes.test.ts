// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgent(...args),
  recordToolOutcome: vi.fn(),
  recordHeartbeat: vi.fn(() => ({ ok: true })),
  listRegisteredAgents: vi.fn(() => [
    { id: "agent-1", name: "Agent", role: "worker", status: "active", capabilities: [] },
  ]),
}));

vi.mock("@/lib/parsers", () => ({
  parseClaudeMemory: vi.fn(async () => ({ sections: [], path: "mock" })),
}));

vi.mock("@/lib/operator-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator-auth")>();
  return {
    ...actual,
    authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  };
});

vi.mock("@/lib/knowledge-collections", () => ({
  loadCollections: vi.fn(() => []),
  collectCollectionFiles: vi.fn(async () => []),
}));

vi.mock("@/lib/tool-auth/nango-client", () => ({
  listNangoConnections: vi.fn(async () => []),
  listNangoIntegrationKeys: vi.fn(async () => new Set<string>()),
}));

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn(async () => "2026-01-01T12:00:00 INFO ok\\n"),
    readdir: vi.fn(async () => []),
    stat: vi.fn(async () => ({ mtime: new Date("2026-01-01T00:00:00.000Z") })),
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

const reviewerSession = {
  ...operatorSession,
  role: "reviewer" as const,
};

const adminSession = {
  ...operatorSession,
  role: "admin" as const,
};

const defaultAgent = { id: "agent-1", name: "Agent" };

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

describe("long-tail batch 13 — API routes", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockAuthenticateAgent.mockReset();
    mockAuthorizeRegistryWrite.mockReset();
    mockAuthenticateUser.mockResolvedValue(operatorSession);
    mockAuthenticateAgent.mockReturnValue(defaultAgent);
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    delete process.env.MEMROOS_OPERATOR_API_KEY;
    delete process.env.MEMROOS_AGENT_API_KEY;
    delete process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL;
  });


  it("POST /api/auth/logout clears session cookies", async () => {
    const { POST } = await import("../auth/logout/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/auth/logout`, { method: "POST" })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });

  it("GET /api/agent-context parses comma-separated acceptance criteria", async () => {
    const { GET } = await import("../agent-context/route");
    const res = await GET(
      asReq(`${LOOPBACK}/api/agent-context?goal_id=g1&acceptance=one,two`, {
        headers: { "x-agent-id": "agent-1" },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("POST /api/agent-context/messages/:id/ack returns 404 for unknown message", async () => {
    const { POST } = await import("../agent-context/messages/[id]/ack/route");
    const res = await POST(
      asReq(`${LOOPBACK}/api/agent-context/messages/missing/ack`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-id": "agent-1" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "missing" }) }
    );
    expect(res.status).toBe(404);
  });

  it("POST /api/agent-context/messages/:id/reply requires body", async () => {
    const { POST } = await import("../agent-context/messages/[id]/reply/route");
    const res = await POST(
      asReq(`${LOOPBACK}/api/agent-context/messages/m1/reply`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-id": "agent-1" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "m1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/chatgpt/actions/search on loopback requires query", async () => {
    const { POST } = await import("../chatgpt/actions/search/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/chatgpt/actions/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/chatgpt/actions/search returns results for valid query", async () => {
    const { POST } = await import("../chatgpt/actions/search/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/chatgpt/actions/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "memory", limit: 3 }),
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("GET /api/gitnexus returns registry repos when configured", async () => {
    const registryPath = path.join(os.tmpdir(), `gitnexus-reg-${randomUUID()}.json`);
    fs.writeFileSync(
      registryPath,
      JSON.stringify([
        {
          name: "memroos",
          path: os.tmpdir(),
          stats: { files: 1, nodes: 2, edges: 3, communities: 1, processes: 1 },
        },
      ])
    );
    process.env.GITNEXUS_REGISTRY = registryPath;
    vi.resetModules();
    const { GET } = await import("../gitnexus/route");
    const res = await GET();
    expect(res.status).toBe(200);
    delete process.env.GITNEXUS_REGISTRY;
    fs.rmSync(registryPath, { force: true });
  });

  it("GET /api/audit supports comma-separated eventType filter", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(reviewerSession);
    const { GET } = await import("../audit/route");
    const res = await GET(
      asReq(`${LOOPBACK}/api/audit?eventType=login,logout&limit=5`)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[] };
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it("GET /api/hive returns action feed JSON", async () => {
    const { GET } = await import("../hive/route");
    const res = await GET(asReq(`${LOOPBACK}/api/hive?limit=5`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { actions: unknown[]; timestamp: string };
    expect(Array.isArray(body.actions)).toBe(true);
    expect(body.timestamp).toBeTruthy();
  });

  it("GET /api/recall returns bm25 results on loopback", async () => {
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    const { GET } = await import("../recall/route");
    const res = await GET(asReq(`${LOOPBACK}/api/recall?q=test&limit=3`));
    expect(res.status).toBe(200);
  });

  it("POST /api/ontology requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../ontology/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/ontology`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "discover" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/auth/login rejects invalid JSON", async () => {
    const { POST } = await import("../auth/login/route");
    const res = await POST(
      asReq(`${LOOPBACK}/api/auth/login`, { method: "POST", body: "not-json" })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/artifact-gate/prompt accepts invalid JSON as empty body", async () => {
    const { POST } = await import("../artifact-gate/prompt/route");
    const res = await POST(
      asReq(`${LOOPBACK}/api/artifact-gate/prompt`, {
        method: "POST",
        headers: { "x-agent-id": "agent-1" },
        body: "not-json",
      })
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/agent-runtime/observability renders HTML for registry writers", async () => {
    const { GET } = await import("../agent-runtime/observability/route");
    const res = GET(asReq(`${LOOPBACK}/api/agent-runtime/observability`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("GET /api/heartbeat GET rejects unsafe agent ids", async () => {
    const { GET } = await import("../heartbeat/route");
    const res = await GET(new Request(`${LOOPBACK}/api/heartbeat?agent=../evil`));
    expect(res.status).toBe(400);
  });

  it("POST /api/heartbeat requires agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { POST } = await import("../heartbeat/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/heartbeat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/skills/sync parses boolean filters", async () => {
    const { GET } = await import("../skills/sync/route");
    const res = await GET(new Request(`${LOOPBACK}/api/skills/sync?pending_only=1&limit=10`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; ok: boolean };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
  });

  it("POST /api/orchestration/plans/execute rejects non-object body", async () => {
    const { POST } = await import("../orchestration/plans/execute/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/orchestration/plans/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([]),
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/orchestration/plans/validate rejects non-object body", async () => {
    const { POST } = await import("../orchestration/plans/validate/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/orchestration/plans/validate`, {
        method: "POST",
        body: "null",
      })
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/directives/diff requires session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../directives/diff/route");
    const res = await GET(new Request(`${LOOPBACK}/api/directives/diff`, { method: "GET" }) as never);
    expect(res.status).toBe(401);
  });

  it("GET /api/classification/reviews requires authentication", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../classification/reviews/route");
    const res = await GET(asReq(`${LOOPBACK}/api/classification/reviews`));
    expect(res.status).toBe(401);
  });

  it("GET /api/classification/reviews lists for reviewer", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(reviewerSession);
    const { GET } = await import("../classification/reviews/route");
    const res = await GET(asReq(`${LOOPBACK}/api/classification/reviews?status=open`));
    expect(res.status).toBe(200);
  });

  it("GET /api/context/health requires auth", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../context/health/route");
    const res = await GET(asReq(`${LOOPBACK}/api/context/health`));
    expect(res.status).toBe(401);
  });

  it("GET /api/context/health returns source health for operators", async () => {
    const { GET } = await import("../context/health/route");
    const res = await GET(asReq(`${LOOPBACK}/api/context/health`));
    expect(res.status).toBe(200);
  });

  it("GET /api/audit-log requires session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../audit-log/route");
    const res = await GET(asReq(`${LOOPBACK}/api/audit-log`));
    expect(res.status).toBe(401);
  });

  it("GET /api/audit-log returns entries for operators", async () => {
    const { GET } = await import("../audit-log/route");
    const res = await GET(asReq(`${LOOPBACK}/api/audit-log?limit=5`));
    expect(res.status).toBe(200);
  });

  it("GET /api/observe/health returns harness catalog", async () => {
    const { GET } = await import("../observe/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; harnesses: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.harnesses)).toBe(true);
  });

  it("GET /api/flow/topology assembles workflow map", async () => {
    const { GET } = await import("../flow/topology/route");
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("GET /api/memory/search rejects missing query", async () => {
    const { GET } = await import("../memory/search/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory/search`));
    expect([400, 502]).toContain(res.status);
  });

  it("GET /api/memory returns aggregated sources", async () => {
    const { GET } = await import("../memory/route");
    const nextUrl = new URL(`${LOOPBACK}/api/memory?source=claude`);
    const res = await GET({ nextUrl, url: nextUrl.toString() } as NextRequest);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { claude: unknown; timestamp: string };
    expect(body.claude).toBeTruthy();
    expect(body.timestamp).toBeTruthy();
  });

  it("GET /api/tools/providers lists provider catalog", async () => {
    const { GET } = await import("../tools/providers/route");
    const res = await GET(asReq(`${LOOPBACK}/api/tools/providers`));
    expect(res.status).toBe(200);
  });

  it("GET /api/tools/usage requires auth", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../tools/usage/route");
    const res = await GET(asReq(`${LOOPBACK}/api/tools/usage`));
    expect([401, 403]).toContain(res.status);
  });

  it("GET /api/tools/connections requires auth", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../tools/connections/route");
    const res = await GET(asReq(`${LOOPBACK}/api/tools/connections`));
    expect([401, 403]).toContain(res.status);
  });

  it("GET /api/model-usage rejects unauthenticated callers", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../model-usage/route");
    const res = await GET(asReq(`${LOOPBACK}/api/model-usage`));
    expect([401, 403, 500]).toContain(res.status);
  });

  it("GET /api/security/capabilities returns capability map", async () => {
    const { GET } = await import("../security/capabilities/route");
    const res = await GET(asReq(`${LOOPBACK}/api/security/capabilities`));
    expect(res.status).toBe(200);
  });

  it("GET /api/seal/audit requires session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../seal/audit/route");
    const res = await GET(asReq(`${LOOPBACK}/api/seal/audit`));
    expect(res.status).toBe(401);
  });

  it("GET /api/memory-lifecycle/audit verifies chain", async () => {
    const { GET } = await import("../memory-lifecycle/audit/route");
    const res = await GET(new Request(`${LOOPBACK}/api/memory-lifecycle/audit`));
    expect(res.status).toBe(200);
  });

  it("POST /api/memory-lifecycle/expiry requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../memory-lifecycle/expiry/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/memory-lifecycle/expiry`, { method: "POST", body: "{}" })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/dsar/export rejects unauthenticated callers", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { POST } = await import("../dsar/export/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/dsar/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "u1" }),
      })
    );
    expect([401, 403]).toContain(res.status);
  });

  it("POST /api/dsar/delete rejects unauthenticated callers", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { POST } = await import("../dsar/delete/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/dsar/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "u1" }),
      })
    );
    expect([401, 403]).toContain(res.status);
  });

  it("GET /api/gsd/standup requires agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { GET } = await import("../gsd/standup/route");
    const res = await GET(asReq(`${LOOPBACK}/api/gsd/standup`));
    expect(res.status).toBe(401);
  });

  it("GET /api/gsd/resume requires agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { GET } = await import("../gsd/resume/route");
    const res = await GET(asReq(`${LOOPBACK}/api/gsd/resume`));
    expect(res.status).toBe(401);
  });

  it("POST /api/gsd/shipcheck validates JSON on loopback", async () => {
    const { POST } = await import("../gsd/shipcheck/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/gsd/shipcheck`, {
        method: "POST",
        body: "{",
      })
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("POST /api/gsd/discuss requires agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { POST } = await import("../gsd/discuss/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/gsd/discuss`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hi" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/workspace/prompt requires agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { GET } = await import("../workspace/prompt/route");
    const res = await GET(new Request(`${LOOPBACK}/api/workspace/prompt`));
    expect(res.status).toBe(401);
  });

  it("GET /api/shared-space requires agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { GET } = await import("../shared-space/route");
    const res = await GET(new Request(`${LOOPBACK}/api/shared-space?spaceId=s1`));
    expect(res.status).toBe(401);
  });

  it("GET /api/space-cache requires agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { GET } = await import("../space-cache/route");
    const res = await GET(new Request(`${LOOPBACK}/api/space-cache?spaceId=s1`));
    expect(res.status).toBe(401);
  });

  it("GET /api/space-cache/history requires agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { GET } = await import("../space-cache/history/route");
    const res = await GET(new Request(`${LOOPBACK}/api/space-cache/history?spaceId=s1`));
    expect(res.status).toBe(401);
  });

  it("GET /api/shared-space/history requires agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { GET } = await import("../shared-space/history/route");
    const res = await GET(new Request(`${LOOPBACK}/api/shared-space/history?spaceId=s1`));
    expect(res.status).toBe(401);
  });

  it("POST /api/space-cache/invalidate requires agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { POST } = await import("../space-cache/invalidate/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/space-cache/invalidate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId: "s1" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/write-rules/resolve requires agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { POST } = await import("../write-rules/resolve/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/write-rules/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId: "s1", dataType: "note" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/library/freshness requires user session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../library/freshness/route");
    const res = await GET(new Request(`${LOOPBACK}/api/library/freshness`));
    expect(res.status).toBe(401);
  });

  it("GET /api/agent-checkpoints/metrics requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { GET } = await import("../agent-checkpoints/metrics/route");
    const res = await GET(new Request(`${LOOPBACK}/api/agent-checkpoints/metrics`));
    expect(res.status).toBe(403);
  });

  it("GET /api/agent-checkpoints/metrics returns metrics envelope", async () => {
    const { GET } = await import("../agent-checkpoints/metrics/route");
    const res = await GET(new Request(`${LOOPBACK}/api/agent-checkpoints/metrics`));
    expect(res.status).toBe(200);
  });

  it("POST /api/a2a/agents/register requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../a2a/agents/register/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/a2a/agents/register`, {
        method: "POST",
        body: JSON.stringify({ cardUrl: "https://example.com/card" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/agent-memory/handoff requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../agent-memory/handoff/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/agent-memory/handoff`, { method: "POST", body: "{}" })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/l3/poll requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../l3/poll/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/l3/poll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/activity returns event feed", async () => {
    const { GET } = await import("../activity/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(Array.isArray(body.events)).toBe(true);
  });

  it("GET /api/cache/stats returns metric envelopes", async () => {
    const { GET } = await import("../cache/stats/route");
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("GET /api/security/report returns summary", async () => {
    const { GET } = await import("../security/report/route");
    const res = await GET(new Request(`${LOOPBACK}/api/security/report`));
    expect(res.status).toBe(200);
  });

  it("GET /api/operations/noc returns operator envelope", async () => {
    const { GET } = await import("../operations/noc/route");
    const res = await GET(new Request(`${LOOPBACK}/api/operations/noc`));
    expect(res.status).toBe(200);
  });

  it("POST /api/operations/telemetry requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../operations/telemetry/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/operations/telemetry`, {
        method: "POST",
        body: JSON.stringify({ messages: [] }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/wiki status view returns root existence", async () => {
    const { GET } = await import("../wiki/route");
    const res = await GET(new Request(`${LOOPBACK}/api/wiki?view=status`));
    expect(res.status).toBe(200);
  });

  it("GET /api/skills lists skill inventory", async () => {
    const { GET } = await import("../skills/route");
    const res = await GET(new Request(`${LOOPBACK}/api/skills?limit=5`));
    expect(res.status).toBe(200);
  });

  it("GET /api/model-routing/recommendations returns ranked models", async () => {
    const { GET } = await import("../model-routing/recommendations/route");
    const res = await GET(
      new Request(`${LOOPBACK}/api/model-routing/recommendations?taskType=engineering`)
    );
    expect(res.status).toBe(200);
  });

  it("GET /api/paperclip/budget rejects unconfigured budget backend", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../paperclip/budget/route");
    const res = await GET(new Request(`${LOOPBACK}/api/paperclip/budget`));
    expect([401, 403, 503]).toContain(res.status);
  });

  it("GET /api/public/v1/runs/:runId requires API key", async () => {
    const { GET } = await import("../public/v1/runs/[runId]/route");
    const res = await GET(
      new Request(`${LOOPBACK}/api/public/v1/runs/run-1`),
      { params: Promise.resolve({ runId: "run-1" }) }
    );
    expect([401, 403, 404]).toContain(res.status);
  });

  it("POST /api/tool-attention/record rejects unauthenticated agents", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { POST } = await import("../tool-attention/record/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/tool-attention/record`, {
        method: "POST",
        body: JSON.stringify({ toolId: "t", outcome: "ok" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/auth/register rejects invalid JSON", async () => {
    const { POST } = await import("../auth/register/route");
    const res = await POST(
      asReq(`${LOOPBACK}/api/auth/register`, { method: "POST", body: "not-json" })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/auth/refresh rejects missing refresh cookie", async () => {
    const { POST } = await import("../auth/refresh/route");
    const res = await POST(
      asReq(`${LOOPBACK}/api/auth/refresh`, { method: "POST", body: "not-json" })
    );
    expect([400, 401]).toContain(res.status);
  });

  it("GET /api/agents/versions requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { GET } = await import("../agents/versions/route");
    const res = await GET(new Request(`${LOOPBACK}/api/agents/versions?agentId=a1`));
    expect(res.status).toBe(403);
  });

  it("GET /api/evidence/task-bundles requires taskId", async () => {
    const { GET } = await import("../evidence/task-bundles/route");
    const res = await GET(new Request(`${LOOPBACK}/api/evidence/task-bundles`));
    expect(res.status).toBe(400);
  });

  it("POST /api/evals/run requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../evals/run/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/evals/run`, {
        method: "POST",
        body: JSON.stringify({ trace: {} }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/internal/connector-search requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { GET } = await import("../internal/connector-search/route");
    const res = await GET(new Request(`${LOOPBACK}/api/internal/connector-search?q=test`));
    expect(res.status).toBe(403);
  });

  it("POST /api/native-memory/ingest requires operator auth", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { POST } = await import("../native-memory/ingest/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/native-memory/ingest`, { method: "POST", body: "{}" })
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it("POST /api/onboarding/register rejects malformed token body", async () => {
    const { POST } = await import("../onboarding/register/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/onboarding/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "bad" }),
      })
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("POST /api/meeting/join validates payload", async () => {
    const { POST } = await import("../meeting/join/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/meeting/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("POST /api/memory/policy-lab requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../memory/policy-lab/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/memory/policy-lab`, { method: "POST", body: "{}" })
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/memory/graph rejects missing seed parameters", async () => {
    const { GET } = await import("../memory/graph/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory/graph`));
    expect([400, 502]).toContain(res.status);
  });

  it("POST /api/skills/report requires agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { POST } = await import("../skills/report/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/skills/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skillName: "s", action: "observed" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/seal/proposals/:id requires session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../seal/proposals/[id]/route");
    const res = await GET(new Request(`${LOOPBACK}/api/seal/proposals/p1`), {
      params: Promise.resolve({ id: "p1" }),
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/seal/jobs/:id/evidence requires session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../seal/jobs/[id]/evidence/route");
    const res = await GET(new Request(`${LOOPBACK}/api/seal/jobs/j1/evidence`), {
      params: Promise.resolve({ id: "j1" }),
    });
    expect([401, 404]).toContain(res.status);
  });

  it("POST /api/orchestration/hil/:id validates decision payload", async () => {
    const { POST } = await import("../orchestration/hil/[id]/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/orchestration/hil/h1`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      }),
      { params: Promise.resolve({ id: "h1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("PATCH /api/orchestration/hil/:id/edit requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { PATCH } = await import("../orchestration/hil/[id]/edit/route");
    const res = await PATCH(
      new Request(`${LOOPBACK}/api/orchestration/hil/h1/edit`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patch: {} }),
      }),
      { params: Promise.resolve({ id: "h1" }) }
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/orchestration/runs/:id/resume requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../orchestration/runs/[id]/resume/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/orchestration/runs/r1/resume`, { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/orchestration/runs/:id/rollback requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../orchestration/runs/[id]/rollback/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/orchestration/runs/r1/rollback`, { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: "r1" }) }
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/belief/review/:id/resolve requires reviewer session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { POST } = await import("../belief/review/[id]/resolve/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/belief/review/b1/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolution: "accept" }),
      }),
      { params: Promise.resolve({ id: "b1" }) }
    );
    expect([401, 403]).toContain(res.status);
  });

  it("POST /api/escalations/:id/resolve requires reviewer session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { POST } = await import("../escalations/[id]/resolve/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/escalations/e1/resolve`, {
        method: "POST",
        body: JSON.stringify({ resolution: "done" }),
      }),
      { params: Promise.resolve({ id: "e1" }) }
    );
    expect([401, 403]).toContain(res.status);
  });

  it("POST /api/agents/versions/rollback requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../agents/versions/rollback/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/agents/versions/rollback`, {
        method: "POST",
        body: JSON.stringify({ agentId: "a1", version: "v1" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/agent-memory/capture requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../agent-memory/capture/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/agent-memory/capture`, { method: "POST", body: "{}" })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/artifact-gate/save requires agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { POST } = await import("../artifact-gate/save/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/artifact-gate/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId: "s", artifactName: "a", artifactType: "t" }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/chatgpt/actions/fetch on loopback validates url field", async () => {
    const { POST } = await import("../chatgpt/actions/fetch/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/chatgpt/actions/fetch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/chatgpt/actions/save on loopback validates required fields", async () => {
    const { POST } = await import("../chatgpt/actions/save/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/chatgpt/actions/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/memory-lifecycle/consolidation requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../memory-lifecycle/consolidation/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/memory-lifecycle/consolidation`, { method: "POST", body: "{}" })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/memory-lifecycle/dsar requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../memory-lifecycle/dsar/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/memory-lifecycle/dsar`, { method: "POST", body: "{}" })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/memory-lifecycle/legal-holds requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../memory-lifecycle/legal-holds/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/memory-lifecycle/legal-holds`, {
        method: "POST",
        body: JSON.stringify({ action: "create" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/memory-lifecycle/offboarding requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../memory-lifecycle/offboarding/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/memory-lifecycle/offboarding`, { method: "POST", body: "{}" })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/memory-lifecycle/retention requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../memory-lifecycle/retention/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/memory-lifecycle/retention`, { method: "POST", body: "{}" })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/memory-lifecycle/vault requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../memory-lifecycle/vault/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/memory-lifecycle/vault`, { method: "POST", body: "{}" })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/model-routing/telemetry requires registry write", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../model-routing/telemetry/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/model-routing/telemetry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskType: "t", provider: "p", model: "m" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/model-routing/telemetry lists routing events", async () => {
    const { GET } = await import("../model-routing/telemetry/route");
    const res = await GET(asReq(`${LOOPBACK}/api/model-routing/telemetry?limit=5`));
    expect(res.status).toBe(200);
  });

  it("POST /api/tools/connect/oauth validates provider on loopback", async () => {
    const { POST } = await import("../tools/connect/oauth/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/tools/connect/oauth`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("GET /api/users/:userId/api-keys requires matching session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../users/[userId]/api-keys/route");
    const res = await GET(new Request(`${LOOPBACK}/api/users/u1/api-keys`), {
      params: Promise.resolve({ userId: "u1" }),
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/wiki/digest requires registry write on public host", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { GET } = await import("../wiki/digest/route");
    const res = await GET(new Request("https://memroos.example.com/api/wiki/digest"));
    expect(res.status).toBe(403);
  });

  it("GET /api/skills/quarantine lists quarantined skills", async () => {
    const { GET } = await import("../skills/quarantine/route");
    const res = await GET(new Request(`${LOOPBACK}/api/skills/quarantine?limit=5`));
    expect(res.status).toBe(200);
  });

  it("GET /api/evals/config requires registry write for POST", async () => {
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../evals/config/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/evals/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/audit/export streams ndjson for operators", async () => {
    const { GET } = await import("../audit/export/route");
    const res = await GET(asReq(`${LOOPBACK}/api/audit/export?format=ndjson`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("ndjson");
  });

  it("POST /api/onboarding/invite rejects non-operator without registry write", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(reviewerSession);
    mockAuthorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../onboarding/invite/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/onboarding/invite`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "agent-x" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/gsd/model-route requires agent headers", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { GET } = await import("../gsd/model-route/route");
    const res = await GET(new Request(`${LOOPBACK}/api/gsd/model-route`));
    expect(res.status).toBe(401);
  });

  it("POST /api/gsd/model-route routes tasks for authenticated agents", async () => {
    const { POST } = await import("../gsd/model-route/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/gsd/model-route`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-id": "agent-1" },
        body: JSON.stringify({ taskClass: "hard_reasoning" }),
      })
    );
    expect(res.status).toBe(200);
  });

  it("POST /api/agent-context/messages/:id/ack requires agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { POST } = await import("../agent-context/messages/[id]/ack/route");
    const res = await POST(
      asReq(`${LOOPBACK}/api/agent-context/messages/m1/ack`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "m1" }) }
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/agent-context requires goal_id", async () => {
    const { GET } = await import("../agent-context/route");
    const res = await GET(
      asReq(`${LOOPBACK}/api/agent-context`, { headers: { "x-agent-id": "agent-1" } })
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/l3/events returns adapter events feed", async () => {
    const { GET } = await import("../l3/events/route");
    const res = await GET(asReq(`${LOOPBACK}/api/l3/events?limit=5`));
    expect(res.status).toBe(200);
  });

});
