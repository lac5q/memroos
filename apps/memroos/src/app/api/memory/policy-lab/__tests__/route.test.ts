// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));
const rankMemoryPolicies = vi.hoisted(() =>
  vi.fn(async () => [{ name: "baseline", score: 0.9 }])
);

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () =>
    Response.json({ error: "unauthorized" }, { status: 403 }),
}));

vi.mock("@/lib/memory-policy-lab", () => ({
  rankMemoryPolicies: (...args: unknown[]) => rankMemoryPolicies(...args),
}));

const { POST } = await import("../route");

describe("POST /api/memory/policy-lab", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
    rankMemoryPolicies.mockClear();
  });

  it("returns 403 when unauthorized", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const res = await POST(
      new Request("http://localhost/api/memory/policy-lab", {
        method: "POST",
        body: JSON.stringify({ variants: [{ name: "a", config: {} }] }),
      }) as never
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when variants missing or invalid", async () => {
    expect(
      (await POST(new Request("http://localhost/api/memory/policy-lab", { method: "POST", body: "{}" }) as never))
        .status
    ).toBe(400);

    const res = await POST(
      new Request("http://localhost/api/memory/policy-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variants: [{ name: 1, config: {} }] }),
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("returns ranked table on success", async () => {
    const res = await POST(
      new Request("http://localhost/api/memory/policy-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variants: [{ name: "baseline", config: { topK: 5 } }],
        }),
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.ranked).toHaveLength(1);
    expect(rankMemoryPolicies).toHaveBeenCalled();
  });

  it("returns 500 when ranking throws", async () => {
    rankMemoryPolicies.mockRejectedValueOnce(new Error("rank failed"));
    const res = await POST(
      new Request("http://localhost/api/memory/policy-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variants: [{ name: "x", config: {} }] }),
      }) as never
    );
    expect(res.status).toBe(500);
  });
});
