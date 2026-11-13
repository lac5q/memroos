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

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgent(...args),
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

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

describe("batch14b — mid-list API route branches", () => {
  beforeEach(() => {
    mockAuthenticateUser.mockReset();
    mockAuthenticateAgent.mockReset();
    mockAuthorizeRegistryWrite.mockReset();
    mockAuthenticateUser.mockResolvedValue(operatorSession);
    mockAuthenticateAgent.mockReturnValue({ id: "agent-1" });
    mockAuthorizeRegistryWrite.mockReturnValue(true);
    delete process.env["MEMROOS_OPERATOR_API_KEY"];
    vi.resetModules();
  });

  it("POST /api/library/qmd-update rejects unauthenticated remote callers", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { POST } = await import("../library/qmd-update/route");
    const res = await POST(
      asReq("https://memroos.example/api/library/qmd-update", { method: "POST" })
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/library/freshness accepts collection query", async () => {
    const { GET } = await import("../library/freshness/route");
    const res = await GET(asReq(`${LOOPBACK}/api/library/freshness?collection=default`));
    expect(res.status).toBe(200);
  });

  it("GET /api/paperclip returns activity envelope", async () => {
    const { GET } = await import("../paperclip/route");
    const res = await GET(asReq(`${LOOPBACK}/api/paperclip`));
    expect(res.status).toBe(200);
  });

  it("POST /api/paperclip/activity rejects invalid JSON", async () => {
    const { POST } = await import("../paperclip/activity/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/paperclip/activity`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{bad",
      }) as unknown as NextRequest
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/agent-context/messages returns a list envelope on loopback", async () => {
    const { GET } = await import("../agent-context/messages/route");
    const res = await GET(asReq(`${LOOPBACK}/api/agent-context/messages?limit=5`));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("PATCH /api/write-rules/[id] rejects missing expectedVersion when authed", async () => {
    const { PATCH } = await import("../write-rules/[id]/route");
    const res = await PATCH(
      jsonPost(`${LOOPBACK}/api/write-rules/1`, { name: "x" }, "PATCH") as unknown as NextRequest,
      { params: Promise.resolve({ id: "1" }) } as never
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/gsd/adapter rejects empty body for authed operator", async () => {
    const { POST } = await import("../gsd/adapter/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/gsd/adapter`, {}) as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it("POST /api/memory-lifecycle/subject-erasure validates subjectHash", async () => {
    const { POST } = await import("../memory-lifecycle/subject-erasure/route");
    const res = await POST(
      jsonPost(`${LOOPBACK}/api/memory-lifecycle/subject-erasure`, {}) as unknown as NextRequest
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/skills/pins honors agent filter query", async () => {
    const { GET } = await import("../skills/pins/route");
    const res = await GET(asReq(`${LOOPBACK}/api/skills/pins?agent=${randomUUID()}&limit=3`));
    expect(res.status).toBe(200);
  });

  it("GET /api/directives/budget returns envelope when operator API key is presented", async () => {
    process.env["MEMROOS_OPERATOR_API_KEY"] = "budget-key";
    const { GET } = await import("../directives/budget/route");
    const res = await GET(
      new NextRequest(`${LOOPBACK}/api/directives/budget?tenant=default-tenant`, {
        headers: { authorization: "Bearer budget-key" },
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("POST /api/tools/connect/api-key rejects missing provider", async () => {
    const { POST } = await import("../tools/connect/api-key/route");
    const res = await POST(jsonPost(`${LOOPBACK}/api/tools/connect/api-key`, {}) as unknown as NextRequest);
    expect(res.status).toBe(400);
  });

  it("GET /api/artifact-gate/auto-readme requires path query", async () => {
    const { GET } = await import("../artifact-gate/auto-readme/route");
    const res = await GET(asReq(`${LOOPBACK}/api/artifact-gate/auto-readme`));
    expect(res.status).toBe(400);
  });
});
