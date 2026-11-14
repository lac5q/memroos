// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";

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
  vi.resetModules();
});

describe("long-tail batch18b — agent-facing space routes", () => {
  it("GET /api/shared-space/history requires auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { GET } = await import("../shared-space/history/route");
    const res = await GET(asReq(`${LOOPBACK}/api/shared-space/history?spaceId=x&agent=agent-1`));
    expect(res.status).toBe(401);
  });

  it("GET /api/shared-space/history requires spaceId", async () => {
    const { GET } = await import("../shared-space/history/route");
    const res = await GET(asReq(`${LOOPBACK}/api/shared-space/history?agent=agent-1`));
    expect(res.status).toBe(400);
  });

  it("GET /api/shared-space/history returns toggle history", async () => {
    const space = createSpace(testDb, { tenantId: "default-tenant", name: `ss-${randomUUID().slice(0, 6)}` });
    const { GET } = await import("../shared-space/history/route");
    const res = await GET(asReq(`${LOOPBACK}/api/shared-space/history?spaceId=${space.id}&agent=agent-1`));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("GET /api/space-cache requires spaceId", async () => {
    const { GET } = await import("../space-cache/route");
    const res = await GET(asReq(`${LOOPBACK}/api/space-cache?agent=agent-1`));
    expect(res.status).toBe(400);
  });

  it("GET /api/space-cache returns cache state", async () => {
    const space = createSpace(testDb, { tenantId: "default-tenant", name: `sc-${randomUUID().slice(0, 6)}` });
    const { GET } = await import("../space-cache/route");
    const res = await GET(asReq(`${LOOPBACK}/api/space-cache?spaceId=${space.id}&agent=agent-1`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.timestamp).toMatch(/T/);
  });

  it("GET /api/space-cache/history returns invalidation history", async () => {
    const space = createSpace(testDb, { tenantId: "default-tenant", name: `sch-${randomUUID().slice(0, 6)}` });
    const { GET } = await import("../space-cache/history/route");
    const res = await GET(asReq(`${LOOPBACK}/api/space-cache/history?spaceId=${space.id}&agent=agent-1`));
    expect(res.status).toBe(200);
    expect((await res.json()).history).toBeDefined();
  });

  it("GET /api/workspace/prompt returns workspace selection prompt", async () => {
    const { GET } = await import("../workspace/prompt/route");
    const res = await GET(asReq(`${LOOPBACK}/api/workspace/prompt?agent=agent-1`));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("POST /api/write-rules/resolve requires spaceId and dataType", async () => {
    const { POST } = await import("../write-rules/resolve/route");
    const res = await POST(jsonBody(`${LOOPBACK}/api/write-rules/resolve`, { agent: "agent-1" }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it("POST /api/write-rules/resolve returns write target for valid input", async () => {
    const space = createSpace(testDb, { tenantId: "default-tenant", name: `wr-${randomUUID().slice(0, 6)}` });
    const { POST } = await import("../write-rules/resolve/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/write-rules/resolve`, {
        agent: "agent-1",
        spaceId: space.id,
        dataType: "belief_candidate",
      }) as NextRequest,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

describe("long-tail batch18b — artifact gate + cache stats + knowledge", () => {
  it("POST /api/artifact-gate/save validates required fields", async () => {
    const { POST } = await import("../artifact-gate/save/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/artifact-gate/save`, { agent: "agent-1", spaceId: "s" }) as NextRequest,
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/artifact-gate/save treats invalid JSON as empty body and validates fields", async () => {
    const { POST } = await import("../artifact-gate/save/route");
    const req = new Request(`${LOOPBACK}/api/artifact-gate/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("GET /api/cache/stats exposes response cache metrics", async () => {
    const { GET } = await import("../cache/stats/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics.entries.status).toBeTruthy();
    expect(body.metrics.hitRate).toBeTruthy();
  });

  it("GET /api/knowledge returns collection metrics envelope", async () => {
    const { GET } = await import("../knowledge/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.collections)).toBe(true);
    expect(body.metrics.totalCollections).toBeTruthy();
  });
});

describe("long-tail batch18b — audit export + directives diff", () => {
  it("GET /api/audit/export requires operator session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../audit/export/route");
    const res = await GET(asReq(`${LOOPBACK}/api/audit/export`));
    expect(res.status).toBe(401);
  });

  it("GET /api/audit/export streams ndjson by default", async () => {
    const { GET } = await import("../audit/export/route");
    const res = await GET(asReq(`${LOOPBACK}/api/audit/export`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/ndjson/);
    const text = await res.text();
    expect(text.length).toBeGreaterThanOrEqual(0);
  });

  it("GET /api/audit/export supports csv format", async () => {
    const { GET } = await import("../audit/export/route");
    const res = await GET(asReq(`${LOOPBACK}/api/audit/export?format=csv`));
    expect(res.headers.get("Content-Type")).toMatch(/csv/);
    const text = await res.text();
    expect(text.startsWith("id,tenant_id")).toBe(true);
  });

  it("GET /api/directives/diff rejects unauthenticated callers", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../directives/diff/route");
    const res = await GET(new Request(`${LOOPBACK}/api/directives/diff`, { method: "GET" }) as never);
    expect(res.status).toBe(401);
  });

  it("GET /api/directives/diff accepts operator API key via Bearer token", async () => {
    process.env.MEMROOS_OPERATOR_API_KEY = "operator-test-key";
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../directives/diff/route");
    const req = {
      nextUrl: new URL(`${LOOPBACK}/api/directives/diff`),
      headers: new Headers({ authorization: "Bearer operator-test-key" }),
      json: async () => ({ local: "line\n", canonical: "line\n" }),
    } as unknown as NextRequest;
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect((await res.json()).diff.identical).toBe(true);
  });

  it("GET /api/directives/diff returns 400 when JSON body is missing", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(adminSession);
    const { GET } = await import("../directives/diff/route");
    const res = await GET(new NextRequest(`${LOOPBACK}/api/directives/diff`));
    expect(res.status).toBe(400);
  });
});

describe("long-tail batch18b — skills quarantine + library freshness", () => {
  it("GET /api/skills/quarantine rejects invalid stage filter", async () => {
    const { GET } = await import("../skills/quarantine/route");
    const res = await GET(asReq(`${LOOPBACK}/api/skills/quarantine?stage=not-a-stage`));
    expect(res.status).toBe(400);
  });

  it("GET /api/skills/quarantine lists empty queue by default", async () => {
    const { GET } = await import("../skills/quarantine/route");
    const res = await GET(asReq(`${LOOPBACK}/api/skills/quarantine`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.items)).toBe(true);
  });

  it("GET /api/skills/quarantine rejects invalid approval_status", async () => {
    const { GET } = await import("../skills/quarantine/route");
    const res = await GET(asReq(`${LOOPBACK}/api/skills/quarantine?approval_status=maybe`));
    expect(res.status).toBe(400);
  });

  it("POST /api/skills/quarantine rejects non-object JSON bodies", async () => {
    process.env.MEMROOS_OPERATOR_API_KEY = "operator-test-key";
    const { POST } = await import("../skills/quarantine/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/skills/quarantine`, {
        method: "POST",
        headers: {
          authorization: "Bearer operator-test-key",
          "content-type": "application/json",
        },
        body: JSON.stringify("not-an-object"),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/library/freshness requires session", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { GET } = await import("../library/freshness/route");
    const res = await GET(asReq(`${LOOPBACK}/api/library/freshness`));
    expect(res.status).toBe(401);
  });

  it("GET /api/library/freshness returns bounded qmd freshness block", async () => {
    const { GET } = await import("../library/freshness/route");
    const res = await GET(asReq(`${LOOPBACK}/api/library/freshness`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.qmd).toBeTruthy();
    expect(Array.isArray(body.collections)).toBe(true);
  });
});

describe("long-tail batch18b — error branches via mocked helpers", () => {
  it("GET /api/shared-space/history returns 500 when history loader throws", async () => {
    vi.doMock("@/lib/shared-space", () => ({
      getSharedToggleHistory: () => {
        throw new Error("simulated history failure");
      },
    }));
    const { GET } = await import("../shared-space/history/route");
    const space = createSpace(testDb, { tenantId: "default-tenant", name: `err-${randomUUID().slice(0, 6)}` });
    const res = await GET(asReq(`${LOOPBACK}/api/shared-space/history?spaceId=${space.id}&agent=agent-1`));
    expect(res.status).toBe(500);
    vi.doUnmock("@/lib/shared-space");
    vi.resetModules();
  });

  it("GET /api/space-cache returns 500 when cache state throws", async () => {
    vi.doMock("@/lib/space-cache", () => ({
      getCacheState: () => {
        throw new Error("simulated cache failure");
      },
    }));
    const { GET } = await import("../space-cache/route");
    const space = createSpace(testDb, { tenantId: "default-tenant", name: `err2-${randomUUID().slice(0, 6)}` });
    const res = await GET(asReq(`${LOOPBACK}/api/space-cache?spaceId=${space.id}&agent=agent-1`));
    expect(res.status).toBe(500);
    vi.doUnmock("@/lib/space-cache");
    vi.resetModules();
  });

  it("GET /api/workspace/prompt returns 500 when prompt helper throws", async () => {
    vi.doMock("@/lib/workspace", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/workspace")>();
      return {
        ...actual,
        promptWorkspaceSelection: () => {
          throw new Error("simulated prompt failure");
        },
      };
    });
    const { GET } = await import("../workspace/prompt/route");
    const res = await GET(asReq(`${LOOPBACK}/api/workspace/prompt?agent=agent-1`));
    expect(res.status).toBe(500);
    vi.doUnmock("@/lib/workspace");
    vi.resetModules();
  });

  it("POST /api/write-rules/resolve returns 500 on resolver throw", async () => {
    vi.doMock("@/lib/write-rules", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/write-rules")>();
      return {
        ...actual,
        resolveWriteTarget: () => {
          throw new Error("simulated resolver failure");
        },
      };
    });
    const space = createSpace(testDb, { tenantId: "default-tenant", name: `err3-${randomUUID().slice(0, 6)}` });
    const { POST } = await import("../write-rules/resolve/route");
    const res = await POST(
      jsonBody(`${LOOPBACK}/api/write-rules/resolve`, {
        agent: "agent-1",
        spaceId: space.id,
        dataType: "belief_candidate",
      }) as NextRequest,
    );
    expect(res.status).toBe(500);
    vi.doUnmock("@/lib/write-rules");
    vi.resetModules();
  });
});
