// @vitest-environment node
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateUser = vi.fn();
const mockAuthenticateAgent = vi.fn();
const mockAuthorizeRegistryWrite = vi.fn();
const mockScanContent = vi.fn();
const mockScanIris = vi.fn();
const mockCheckDispatchPolicy = vi.fn();
const mockSelectAdapter = vi.fn();
const mockLookupSkill = vi.fn();
const mockQueryGraph = vi.fn();
const mockCheckVectorHealth = vi.fn();
const mockCheckGraphHealth = vi.fn();
const mockBuildAgentContext = vi.fn();
const mockResolveChatRuntimePlan = vi.fn();
const mockChatRuntimeStatus = vi.fn();
const mockClassifyText = vi.fn();

const registeredAgent = {
  id: "sophia",
  name: "Sophia",
  role: "Marketing",
  platform: "claude",
  protocol: "rest",
  status: "active" as const,
  location: "local",
  host: null,
  port: null,
  healthEndpoint: null,
  currentTask: null,
  lastHeartbeat: null,
  lessonsCount: 0,
  todayMemoryCount: 0,
  isRemote: false,
  latencyMs: null,
  capabilities: [{ id: "cap-1", name: "write", description: "d", tags: [] }],
  metadata: {},
  tunnelUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deregisteredAt: null,
};

const remoteAgent = {
  id: "sophia",
  name: "Sophia Remote",
  role: "Marketing",
  platform: "claude",
  protocol: "a2a",
  location: "remote",
  host: "remote.example",
  port: 443,
  healthEndpoint: "/health",
  tunnelUrl: "https://tunnel.example",
  metadata: {},
  skills: [],
};

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgent(...args),
  listRegisteredAgents: vi.fn(() => [registeredAgent]),
  getRemoteAgents: vi.fn(() => [remoteAgent]),
  recordMemoryWrite: vi.fn(),
}));

vi.mock("@/lib/operator-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator-auth")>();
  return {
    ...actual,
    authorizeRegistryWrite: (...args: unknown[]) => mockAuthorizeRegistryWrite(...args),
  };
});

vi.mock("@/lib/content-scanner", () => ({
  scanContent: (...args: unknown[]) => mockScanContent(...args),
}));

vi.mock("@/lib/iris-scanner", () => ({
  scanIrisPreflight: (...args: unknown[]) => mockScanIris(...args),
}));

vi.mock("@/lib/security-policy", () => ({
  checkDispatchPolicy: (...args: unknown[]) => mockCheckDispatchPolicy(...args),
  checkMemoryWritePolicy: vi.fn(() => ({ allowed: true })),
}));

vi.mock("@/lib/dispatch/adapter-factory", () => ({
  selectAdapter: (...args: unknown[]) => mockSelectAdapter(...args),
}));

vi.mock("@/lib/dispatch/skill-lookup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dispatch/skill-lookup")>();
  return {
    ...actual,
    lookupSkillContract: (...args: unknown[]) => mockLookupSkill(...args),
  };
});

vi.mock("@/lib/skills/skill-sync-governance", () => ({
  getAgentVersionPin: vi.fn(() => null),
}));

vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }));

vi.mock("@/lib/memory/backends", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory/backends")>();
  return {
    ...actual,
    queryGraphMemory: (...args: unknown[]) => mockQueryGraph(...args),
    checkVectorHealth: (...args: unknown[]) => mockCheckVectorHealth(...args),
    checkGraphHealth: (...args: unknown[]) => mockCheckGraphHealth(...args),
  };
});

vi.mock("@/lib/classification/cascade", () => ({
  classifyText: (...args: unknown[]) => mockClassifyText(...args),
}));

vi.mock("@/lib/memory/policy-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory/policy-gate")>();
  return {
    ...actual,
    filterAuthorizedMemoryItems: (_db: unknown, items: unknown[]) => items,
  };
});

vi.mock("@/app/api/chat/chat-runtime", () => ({
  buildAgentContext: (...args: unknown[]) => mockBuildAgentContext(...args),
  resolveChatRuntimePlan: (...args: unknown[]) => mockResolveChatRuntimePlan(...args),
  chatRuntimeStatus: (...args: unknown[]) => mockChatRuntimeStatus(...args),
  resolveChatRuntime: vi.fn(async () => ({ runner: "anthropic", model: "claude", source: "test" })),
  isProviderLimitError: vi.fn(() => false),
  recordChatRuntimeFailure: vi.fn(),
  recordChatRuntimeSuccess: vi.fn(),
}));

const LOOPBACK = "http://localhost";
const SIGNING_KEY = path.join(process.cwd(), "data", "skill-signing-key.json");

function jsonBody(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

beforeEach(() => {
  mockAuthenticateUser.mockReset();
  mockAuthenticateAgent.mockReset();
  mockAuthorizeRegistryWrite.mockReset();
  mockScanContent.mockReset();
  mockScanIris.mockReset();
  mockCheckDispatchPolicy.mockReset();
  mockSelectAdapter.mockReset();
  mockLookupSkill.mockReset();
  mockQueryGraph.mockReset();
  mockCheckVectorHealth.mockReset();
  mockCheckGraphHealth.mockReset();
  mockBuildAgentContext.mockReset();
  mockResolveChatRuntimePlan.mockReset();
  mockChatRuntimeStatus.mockReset();
  mockClassifyText.mockReset();

  mockAuthenticateUser.mockResolvedValue({
    userId: "op-batch20",
    role: "operator",
    email: "op@example.com",
    displayName: "Op",
    tenantId: "default-tenant",
  });
  mockAuthenticateAgent.mockReturnValue({ id: "agent-batch20" });
  mockAuthorizeRegistryWrite.mockReturnValue(true);
  mockScanContent.mockReturnValue({ blocked: false, matches: [], cleanContent: "clean task" });
  mockScanIris.mockReturnValue({ blocked: false, findings: [], matches: [], cleanContent: "clean task" });
  mockCheckDispatchPolicy.mockReturnValue({ allowed: true });
  mockSelectAdapter.mockReturnValue({
    name: "openclaw",
    dispatch: vi.fn().mockResolvedValue({ accepted: true, mode: "push", detail: "ok" }),
  });
  mockLookupSkill.mockReturnValue(null);
  mockQueryGraph.mockResolvedValue({
    results: [
      {
        node: { id: "node-1", label: "Entity" },
        neighbors: [{ id: "n-2", label: "Neighbor" }],
      },
    ],
  });
  mockCheckVectorHealth.mockResolvedValue({ tier: "vector", backend: "mem0", status: "up" });
  mockCheckGraphHealth.mockResolvedValue({ tier: "graph", backend: "neo4j", status: "up" });
  mockBuildAgentContext.mockResolvedValue({ systemPrompt: "You are Sophia." });
  mockResolveChatRuntimePlan.mockResolvedValue({
    primary: { runner: "anthropic", model: "claude-test", source: "env" },
    candidates: [{ runner: "anthropic", model: "claude-test", source: "env" }],
  });
  mockChatRuntimeStatus.mockReturnValue({ status: "ready", detail: "ready" });
  mockClassifyText.mockReturnValue({ requiresReview: false, label: "public" });
  delete process.env.ELEVENLABS_API_KEY;
  vi.resetModules();
});

afterEach(() => {
  if (existsSync(SIGNING_KEY)) unlinkSync(SIGNING_KEY);
  vi.unstubAllGlobals();
});

describe("api routes batch20 — dispatch and engagement", () => {
  it("POST /api/dispatch blocks content scanner matches and gates memory arrays", async () => {
    mockScanContent.mockReturnValueOnce({
      blocked: true,
      matches: [{ patternName: "secret" }],
      cleanContent: "blocked",
    });
    const { POST } = await import("../dispatch/route");
    const blocked = await POST(
      jsonBody(`${LOOPBACK}/api/dispatch`, {
        to_agent: "sophia",
        task_summary: "blocked content",
      }) as NextRequest,
    );
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).code).toBe("CONTENT_BLOCKED");

    mockScanContent.mockReturnValue({ blocked: false, matches: [], cleanContent: "memory task" });
    const ok = await POST(
      jsonBody(`${LOOPBACK}/api/dispatch`, {
        to_agent: "sophia",
        task_summary: "memory task",
        input: { memories: [{ id: "mem-1", text: "hello" }] },
      }) as NextRequest,
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).adapter).toBe("openclaw");
  });

  it("POST /api/engagement/test filters agentIds and reports voice warning without TTS key", async () => {
    const { POST } = await import("../engagement/test/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/engagement/test`, { agentIds: ["sophia"] }) as NextRequest,
    );
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].dispatch.adapter).toBe("openclaw");
    expect(body.results[0].voice.status).toBe("warning");
  });

  it("POST /api/engagement/test returns 500 when chat runtime throws", async () => {
    mockBuildAgentContext.mockRejectedValueOnce(new Error("chat runtime offline"));
    const { POST } = await import("../engagement/test/route");
    const res = await POST(jsonBody(`${LOOPBACK}/api/engagement/test`, {}) as NextRequest);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/chat runtime offline/i);
  });
});

describe("api routes batch20 — health and memory routes", () => {
  it("GET /api/health surfaces mem0 degraded runtime details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/health")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: "degraded",
              vector_store: "connected",
              queue: { queued: 0 },
              memory_runtime: { status: "unavailable", error: "worker down" },
            }),
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    const { GET } = await import("../health/route");
    const body = await (await GET()).json();
    const mem0 = body.services.find((s: { service: string }) => s.service === "mem0");
    expect(mem0?.status).toBe("degraded");
    expect(mem0?.detail).toMatch(/runtime unavailable/i);
  });

  it("POST /api/memory/add stores memory when mem0 accepts payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ id: "mem-123" }),
      })),
    );
    const { POST } = await import("../memory/add/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/memory/add`, {
        agentId: "agent-batch20",
        content: "batch20 memory write",
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("POST /api/memory/add rejects classification review and mem0 failures", async () => {
    mockClassifyText.mockReturnValueOnce({ requiresReview: true, label: "restricted" });
    const { POST } = await import("../memory/add/route");
    const denied = await POST(
      jsonBody(`${LOOPBACK}/api/memory/add`, { content: "needs review" }),
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).code).toBe("CLASSIFICATION_DENIED");

    mockClassifyText.mockReturnValue({ requiresReview: false, label: "public" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const backendFail = await POST(
      jsonBody(`${LOOPBACK}/api/memory/add`, { content: "backend fail" }),
    );
    expect(backendFail.status).toBe(502);
  });

  it("GET /api/memory/health reports stale recall ingest timestamps", async () => {
    testDb.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('last_ingest_ts', 'not-a-date')`).run();
    const { GET } = await import("../memory/health/route");
    const body = await (await GET(asReq(`${LOOPBACK}/api/memory/health`))).json();
    expect(body.recallIngest.status).toBe("stale");
    expect(body.recallIngest.detail).toMatch(/invalid/i);
  });

  it("GET /api/memory/graph filters graph neighbors for authorized items", async () => {
    const { GET } = await import("../memory/graph/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory/graph?q=node&limit=5`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.result.results[0].neighbors).toBeDefined();
  });

  it("GET and POST /api/l3/events list and ingest business outcome events", async () => {
    const correlationId = `corr-${randomUUID().slice(0, 8)}`;
    const { POST, GET } = await import("../l3/events/route");
    const inserted = await POST(
      jsonBody(`${LOOPBACK}/api/l3/events`, {
        correlationId,
        sourceSystem: "crm",
        adapter: "orders",
        eventType: "order.paid",
        kpiKey: "revenue",
        kpiValue: 42,
        polledAt: new Date().toISOString(),
      }) as NextRequest,
    );
    expect(inserted.status).toBe(200);
    expect((await inserted.json()).inserted).toBe(true);

    const listed = await GET(asReq(`${LOOPBACK}/api/l3/events?correlationId=${correlationId}&limit=5`));
    const listBody = await listed.json();
    expect(listBody.count).toBeGreaterThan(0);
    expect(listBody.events[0].correlationId).toBe(correlationId);
  });
});
