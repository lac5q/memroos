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

const { GET } = await import("../drift/route");

describe("GET /api/write-rules/drift", () => {
  let spaceId: string;
  let caseId = 0;

  beforeEach(() => {
    caseId += 1;
    const space = createSpace(testDb, { tenantId: "default-tenant", name: `drift-space-${caseId}` });
    spaceId = space.id;
    createWriteRule(testDb, {
      spaceId,
      dataType: "lesson",
      targetDocument: "lessons.md",
      actorId: "agent-1",
    });
  });

  it("returns 401 without agent auth", async () => {
    const { authenticateAgentHeaders } = await import("@/lib/agent-registry");
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await GET(new Request(`http://localhost/api/write-rules/drift?spaceId=${spaceId}&agentKnownVersion=1`) as never);
    expect(res.status).toBe(401);
  });

  it("returns 400 when spaceId is missing", async () => {
    const res = await GET(new Request("http://localhost/api/write-rules/drift?agentKnownVersion=1") as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when agentKnownVersion missing", async () => {
    const req = new Request(`http://localhost/api/write-rules/drift?spaceId=${spaceId}`, {
      method: "GET",
      headers: { authorization: "Bearer k" },
    });
    const res = await GET(req as never);
    expect(res.status).toBe(400);
  });

  it("returns 500 when drift check throws", async () => {
    const rules = await import("@/lib/write-rules");
    vi.spyOn(rules, "checkWriteRuleDrift").mockImplementationOnce(() => {
      throw new Error("drift failed");
    });
    const res = await GET(
      new Request(`http://localhost/api/write-rules/drift?spaceId=${spaceId}&agentKnownVersion=1`, {
        method: "GET",
        headers: { authorization: "Bearer k" },
      }) as never
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "drift failed" });
  });

  it("detects drift when agent version is stale", async () => {
    const req = new Request(
      `http://localhost/api/write-rules/drift?spaceId=${spaceId}&agentKnownVersion=0`,
      { method: "GET", headers: { authorization: "Bearer k" } }
    );
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.isStale).toBe(true);
    expect(body.currentVersion).toBeGreaterThan(0);
  });
});
