// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", () => ({
  listRegisteredAgents: vi.fn(() => [{ id: "agent-1", name: "Agent", role: "ops", status: "active" }]),
}));

const listNangoConnections = vi.fn(async () => [{ providerKey: "slack", authMode: "oauth" }]);

vi.mock("@/lib/tool-auth/nango-client", () => ({
  listNangoConnections: (...args: unknown[]) => listNangoConnections(...args),
}));

const { GET } = await import("../route");

describe("GET /api/flow/topology", () => {
  it("returns workflow topology graph", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("nodes");
    expect(body).toHaveProperty("edges");
  });

  it("still returns topology when Nango connections are unavailable", async () => {
    listNangoConnections.mockRejectedValueOnce(new Error("nango down"));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes.length).toBeGreaterThan(0);
  });
});
