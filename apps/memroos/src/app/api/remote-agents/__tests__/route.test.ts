// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent-registry", () => ({
  getRemoteAgents: vi.fn(() => [{ id: "remote-1", name: "Remote", url: "https://agent.example.com" }]),
  pollAllRemoteAgents: vi.fn(async () => [
    { id: "remote-1", reachable: true, latencyMs: 12, data: { ok: true } },
  ]),
}));

const { GET } = await import("../route");

describe("GET /api/remote-agents", () => {
  it("returns remote agent health", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].status).toBe("active");
  });
});
