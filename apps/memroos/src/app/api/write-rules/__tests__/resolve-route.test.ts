// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { createSpace } from "@/lib/space";
import { createWriteRule } from "@/lib/write-rules";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: vi.fn(() => ({ id: "agent-1" })),
}));

const { POST } = await import("../resolve/route");

describe("POST /api/write-rules/resolve", () => {
  let spaceId: string;
  let caseId = 0;

  beforeEach(() => {
    caseId += 1;
    const space = createSpace(testDb, { tenantId: "default-tenant", name: `resolve-space-${caseId}` });
    spaceId = space.id;
    createWriteRule(testDb, {
      spaceId,
      dataType: "decision_intent",
      targetDocument: "decisions.md",
      actorId: "agent-1",
    });
  });

  it("returns 401 when unauthorized", async () => {
    const { authenticateAgentHeaders } = await import("@/lib/agent-registry");
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const req = new Request("http://localhost/api/write-rules/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceId, dataType: "decision_intent" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("resolves target document for dataType", async () => {
    const req = new Request("http://localhost/api/write-rules/resolve", {
      method: "POST",
      headers: { authorization: "Bearer k", "Content-Type": "application/json" },
      body: JSON.stringify({ spaceId, dataType: "decision_intent" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.targetDocument).toBe("decisions.md");
  });

  it("returns 400 when spaceId or dataType missing", async () => {
    const req = new Request("http://localhost/api/write-rules/resolve", {
      method: "POST",
      headers: { authorization: "Bearer k", "Content-Type": "application/json" },
      body: JSON.stringify({ spaceId }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });
});
