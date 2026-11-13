// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: () => true,
  registryWriteUnauthorizedResponse: () => Response.json({ ok: false }, { status: 401 }),
}));

const { POST } = await import("../route");

describe("POST /api/memory-lifecycle/dsar batch32", () => {
  it("returns 400 for unsupported actions (line 81)", async () => {
    const res = await POST(
      new Request("http://localhost/api/memory-lifecycle/dsar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: `unknown-${Date.now()}` }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/unsupported action/);
  });
});
