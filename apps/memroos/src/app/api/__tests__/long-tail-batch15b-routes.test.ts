// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { createWriteRule } from "@/lib/write-rules";

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

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgent(...args),
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

beforeEach(() => {
  mockAuthenticateUser.mockReset();
  mockAuthenticateAgent.mockReset();
  mockAuthorizeRegistryWrite.mockReset();
  mockAuthenticateUser.mockResolvedValue(operatorSession);
  mockAuthenticateAgent.mockReturnValue({ id: "agent-1" });
  mockAuthorizeRegistryWrite.mockReturnValue(true);
  vi.resetModules();
});

describe("batch15b — API route branches", () => {
  it("POST /api/apo rejects unknown actions", async () => {
    const { POST } = await import("../apo/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/apo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reject", proposalId: "x.md" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  it("PATCH /api/write-rules/[id] requires expectedVersion for authed agents", async () => {
    const space = createSpace(testDb, { tenantId: "default-tenant", name: `space-${randomUUID().slice(0, 8)}` });
    const rule = createWriteRule(testDb, {
      spaceId: space.id,
      dataType: "note",
      targetDocument: "notes.md",
      actorId: "agent-1",
    });
    const { PATCH } = await import("../write-rules/[id]/route");
    const res = await PATCH(
      new Request(`${LOOPBACK}/api/write-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetDocument: "other.md" }),
      }) as unknown as NextRequest,
      { params: Promise.resolve({ id: String(rule.id) }) } as never,
    );
    expect(res.status).toBe(400);
  });

  it("DELETE /api/write-rules/[id] returns 401 without agent auth", async () => {
    mockAuthenticateAgent.mockReturnValueOnce(null);
    const { DELETE } = await import("../write-rules/[id]/route");
    const res = await DELETE(
      new Request(`${LOOPBACK}/api/write-rules/1`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1 }),
      }) as unknown as NextRequest,
      { params: Promise.resolve({ id: "1" }) } as never,
    );
    expect(res.status).toBe(401);
  });

  it("GET /api/apo returns JSON envelope when registry write is authorized", async () => {
    const { GET } = await import("../apo/route");
    const res = await GET(asReq(`${LOOPBACK}/api/apo`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("proposals");
    expect(body).toHaveProperty("stats");
  });
});
