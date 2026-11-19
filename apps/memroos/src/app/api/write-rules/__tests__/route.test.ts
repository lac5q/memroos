// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticateAgentHeaders = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticateAgentHeaders(...args),
}));

const { GET, POST } = await import("../route");

const mockAgent = { id: "agent-1", name: "Agent One" };

function authHeaders(): Record<string, string> {
  return { authorization: "Bearer test-key" };
}

describe("/api/write-rules", () => {
  let spaceId: string;
  let caseId = 0;

  beforeEach(() => {
    caseId += 1;
    const space = createSpace(testDb, {
      tenantId: "default-tenant",
      name: `test-space-${caseId}`,
    });
    spaceId = space.id;
    mockAuthenticateAgentHeaders.mockReturnValue(mockAgent as never);
  });

  it("GET returns 401 without agent auth", async () => {
    mockAuthenticateAgentHeaders.mockReturnValueOnce(null);
    const req = new Request(`http://localhost/api/write-rules?spaceId=${spaceId}`, { method: "GET" });
    const res = await GET(req as never);
    expect(res.status).toBe(401);
  });

  it("GET returns 400 when spaceId missing", async () => {
    const req = new Request("http://localhost/api/write-rules", {
      method: "GET",
      headers: authHeaders(),
    });
    const res = await GET(req as never);
    expect(res.status).toBe(400);
  });

  it("GET returns rules for space", async () => {
    const req = new Request(`http://localhost/api/write-rules?spaceId=${spaceId}`, {
      method: "GET",
      headers: authHeaders(),
    });
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.rules)).toBe(true);
  });

  it("POST creates a write rule", async () => {
    const req = new Request("http://localhost/api/write-rules", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        spaceId,
        dataType: "decision_intent",
        targetDocument: "decisions.md",
      }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.rule.dataType).toBe("decision_intent");
    expect(body.rule.version).toBe(1);
  });

  it("POST returns 400 when spaceId missing", async () => {
    const req = new Request("http://localhost/api/write-rules", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ dataType: "x", targetDocument: "y.md" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });
});
