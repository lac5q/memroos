// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

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
  requireRole: () => null,
}));

const LOOPBACK = "http://localhost";

function asReq(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(url, init);
}

beforeEach(() => {
  mockAuthenticateUser.mockReset();
  mockAuthenticateUser.mockResolvedValue({
    userId: "admin-b19c",
    role: "admin",
    email: "admin@example.com",
    displayName: "Admin",
    tenantId: "default-tenant",
  });
  vi.resetModules();
});

describe("long-tail batch19c easy routes — wiki, dsar, directives", () => {
  it("GET /api/wiki returns wiki envelope for operators", async () => {
    const { GET } = await import("../wiki/route");
    const res = await GET(asReq(`${LOOPBACK}/api/wiki`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("POST /api/dsar/export rejects missing subject id", async () => {
    const { POST } = await import("../dsar/export/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/dsar/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/dsar/delete rejects missing subject id", async () => {
    const { POST } = await import("../dsar/delete/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/dsar/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/directives/budget returns budget config for admin callers", async () => {
    const { GET } = await import("../directives/budget/route");
    const res = await GET(asReq(`${LOOPBACK}/api/directives/budget?tenant=default-tenant`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.config).toBeDefined();
  });
});

describe("long-tail batch19c easy routes — skills quarantine and agent context", () => {
  it("POST /api/skills/quarantine/reject requires reason", async () => {
    const { POST } = await import("../skills/quarantine/reject/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/skills/quarantine/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skillId: `skill-${randomUUID().slice(0, 6)}` }),
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(400);
  });

  it("GET /api/agent-context/messages returns 401 without agent headers", async () => {
    const { GET } = await import("../agent-context/messages/route");
    const res = await GET(asReq(`${LOOPBACK}/api/agent-context/messages?limit=3`));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
  });

  it("POST /api/policy/knowledge rejects missing action", async () => {
    const { POST } = await import("../policy/knowledge/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/policy/knowledge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metadata: {} }),
      }) as unknown as NextRequest,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/action/i);
  });
});
