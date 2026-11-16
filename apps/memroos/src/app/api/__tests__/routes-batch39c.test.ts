// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));
const authenticateAgentHeaders = vi.hoisted(() => vi.fn());
const mockAuthenticateUser = vi.hoisted(() => vi.fn());
const mockRequireRole = vi.hoisted(() => vi.fn(() => null as Response | null));
const mockCheckAuthRateLimit = vi.hoisted(() => vi.fn(() => null as Response | null));

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () =>
    Response.json({ ok: false, error: "unauthorized" }, { status: 401 }),
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => authenticateAgentHeaders(...args),
  registerAgent: vi.fn(() => ({ agent: { id: "agent-b39c" }, apiKey: "key-b39c" })),
  recordMemoryWrite: vi.fn(),
  recordToolOutcome: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/auth/middleware-roles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/middleware-roles")>();
  return {
    ...actual,
    requireRole: (...args: unknown[]) => mockRequireRole(...args),
  };
});

vi.mock("@/lib/auth/rate-limit", () => ({
  checkAuthRateLimit: (...args: unknown[]) => mockCheckAuthRateLimit(...args),
}));

vi.mock("@/lib/tool-attention", () => ({
  appendToolAttentionOutcome: vi.fn(),
}));

vi.mock("@/lib/voice/meeting-consent", () => ({
  hasConsent: vi.fn(() => true),
  recordConsent: vi.fn(() => `meet-${randomUUID().slice(0, 8)}`),
}));

vi.mock("@/lib/audit/write", () => ({
  writeAuditEntry: vi.fn(),
}));

const LOOPBACK = "http://localhost";

function badJsonRequest(path: string, method = "POST"): Request {
  return new Request(`${LOOPBACK}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: `{not-json-b39c-${randomUUID().slice(0, 6)}`,
  });
}

beforeEach(() => {
  authorizeRegistryWrite.mockReturnValue(true);
  const agentId = `agent-b39c-${randomUUID().slice(0, 6)}`;
  authenticateAgentHeaders.mockReturnValue({ id: agentId, tenantId: "default-tenant" });
  mockAuthenticateUser.mockResolvedValue({
    userId: `user-b39c-${randomUUID().slice(0, 6)}`,
    tenantId: "default-tenant",
    role: "operator",
    email: "op-b39c@test.local",
  });
  mockRequireRole.mockReturnValue(null);
  mockCheckAuthRateLimit.mockReturnValue(null);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api routes batch39c — auth before json().catch (reachable)", () => {
  it("POST /api/agents/proposals rejects registry write before parsing body (54)", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../agents/proposals/route");
    const res = await POST(badJsonRequest("/api/agents/proposals") as never);
    expect(res.status).toBe(401);
  });

  it("POST /api/memory/proposals rejects registry write before parsing body (68)", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../memory/proposals/route");
    const res = await POST(badJsonRequest("/api/memory/proposals") as never);
    expect(res.status).toBe(401);
  });

  it("POST /api/operations/telemetry rejects registry write before parsing body (20)", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../operations/telemetry/route");
    const res = await POST(badJsonRequest("/api/operations/telemetry") as never);
    expect(res.status).toBe(401);
  });

  it("POST /api/a2a/agents/register rejects registry write before parsing body (18)", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../a2a/agents/register/route");
    const res = await POST(badJsonRequest("/api/a2a/agents/register"));
    expect(res.status).toBe(401);
  });

  it("POST /api/agents/register rejects registry write before parsing body (69)", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const { POST } = await import("../agents/register/route");
    const res = await POST(badJsonRequest("/api/agents/register"));
    expect(res.status).toBe(401);
  });

  it("POST /api/memory/add returns unauthorized for invalid JSON without agent headers (31)", async () => {
    authenticateAgentHeaders.mockReturnValueOnce(null);
    const { POST } = await import("../memory/add/route");
    const res = await POST(badJsonRequest("/api/memory/add"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "Unauthorized" });
  });

  it("POST /api/workspace returns unauthorized when JSON parse falls back before auth (27)", async () => {
    authenticateAgentHeaders.mockReturnValueOnce(null);
    const { POST } = await import("../workspace/route");
    const res = await POST(badJsonRequest("/api/workspace") as never);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "Unauthorized" });
  });

  it("POST /api/tool-attention/record returns unauthorized for invalid JSON without agent (42)", async () => {
    authenticateAgentHeaders.mockReturnValueOnce(null);
    const { POST } = await import("../tool-attention/record/route");
    const res = await POST(badJsonRequest("/api/tool-attention/record"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "Unauthorized" });
  });

  it("POST /api/meeting/join returns 401 before JSON consent branch when session missing (22)", async () => {
    mockAuthenticateUser.mockResolvedValueOnce(null);
    const { POST } = await import("../meeting/join/route");
    const res = await POST(badJsonRequest("/api/meeting/join") as unknown as NextRequest);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "authentication required" });
  });

  it("POST /api/meeting/join returns requireRole response before JSON parse (19)", async () => {
    const forbidden = Response.json({ error: "insufficient permissions" }, { status: 403 });
    mockRequireRole.mockReturnValueOnce(forbidden);
    const { POST } = await import("../meeting/join/route");
    const res = await POST(badJsonRequest("/api/meeting/join") as unknown as NextRequest);
    expect(res).toBe(forbidden);
    expect(res.status).toBe(403);
  });

  it("POST /api/meeting/join maps invalid JSON to consent failure after auth (24)", async () => {
    const { POST } = await import("../meeting/join/route");
    const res = await POST(badJsonRequest("/api/meeting/join") as unknown as NextRequest);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "recording consent required" });
    expect(mockAuthenticateUser).toHaveBeenCalled();
  });
});

describe("api routes batch39c — sticky skips (json().catch already in batch37–38)", () => {
  it.skip("POST /api/agents/proposals invalid JSON — routes-batch37.test.ts (207)", () => {});
  it.skip("POST /api/memory/proposals invalid JSON — routes-batch38.test.ts (237)", () => {});
  it.skip("POST /api/memory/add invalid JSON payload — routes-batch38.test.ts (264)", () => {});
  it.skip("PUT /api/admin/compliance invalid JSON — routes-batch38.test.ts (177); POST not implemented", () => {});
  it.skip("POST /api/operations/telemetry invalid JSON — routes-batch38.test.ts (244)", () => {});
  it.skip("POST /api/tool-attention/record invalid JSON — routes-batch38.test.ts (193)", () => {});
  it.skip("POST /api/a2a/agents/register invalid JSON — routes-batch37.test.ts (143)", () => {});
  it.skip("POST /api/agents/register invalid JSON — routes-batch38.test.ts (223)", () => {});
  it.skip("POST /api/workspace invalid JSON — routes-batch38.test.ts (200)", () => {});
});