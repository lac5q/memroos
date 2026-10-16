// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: vi.fn(() => ({ id: "agent-1" })),
}));

const { GET } = await import("../route");
const { authenticateAgentHeaders } = await import("@/lib/agent-registry");

describe("GET /api/connmem/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CONNMEM_URL = "http://connmem.test.local";
  });

  it("returns 401 without agent auth", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await GET(new Request("http://localhost/api/connmem/status") as never);
    expect(res.status).toBe(401);
  });

  it("proxies upstream status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ version: "1.0", healthy: true }))
    );
    const res = await GET(new Request("http://localhost/api/connmem/status") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.healthy).toBe(true);
  });

  it("returns 502 when upstream fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "down" }, { status: 503 })));
    const res = await GET(new Request("http://localhost/api/connmem/status") as never);
    expect(res.status).toBe(502);
  });
});
