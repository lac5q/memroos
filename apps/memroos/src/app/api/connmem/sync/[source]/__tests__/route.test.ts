// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: vi.fn(() => ({ id: "agent-1" })),
}));

const { POST } = await import("../route");
const { authenticateAgentHeaders } = await import("@/lib/agent-registry");

describe("POST /api/connmem/sync/[source]", () => {
  beforeEach(() => {
    process.env.CONNMEM_URL = "http://connmem.test.local";
  });

  it("returns 401 without auth", async () => {
    vi.mocked(authenticateAgentHeaders).mockReturnValueOnce(null);
    const res = await POST(new Request("http://localhost/api/connmem/sync/slack", { method: "POST" }) as never, {
      params: Promise.resolve({ source: "slack" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid source", async () => {
    const res = await POST(new Request("http://localhost/api/connmem/sync/BAD", { method: "POST" }) as never, {
      params: Promise.resolve({ source: "BAD" }),
    });
    expect(res.status).toBe(400);
  });

  it("proxies sync request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ synced: 2 }))
    );
    const res = await POST(new Request("http://localhost/api/connmem/sync/slack", { method: "POST" }) as never, {
      params: Promise.resolve({ source: "slack" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.synced).toBe(2);
  });
});
