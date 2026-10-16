// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeRegistryWriteMock = vi.hoisted(() => vi.fn(() => true));
const pollAllAdaptersMock = vi.hoisted(() =>
  vi.fn(async () => ({
    adaptersRun: 1,
    eventsInserted: 2,
    errors: [] as string[],
  }))
);

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: authorizeRegistryWriteMock,
  registryWriteUnauthorizedResponse: () =>
    Response.json({ ok: false, error: "Registry write authorization required" }, { status: 403 }),
}));

vi.mock("@/lib/l3/adapters/hubspot", () => ({
  createHubSpotAdapter: vi.fn(() => ({ name: "hubspot" })),
}));
vi.mock("@/lib/l3/adapters/intercom", () => ({
  createIntercomAdapter: vi.fn(() => ({ name: "intercom" })),
}));
vi.mock("@/lib/l3/adapters/quickbooks", () => ({
  createQuickBooksAdapter: vi.fn(() => ({ name: "quickbooks" })),
}));

vi.mock("@/lib/l3/poller", () => ({
  pollAllAdapters: pollAllAdaptersMock,
}));

const { POST } = await import("../route");

describe("POST /api/l3/poll", () => {
  beforeEach(() => {
    authorizeRegistryWriteMock.mockReturnValue(true);
    pollAllAdaptersMock.mockClear();
  });

  it("returns 403 when unauthorized", async () => {
    authorizeRegistryWriteMock.mockReturnValueOnce(false);
    const req = new Request("http://localhost/api/l3/poll", { method: "POST", body: "{}" });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
  });

  it("returns 400 when adapter filter matches nothing", async () => {
    const req = new Request("http://localhost/api/l3/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adapters: ["nonexistent"] }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("runs pollAllAdapters for matching adapters", async () => {
    const req = new Request("http://localhost/api/l3/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adapters: ["hubspot"], since: "2026-01-01T00:00:00.000Z" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.adaptersRun).toBe(1);
    expect(pollAllAdaptersMock).toHaveBeenCalledOnce();
  });
});
