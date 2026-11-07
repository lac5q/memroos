// @vitest-environment node
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

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
const mockCheckAuthRateLimit = vi.fn();

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
  getRemoteAgents: vi.fn(() => []),
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

vi.mock("@/lib/auth/rate-limit", () => ({
  checkAuthRateLimit: (...args: unknown[]) => mockCheckAuthRateLimit(...args),
}));

vi.mock("@/lib/memory/policy-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory/policy-gate")>();
  return {
    ...actual,
    filterAuthorizedMemoryItems: (
      _db: unknown,
      items: unknown[],
      _actor: unknown,
      _action: string,
      _extract: unknown,
      labeler: (item: unknown, index: number) => string,
    ) => items.map((item, index) => ({ ...(item as object), _label: labeler(item, index) })),
  };
});

const LOOPBACK = "http://localhost";

function jsonBody(body: unknown): NextRequest {
  return new Request(`${LOOPBACK}/api/dispatch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
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
  mockCheckAuthRateLimit.mockReset();

  mockAuthenticateAgent.mockReturnValue({ id: `agent-${randomUUID()}` });
  mockAuthorizeRegistryWrite.mockReturnValue(false);
  mockScanContent.mockReturnValue({ blocked: false, matches: [], cleanContent: "clean batch30" });
  mockScanIris.mockReturnValue({ blocked: false, findings: [], matches: [], cleanContent: "clean batch30" });
  mockCheckDispatchPolicy.mockReturnValue({ allowed: true });
  mockSelectAdapter.mockReturnValue({
    name: "openclaw",
    dispatch: vi.fn().mockResolvedValue({ accepted: true, mode: "push", detail: "ok" }),
  });
  mockLookupSkill.mockReturnValue(null);
  mockCheckAuthRateLimit.mockReturnValue(null);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/dispatch batch30", () => {
  it("falls back to agent auth when session lookup throws (58)", async () => {
    mockAuthenticateUser.mockRejectedValue(new Error("session store down"));
    const { POST } = await import("../route");
    const res = await POST(
      jsonBody({
        to_agent: "sophia",
        task_summary: "agent dispatch batch30",
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).adapter).toBe("openclaw");
  });

  it("labels memory array items without ids by index (147)", async () => {
    mockAuthenticateUser.mockResolvedValue({
      userId: "op-b30",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    const dispatchSpy = vi.fn().mockResolvedValue({ accepted: true, mode: "push", detail: "ok" });
    mockSelectAdapter.mockReturnValue({ name: "openclaw", dispatch: dispatchSpy });
    const { POST } = await import("../route");
    const res = await POST(
      jsonBody({
        to_agent: "sophia",
        task_summary: "memory index batch30",
        input: { memories: [{ text: "no id here" }] },
      }),
    );
    expect(res.status).toBe(200);
    const task = dispatchSpy.mock.calls[0]?.[0] as { input?: { memories?: Array<{ _label?: string }> } };
    expect(task.input?.memories?.[0]?._label).toBe("dispatch:memories:0");
  });

  it("returns rate limit response when checkAuthRateLimit fires (156)", async () => {
    mockCheckAuthRateLimit.mockReturnValue(
      Response.json({ ok: false, error: "rate limited batch30" }, { status: 429 }),
    );
    mockAuthenticateUser.mockResolvedValue({
      userId: "op-b30",
      role: "operator",
      email: "op@example.com",
      displayName: "Op",
      tenantId: "default-tenant",
    });
    const { POST } = await import("../route");
    const res = await POST(
      jsonBody({
        to_agent: "sophia",
        task_summary: "throttled",
      }),
    );
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/rate limited batch30/);
  });
});
