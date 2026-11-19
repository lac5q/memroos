// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { signAccessToken } from "@/lib/auth/jwt";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateUser = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/auth/middleware-roles", () => ({
  requireRole: (role: string | null | undefined, min: string) => {
    const rank: Record<string, number> = { reviewer: 1, operator: 2, admin: 3 };
    if (!role || (rank[role] ?? 0) < (rank[min] ?? 0)) {
      return Response.json({ error: "insufficient permissions" }, { status: 403 });
    }
    return null;
  },
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: () => ({ id: "agent-batch20", name: "Agent" }),
}));

const LOOPBACK = "http://localhost";

beforeEach(() => {
  mockAuthenticateUser.mockReset();
  mockAuthenticateUser.mockResolvedValue({
    userId: "op-batch20",
    role: "operator",
    email: "op@example.com",
    displayName: "Operator",
    tenantId: "default-tenant",
  });
  delete process.env.MEMROOS_OPERATOR_API_KEY;
  delete process.env.MEMROOS_AGENT_API_KEY;
  delete process.env.MEMROOS_JWT_SECRET;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.MEMROOS_OPERATOR_API_KEY;
  delete process.env.MEMROOS_AGENT_API_KEY;
});

describe("long-tail batch20 easy routes — meeting and artifact gate", () => {
  it("POST /api/meeting/join rejects missing consent", async () => {
    const { POST } = await import("../meeting/join/route");
    const res = await POST(
      new NextRequest(`${LOOPBACK}/api/meeting/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomUrl: "https://room", token: "tok" }),
      }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/consent/i);
  });

  it("POST /api/meeting/join rejects empty roomUrl", async () => {
    const { POST } = await import("../meeting/join/route");
    const res = await POST(
      new NextRequest(`${LOOPBACK}/api/meeting/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consentConfirmed: true, roomUrl: "  ", token: "tok" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/artifact-gate/save rejects missing required fields", async () => {
    const { POST } = await import("../artifact-gate/save/route");
    const res = await POST(
      new NextRequest(`${LOOPBACK}/api/artifact-gate/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId: "s1" }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/required/i);
  });
});

describe("long-tail batch20 easy routes — directives diff and native memory", () => {
  it("GET /api/directives/diff returns 401 without session or bearer", async () => {
    mockAuthenticateUser.mockResolvedValue(null);
    const { GET } = await import("../directives/diff/route");
    const res = await GET(new NextRequest(`${LOOPBACK}/api/directives/diff`));
    expect(res.status).toBe(401);
  });

  it("GET /api/directives/diff returns 400 when JSON body missing", async () => {
    mockAuthenticateUser.mockResolvedValue({
      userId: "admin-batch20",
      role: "admin",
      email: "admin@example.com",
      displayName: "Admin",
      tenantId: "default-tenant",
    });
    const { GET } = await import("../directives/diff/route");
    const req = new NextRequest(`${LOOPBACK}/api/directives/diff`);
    const res = await GET(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/JSON body required/i);
  });

  it("POST /api/native-memory/ingest rejects unauthenticated callers", async () => {
    mockAuthenticateUser.mockResolvedValue(null);
    const { POST } = await import("../native-memory/ingest/route");
    const res = await POST(
      new NextRequest(`${LOOPBACK}/api/native-memory/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("long-tail batch20 easy routes — telemetry and tools providers", () => {
  it("POST /api/operations/telemetry rejects invalid JSON body", async () => {
    const { POST } = await import("../operations/telemetry/route");
    const res = await POST(
      new NextRequest(`${LOOPBACK}/api/operations/telemetry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/operations/telemetry ingests trimmed messages on loopback", async () => {
    const { POST } = await import("../operations/telemetry/route");
    const res = await POST(
      new NextRequest(`${LOOPBACK}/api/operations/telemetry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purpose: "batch20",
          messages: [{ content: "  hello telemetry  ", agentId: "codex" }],
          tokenLedgers: [{ modelId: "gpt-test", rawContextTokens: 10, cachedTokens: 0, totalTokens: 10 }],
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.messagesCreated).toBeGreaterThanOrEqual(1);
    expect(body.ledgersCreated).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/tools/providers returns catalog envelope", async () => {
    const { GET } = await import("../tools/providers/route");
    const res = await GET(new NextRequest(`${LOOPBACK}/api/tools/providers`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.categories)).toBe(true);
  });
});

describe("long-tail batch20 easy routes — onboarding register", () => {
  it("POST /api/onboarding/register rejects malformed registration body", async () => {
    const { POST } = await import("../onboarding/register/route");
    const res = await POST(
      new NextRequest(`${LOOPBACK}/api/onboarding/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "signed" }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid onboarding/i);
  });
});
