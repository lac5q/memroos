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

const { GET, POST } = await import("../route");
const { authenticateAgentHeaders } = await import("@/lib/agent-registry");

describe("/api/artifact-gate/auto-readme", () => {
  let spaceId = "";

  beforeEach(() => {
    vi.mocked(authenticateAgentHeaders).mockReturnValue({ id: "agent-1" } as never);
    spaceId = createSpace(testDb, { tenantId: "default-tenant", name: `readme-${Date.now()}` }).id;
  });

  it("GET returns enabled flag", async () => {
    const res = await GET(new Request(`http://localhost/api/artifact-gate/auto-readme?spaceId=${spaceId}`) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.enabled).toBe("boolean");
  });

  it("POST requires enabled boolean", async () => {
    const res = await POST(
      new Request("http://localhost/api/artifact-gate/auto-readme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId }),
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("POST toggles auto readme updates", async () => {
    const res = await POST(
      new Request("http://localhost/api/artifact-gate/auto-readme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, enabled: true }),
      }) as never
    );
    expect(res.status).toBe(200);
    expect((await res.json()).enabled).toBe(true);
  });
});
