// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { registerAgent } from "@/lib/agent-registry";
import { createSpace } from "@/lib/space";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateUser = vi.fn();
const mockAuthenticateAgent = vi.fn();
const mockAuthorizeRegistryWrite = vi.fn();
const mockEmbedText = vi.fn();

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

vi.mock("@/lib/knowledge-collections", () => ({
  loadCollections: vi.fn(() => [
    { name: "docs", category: "internal" as const, path: "/tmp/docs" },
  ]),
  resolveCollectionPaths: vi.fn(() => ["/tmp/docs"]),
  scanConfiguredCollection: vi.fn(async () => ({
    docCount: 2,
    lastUpdated: new Date("2026-01-01T00:00:00.000Z"),
  })),
  collectCollectionFiles: vi.fn(async () => []),
}));

vi.mock("@/lib/embeddings/provider", () => ({
  embedText: (...args: unknown[]) => mockEmbedText(...args),
}));

vi.mock("@/lib/memory/backends", () => ({
  checkGraphHealth: vi.fn(async () => ({ status: "not_configured", backend: "neo4j" })),
  mem0HealthTimeoutMs: () => 1000,
  searchVectorMemory: vi.fn(async () => []),
}));

const LOOPBACK = "http://localhost";

const operatorSession = {
  userId: "op-1",
  role: "operator" as const,
  email: "op@example.com",
  displayName: "Operator",
  tenantId: "default-tenant",
};

const reviewerSession = { ...operatorSession, role: "reviewer" as const };
const adminSession = { ...operatorSession, role: "admin" as const };

function asReq(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

function jsonPost(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("long-tail batch13c — API routes", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockAuthenticateAgent.mockReset();
    mockAuthorizeRegistryWrite.mockReset();
    mockEmbedText.mockReset();
    mockAuthenticateUser.mockResolvedValue(operatorSession);
    mockAuthenticateAgent.mockReturnValue({ id: "agent-1", name: "Agent" });
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    mockEmbedText.mockResolvedValue({ degraded: false, embedding: [0.1, 0.2] });
    delete process.env.MEMROOS_OPERATOR_API_KEY;
    delete process.env.MEMROOS_AGENT_API_KEY;
    vi.unstubAllEnvs();
  });

  it("GET /api/health returns service array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      }))
    );
    const { GET } = await import("../health/route");
    const body = await (await GET()).json();
    expect(Array.isArray(body.services)).toBe(true);
    expect(body.timestamp).toEqual(expect.any(String));
  });

  it("GET /api/knowledge returns collection metrics", async () => {
    const { GET } = await import("../knowledge/route");
    const body = await (await GET()).json();
    expect(body.collections.length).toBeGreaterThan(0);
    expect(body.collections[0].metric.status).toBeDefined();
  });

  it("GET /api/time-series rejects invalid metric", async () => {
    const { GET } = await import("../time-series/route");
    const res = await GET(asReq(`${LOOPBACK}/api/time-series?metric=nope&window=day`));
    expect(res.status).toBe(400);
  });

  it("GET /api/time-series rejects invalid window", async () => {
    const { GET } = await import("../time-series/route");
    const res = await GET(asReq(`${LOOPBACK}/api/time-series?metric=recall_queries&window=year`));
    expect(res.status).toBe(400);
  });

  it("GET /api/time-series returns recall_queries points", async () => {
    const { GET } = await import("../time-series/route");
    const body = await (
      await GET(asReq(`${LOOPBACK}/api/time-series?metric=recall_queries&window=day`))
    ).json();
    expect(body.metric).toBe("recall_queries");
    expect(Array.isArray(body.points)).toBe(true);
  });

  it("GET /api/time-series returns docs_ingested points", async () => {
    const { GET } = await import("../time-series/route");
    const res = await GET(asReq(`${LOOPBACK}/api/time-series?metric=docs_ingested&window=week`));
    expect(res.status).toBe(200);
  });

  it("GET /api/time-series returns memory_writes points", async () => {
    const { GET } = await import("../time-series/route");
    const res = await GET(asReq(`${LOOPBACK}/api/time-series?metric=memory_writes&window=month`));
    expect(res.status).toBe(200);
  });

  it("GET /api/time-series returns skill_executions jsonl buckets", async () => {
    const { GET } = await import("../time-series/route");
    const res = await GET(asReq(`${LOOPBACK}/api/time-series?metric=skill_executions&window=day`));
    expect(res.status).toBe(200);
  });

  it("GET /api/memory-stats requires authentication", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../memory-stats/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory-stats`));
    expect(res.status).toBe(401);
  });

  it("GET /api/memory-stats returns tier stats for operators", async () => {
    const { GET } = await import("../memory-stats/route");
    const body = await (await GET(asReq(`${LOOPBACK}/api/memory-stats?window=day`))).json();
    expect(body.metrics.pendingUnconsolidated).toBeDefined();
    expect(Array.isArray(body.tierStats)).toBe(true);
  });

  it("GET /api/memory-stats honors workspace filter", async () => {
    const { GET } = await import("../memory-stats/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory-stats?workspace=local`));
    expect(res.status).toBe(200);
  });

  it("GET /api/cron-health lists jobs", async () => {
    const { GET } = await import("../cron-health/route");
    const body = await (await GET()).json();
    expect(body.ok).toBe(true);
    expect(body.summary.total).toBeGreaterThanOrEqual(0);
  });

  it("POST /api/cron-health rejects invalid JSON", async () => {
    const { POST } = await import("../cron-health/route");
    const res = await POST(new Request(`${LOOPBACK}/api/cron-health`, { method: "POST", body: "{" }));
    expect(res.status).toBe(400);
  });

  it("POST /api/cron-health upserts a job on loopback", async () => {
    const { POST } = await import("../cron-health/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/cron-health`, {
        id: `job-${randomUUID()}`,
        name: "Batch13c Job",
        sourceFamily: "memroos",
        schedule: "0 * * * *",
      })
    );
    expect(res.status).toBe(201);
  });

  it("PATCH /api/cron-health requires id and status", async () => {
    const { PATCH } = await import("../cron-health/route");
    const res = await PATCH(jsonPost(`${LOOPBACK}/api/cron-health`, { id: "missing" }));
    expect(res.status).toBe(400);
  });

  it("GET /api/cache/stats exposes hitRate metric envelope", async () => {
    const { GET } = await import("../cache/stats/route");
    const body = await (await GET()).json();
    expect(body.metrics.hitRate.status).toBeDefined();
  });

  it("GET /api/write-rules requires agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { GET } = await import("../write-rules/route");
    const res = await GET(asReq(`${LOOPBACK}/api/write-rules?spaceId=space-1`));
    expect(res.status).toBe(401);
  });

  it("GET /api/write-rules requires spaceId", async () => {
    const { GET } = await import("../write-rules/route");
    const res = await GET(asReq(`${LOOPBACK}/api/write-rules`));
    expect(res.status).toBe(400);
  });

  it("POST /api/write-rules creates a rule", async () => {
    const space = createSpace(testDb, { name: `wr-${randomUUID()}`, tenantId: "default-tenant" });
    const { POST } = await import("../write-rules/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/write-rules`, {
        spaceId: space.id,
        dataType: "note",
        targetDocument: "notes.md",
        agentId: "agent-1",
      }) as unknown as NextRequest
    );
    expect(res.status).toBe(200);
  });

  it("POST /api/write-rules/resolve requires spaceId and dataType", async () => {
    const { POST } = await import("../write-rules/resolve/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/write-rules/resolve`, { spaceId: "only-space" }) as unknown as NextRequest
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/agents/[id] returns 404 for unknown agent", async () => {
    const { GET } = await import("../agents/[id]/route");
    const res = await GET(asReq(`${LOOPBACK}/api/agents/nope`), {
      params: Promise.resolve({ id: "nope" }),
    } as never);
    expect(res.status).toBe(404);
  });

  it("GET /api/agents/[id] returns liveness for registered agent", async () => {
    const id = `agent-${randomUUID()}`;
    registerAgent({
      id,
      name: "Batch Agent",
      role: "worker",
      platform: "claude",
      protocol: "local",
      capabilities: [],
    });
    const { GET } = await import("../agents/[id]/route");
    const body = await (
      await GET(asReq(`${LOOPBACK}/api/agents/${id}`), {
        params: Promise.resolve({ id }),
      } as never)
    ).json();
    expect(body.agent.id).toBe(id);
    expect(body.liveness.heartbeat.status).toBeDefined();
  });

  it("POST /api/classification/reviews/[reviewId]/decision requires auth", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { POST } = await import("../classification/reviews/[reviewId]/decision/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/classification/reviews/r1/decision`, { decision: "approve" }) as unknown as NextRequest,
      { params: Promise.resolve({ reviewId: "r1" }) }
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/classification/reviews/[reviewId]/decision validates decision enum", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(reviewerSession);
    const { POST } = await import("../classification/reviews/[reviewId]/decision/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/classification/reviews/r1/decision`, { decision: "maybe" }) as unknown as NextRequest,
      { params: Promise.resolve({ reviewId: "r1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/skills/quarantine/approve rejects invalid skill_id", async () => {
    const { POST } = await import("../skills/quarantine/approve/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/skills/quarantine/approve`, { skill_id: "nope", operator: "ops" })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/skills/quarantine/approve requires operator string", async () => {
    const { POST } = await import("../skills/quarantine/approve/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/skills/quarantine/approve`, { skill_id: 1, operator: "  " })
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/tools/connect/api-key requires session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { POST } = await import("../tools/connect/api-key/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/tools/connect/api-key`, {
        providerKey: "openai",
        credentials: { apiKey: "sk-test" },
      }) as unknown as NextRequest
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/tools/connect/api-key rejects unknown providers", async () => {
    const { POST } = await import("../tools/connect/api-key/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/tools/connect/api-key`, {
        providerKey: "not-a-real-provider-key",
        credentials: { apiKey: "x" },
      }) as unknown as NextRequest
    );
    expect(res.status).toBe(404);
  });

  it("POST /api/skills/sync/check rejects missing roots object", async () => {
    const { POST } = await import("../skills/sync/check/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/skills/sync/check`, {}));
    expect(res.status).toBe(400);
  });

  it("POST /api/skills/sync/check runs scan on temp harness roots", async () => {
    const root = mkdtempSync(path.join(tmpdir(), `sync-route-${randomUUID()}-`));
    mkdirSync(path.join(root, "claude"), { recursive: true });
    writeFileSync(path.join(root, "claude", "demo-skill.md"), "# Demo\n");
    const { POST } = await import("../skills/sync/check/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/skills/sync/check`, {
        roots: { claude: path.join(root, "claude"), codex: root, hermes: root, opencode: root },
      })
    );
    expect(res.status).toBe(200);
    rmSync(root, { recursive: true, force: true });
  });

  it("POST /api/skills/review requires authentication", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { POST } = await import("../skills/review/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/skills/review`, {
        skillName: "demo",
        action: "save-draft",
      }) as unknown as NextRequest
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/skills/review validates skillName and action", async () => {
    const { POST } = await import("../skills/review/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/skills/review`, { action: "save-draft" }) as unknown as NextRequest
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/audit/knowledge rejects missing agent key", async () => {
    const { POST } = await import("../audit/knowledge/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/audit/knowledge`, {
        tenantId: "default-tenant",
        action: "read",
      }) as unknown as NextRequest
    );
    expect([401, 403]).toContain(res.status);
  });

  it("POST /api/policy/knowledge requires action", async () => {
    const { POST } = await import("../policy/knowledge/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/policy/knowledge`, {}) as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it("GET /api/memory/search returns vector tier payload on loopback", async () => {
    const { GET } = await import("../memory/search/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory/search?q=test`));
    expect(res.status).toBe(200);
  });

  it("GET /api/memory/graph returns payload or degraded status", async () => {
    const { GET } = await import("../memory/graph/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory/graph`));
    expect([200, 502]).toContain(res.status);
  });

  it("GET /api/memory/health returns payload or error envelope", async () => {
    const { GET } = await import("../memory/health/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory/health`));
    expect([200, 500]).toContain(res.status);
  });

  it("POST /api/public/v1/traces rejects missing auth", async () => {
    const { POST } = await import("../public/v1/traces/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/public/v1/traces`, { trace: {} }) as unknown as NextRequest
    );
    expect([401, 403]).toContain(res.status);
  });

  it("GET /api/seal/proposals lists queue for operators", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(adminSession);
    const { GET } = await import("../seal/proposals/route");
    const res = await GET(asReq(`${LOOPBACK}/api/seal/proposals`));
    expect(res.status).toBe(200);
  });

  it("GET /api/admin/compliance requires admin", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(operatorSession);
    const { GET } = await import("../admin/compliance/route");
    const res = await GET(asReq(`${LOOPBACK}/api/admin/compliance`));
    expect(res.status).toBe(403);
  });

  it("GET /api/admin/compliance returns report for admin", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(adminSession);
    const { GET } = await import("../admin/compliance/route");
    const res = await GET(asReq(`${LOOPBACK}/api/admin/compliance`));
    expect(res.status).toBe(200);
  });

  it("GET /api/escalations lists open items", async () => {
    const { GET } = await import("../escalations/route");
    const res = await GET(asReq(`${LOOPBACK}/api/escalations`));
    expect(res.status).toBe(200);
  });

  it("GET /api/space-cache requires spaceId", async () => {
    const { GET } = await import("../space-cache/route");
    const res = await GET(asReq(`${LOOPBACK}/api/space-cache`));
    expect(res.status).toBe(400);
  });

  it("GET /api/space-cache returns cache state for a space", async () => {
    const space = createSpace(testDb, { name: `sc-${randomUUID()}`, tenantId: "default-tenant" });
    const { GET } = await import("../space-cache/route");
    const res = await GET(asReq(`${LOOPBACK}/api/space-cache?spaceId=${space.id}`));
    expect(res.status).toBe(200);
  });

  it("GET /api/workspace/prompt returns template metadata", async () => {
    const { GET } = await import("../workspace/prompt/route");
    const res = await GET(asReq(`${LOOPBACK}/api/workspace/prompt`));
    expect(res.status).toBe(200);
  });

  it("POST /api/engagement/test echoes on loopback", async () => {
    const { POST } = await import("../engagement/test/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/engagement/test`, { ping: true }));
    expect(res.status).toBe(200);
  });
});
