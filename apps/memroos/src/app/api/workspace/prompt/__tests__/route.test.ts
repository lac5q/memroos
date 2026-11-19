// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: vi.fn(() => ({ id: "agent-1" })),
}));

const { GET } = await import("../route");

describe("GET /api/workspace/prompt", () => {
  let caseId = 0;

  beforeEach(() => {
    caseId += 1;
    createSpace(testDb, { tenantId: "default-tenant", name: `prompt-space-${caseId}` });
  });

  it("returns 401 when agent auth fails", async () => {
    const { authenticateAgentHeaders } = await import("@/lib/agent-registry");
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const req = new Request("http://localhost/api/workspace/prompt", { method: "GET" });
    const res = await GET(req as never);
    expect(res.status).toBe(401);
  });

  it("returns workspace selection prompt payload", async () => {
    const req = new Request("http://localhost/api/workspace/prompt?actorId=agent-1", {
      method: "GET",
      headers: { authorization: "Bearer k" },
    });
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty("needsSelection");
    expect(Array.isArray(body.availableSpaces)).toBe(true);
  });
});
