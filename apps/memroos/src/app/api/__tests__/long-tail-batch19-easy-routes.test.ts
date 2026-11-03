// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { ToolAuthConfigError, ToolAuthUpstreamError } from "@/lib/tool-auth/nango-client";

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
    authenticateAgentKey: vi.fn(() => false),
    recordToolOutcome: vi.fn(),
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
    { name: "docs", category: "internal" as const, basePath: "docs" },
    { name: "broken", category: "internal" as const, basePath: "missing" },
  ]),
  collectCollectionFiles: vi.fn(async (col: { name: string }) => {
    if (col.name === "broken") throw new Error("scan failed");
    return [{ path: "/tmp/a.md", mtime: new Date("2026-07-02T12:00:00.000Z") }];
  }),
}));

vi.mock("@/lib/tool-auth/credential-store", () => ({
  listVaultConnections: vi.fn(() => [{ providerKey: "slack", authMode: "oauth" as const, status: "connected" }]),
}));

vi.mock("@/lib/tool-auth/nango-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tool-auth/nango-client")>();
  return {
    ...actual,
    listNangoConnections: vi.fn(),
    getNangoUsage: vi.fn(),
  };
});

vi.mock("@/lib/response-cache", () => ({
  DEFAULT_PERFORMANCE_BUDGETS: {},
  performanceBudgetStatus: vi.fn(() => ({
    ok: false,
    routes: [{ route: "/api/wiki", status: "fail" }],
  })),
  responseCache: {
    stats: vi.fn(() => ({ entries: 3, hits: 0, misses: 4 })),
  },
}));

vi.mock("@/lib/tool-attention", () => ({
  appendToolAttentionOutcome: vi.fn(),
}));

const LOOPBACK = "http://localhost";

const operatorSession = {
  userId: "op-1",
  role: "operator" as const,
  email: "op@example.com",
  displayName: "Operator",
  tenantId: "default-tenant",
};

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

beforeEach(() => {
  mockAuthenticateUser.mockReset();
  mockAuthenticateAgent.mockReset();
  mockAuthorizeRegistryWrite.mockReset();
  mockAuthenticateUser.mockResolvedValue(operatorSession);
  mockAuthenticateAgent.mockReturnValue({ id: "agent-1" });
  mockAuthorizeRegistryWrite.mockReturnValue(true);
  delete process.env.MEMROOS_AGENT_API_KEY;
  delete process.env.MEMROOS_AUDIT_ALLOW_REMOTE;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.MEMROOS_AGENT_API_KEY;
  delete process.env.MEMROOS_AUDIT_ALLOW_REMOTE;
});

describe("long-tail batch19 easy routes — audit + hive + cache", () => {
  it("POST /api/audit/knowledge returns 404 for proxied remote callers", async () => {
    const { POST } = await import("../audit/knowledge/route");
    const res = await POST(
      asReq(`${LOOPBACK}/api/audit/knowledge`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer secret",
          "x-forwarded-for": "203.0.113.10",
        },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("POST /api/audit/knowledge ingests with shared MEMROOS_AGENT_API_KEY on loopback", async () => {
    process.env.MEMROOS_AGENT_API_KEY = "batch19-agent-audit-key-32chars!!";
    const { POST } = await import("../audit/knowledge/route");
    const res = await POST(
      asReq(`${LOOPBACK}/api/audit/knowledge`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer batch19-agent-audit-key-32chars!!",
        },
        body: JSON.stringify({
          tenant_id: "default-tenant",
          user_id: null,
          agent_id: "agent-audit",
          operation: "read",
          path: "/vault/docs/readme.md",
          op_hash: "sha256:abcdef0123456789",
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.entryHash).toMatch(/^sha256:/);
  });

  it("GET /api/hive returns lineage envelope for task_id", async () => {
    testDb
      .prepare(
        `INSERT INTO hive_delegations (task_id, from_agent, to_agent, task_summary, priority, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(`task-${randomUUID().slice(0, 8)}`, "agent-a", "agent-b", "summarize", 3, "pending");
    const taskId = testDb.prepare(`SELECT task_id FROM hive_delegations LIMIT 1`).get() as { task_id: string };
    const { GET } = await import("../hive/route");
    const body = await (await GET(asReq(`${LOOPBACK}/api/hive?task_id=${taskId.task_id}`))).json();
    expect(body.task_id).toBe(taskId.task_id);
    expect(Array.isArray(body.actions)).toBe(true);
  });

  it("GET /api/hive rejects invalid delegation status filters", async () => {
    const { GET } = await import("../hive/route");
    const res = await GET(asReq(`${LOOPBACK}/api/hive?type=delegation&status=not-a-status`));
    expect(res.status).toBe(400);
  });

  it("GET /api/hive tolerates malformed FTS queries", async () => {
    const { GET } = await import("../hive/route");
    const body = await (await GET(asReq(`${LOOPBACK}/api/hive?q="unbalanced`))).json();
    expect(body.actions).toEqual([]);
  });

  it("GET /api/cache/stats exposes zero hit-rate and degraded performance metrics", async () => {
    const { GET } = await import("../cache/stats/route");
    const body = await (await GET()).json();
    expect(body.metrics.hitRate.value).toBe(0);
    expect(body.metrics.performanceOk.status).toBe("degraded");
  });
});

describe("long-tail batch19 easy routes — wiki, trends, tools, attention", () => {
  it("GET /api/wiki graph view returns graph payload for a temp wiki root", async () => {
    const wikiRoot = mkdtempSync(path.join(tmpdir(), `wiki-b19-${randomUUID().slice(0, 6)}-`));
    mkdirSync(wikiRoot, { recursive: true });
    writeFileSync(path.join(wikiRoot, "index.md"), "# Home\n\n[[Other]]\n", "utf8");
    writeFileSync(path.join(wikiRoot, "Other.md"), "# Other\n", "utf8");
    const { GET } = await import("../wiki/route");
    const res = await GET(asReq(`${LOOPBACK}/api/wiki?view=graph&knowledgeBasePath=${wikiRoot}`));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.graph).toBeTruthy();
    rmSync(wikiRoot, { recursive: true, force: true });
  });

  it("GET /api/knowledge/trends supports month window and broken collections", async () => {
    const { GET } = await import("../knowledge/trends/route");
    const body = await (await GET(asReq(`${LOOPBACK}/api/knowledge/trends?window=month&limit=2`))).json();
    expect(body.window).toBe("month");
    expect(body.collections.some((c: { name: string }) => c.name === "broken")).toBe(true);
  });

  it("GET /api/tools/connections merges vault + nango and surfaces upstream warnings", async () => {
    const nango = await import("@/lib/tool-auth/nango-client");
    vi.mocked(nango.listNangoConnections).mockRejectedValueOnce(
      new ToolAuthUpstreamError("nango down", 502),
    );
    const { GET } = await import("../tools/connections/route");
    const body = await (await GET(asReq(`${LOOPBACK}/api/tools/connections`))).json();
    expect(body.warnings?.[0]?.source).toBe("nango");
    expect(body.connections.length).toBeGreaterThan(0);
  });

  it("GET /api/tools/connections falls back to vault-only on config errors", async () => {
    const nango = await import("@/lib/tool-auth/nango-client");
    vi.mocked(nango.listNangoConnections).mockRejectedValueOnce(new ToolAuthConfigError("missing nango"));
    const { GET } = await import("../tools/connections/route");
    const body = await (await GET(asReq(`${LOOPBACK}/api/tools/connections`))).json();
    expect(body.connections).toHaveLength(1);
    expect(body.warnings).toBeUndefined();
  });

  it("GET /api/memory/okf/export rejects unsupported sources for operators", async () => {
    const { GET } = await import("../memory/okf/export/route");
    const res = await GET(asReq(`${LOOPBACK}/api/memory/okf/export?source=not-claude`));
    expect(res.status).toBe(400);
  });

  it("POST /api/tool-attention/record hashes sourceContent and strips raw fields", async () => {
    const attention = await import("@/lib/tool-attention");
    const { POST } = await import("../tool-attention/record/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/tool-attention/record`, {
        toolId: "grep",
        outcome: "success",
        metadata: { sourceContent: "needle in haystack" },
      }),
    );
    expect(res.status).toBe(200);
    expect(attention.appendToolAttentionOutcome).toHaveBeenCalled();
    const payload = vi.mocked(attention.appendToolAttentionOutcome).mock.calls.at(-1)?.[0] as {
      metadata: Record<string, unknown>;
    };
    expect(payload.metadata.sourceHash).toMatch(/^sha256:/);
    expect(payload.metadata.sourceContent).toBeUndefined();
  });
});

describe("long-tail batch19 easy routes — audit export + paperclip activity", () => {
  it("GET /api/audit/export streams CSV when format=csv", async () => {
    const id = randomUUID();
    testDb
      .prepare(
        `INSERT INTO audit_entries
          (id, tenant_id, actor_id, actor_role, event_type, entity_type, entity_id, reason, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        "default-tenant",
        "system",
        "system",
        "test.event",
        "test",
        "ent-1",
        "batch19",
        "{}",
        new Date().toISOString(),
      );
    const { GET } = await import("../audit/export/route");
    const res = await GET(asReq(`${LOOPBACK}/api/audit/export?format=csv&tenantId=default-tenant`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text.split("\n")[0]).toContain("id,tenant_id");
    expect(text).toContain(id);
  });

  it("POST /api/paperclip/activity rejects invalid JSON bodies", async () => {
    const { POST } = await import("../paperclip/activity/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/paperclip/activity`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(res.status).toBe(400);
  });
});
