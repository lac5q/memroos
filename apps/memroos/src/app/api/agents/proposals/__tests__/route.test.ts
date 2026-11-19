// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () =>
    Response.json({ error: "unauthorized" }, { status: 403 }),
}));

const { GET, POST } = await import("../route");

describe("/api/agents/proposals", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
  });

  it("GET returns agent proposal list", async () => {
    const res = await GET(new Request("http://localhost/api/agents/proposals") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.proposals)).toBe(true);
  });

  it("POST returns 403 without operator auth", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const res = await POST(
      new Request("http://localhost/api/agents/proposals", {
        method: "POST",
        body: JSON.stringify({ action: "reflect", agentId: "a1" }),
      }) as never
    );
    expect(res.status).toBe(403);
  });

  it("POST returns 400 when reflect missing trace/run", async () => {
    const res = await POST(
      new Request("http://localhost/api/agents/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reflect", agentId: "agent-1" }),
      }) as never
    );
    expect(res.status).toBe(400);
  });
});
