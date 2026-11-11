// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: vi.fn(() => true),
  registryWriteUnauthorizedResponse: vi.fn(() =>
    Response.json({ ok: false, error: "Registry write authorization required" }, { status: 403 }),
  ),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("PATCH /api/orchestration/hil/[id]/edit batch33b", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ORCHESTRATION_SERVICE_URL = "http://localhost:3210";
  });

  it("forwards empty object when request JSON is invalid (line 21)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, editedFields: [] }),
    });
    const { PATCH } = await import("../route");
    const res = await PATCH(
      new Request("http://localhost/api/orchestration/hil/hil-b33b/edit", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }),
      { params: Promise.resolve({ id: "hil-b33b" }) },
    );
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/hil/hil-b33b/edit"),
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
  });

  it("returns null JSON when upstream body is not parseable (line 42)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("invalid json");
      },
    });
    const { PATCH } = await import("../route");
    const res = await PATCH(
      new Request("http://localhost/api/orchestration/hil/hil-b33b/edit", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskSummary: "x" }),
      }),
      { params: Promise.resolve({ id: "hil-b33b" }) },
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toBeNull();
  });
});
