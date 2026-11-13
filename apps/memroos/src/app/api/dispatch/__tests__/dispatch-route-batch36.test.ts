// @vitest-environment node
import Database from "better-sqlite3";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateUser = vi.fn();
const mockAuthenticateAgent = vi.fn();
const mockCheckAuthRateLimit = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/auth/session", () => ({
  authenticateUser: (...args: unknown[]) => mockAuthenticateUser(...args),
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgent(...args),
  listRegisteredAgents: vi.fn(() => []),
  getRemoteAgents: vi.fn(() => []),
}));

vi.mock("@/lib/operator-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator-auth")>();
  return { ...actual, authorizeRegistryWrite: vi.fn(() => false) };
});

vi.mock("@/lib/content-scanner", () => ({
  scanContent: vi.fn(() => ({ blocked: false, matches: [], cleanContent: "ok" })),
}));

vi.mock("@/lib/iris-scanner", () => ({
  scanIrisPreflight: vi.fn(() => ({ blocked: false, findings: [], matches: [], cleanContent: "ok" })),
}));

vi.mock("@/lib/security-policy", () => ({
  checkDispatchPolicy: vi.fn(() => ({ allowed: true })),
}));

vi.mock("@/lib/dispatch/adapter-factory", () => ({
  selectAdapter: vi.fn(() => ({
    name: "openclaw",
    dispatch: vi.fn().mockResolvedValue({ accepted: true, mode: "push", detail: "ok" }),
  })),
}));

vi.mock("@/lib/dispatch/skill-lookup", () => ({
  lookupSkillContract: vi.fn(() => null),
}));

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

beforeEach(() => {
  mockAuthenticateUser.mockReset();
  mockAuthenticateAgent.mockReset();
  mockCheckAuthRateLimit.mockReset();
  mockAuthenticateAgent.mockReturnValue({ id: "agent-b36" });
  mockCheckAuthRateLimit.mockReturnValue(null);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/dispatch batch36", () => {
  it("returns 400 when request body is not valid JSON (156)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: "INVALID_BODY" });
  });
});
