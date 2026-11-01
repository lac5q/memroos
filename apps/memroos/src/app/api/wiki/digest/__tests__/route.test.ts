// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));
const runWikiDigest = vi.hoisted(() => vi.fn());

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () => Response.json({ ok: false, error: "forbidden" }, { status: 403 }),
}));

vi.mock("@/lib/wiki-digest", () => ({
  WIKI_DIGEST_CRON_ID: "wiki-digest",
  runWikiDigest: (...args: unknown[]) => runWikiDigest(...args),
}));

vi.mock("@/lib/cron-health", () => ({
  ensureDefaultCronJobs: vi.fn(),
  isCronJobRunnable: vi.fn(() => true),
  recordCronHealthRun: vi.fn(),
  listCronHealthJobs: vi.fn(() => []),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({}),
}));

const { POST } = await import("../route");

describe("POST /api/wiki/digest", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
    runWikiDigest.mockReset();
  });

  it("returns 403 when registry write is unauthorized", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const res = await POST(new Request("http://localhost/api/wiki/digest", { method: "POST", body: "{}" }));
    expect(res.status).toBe(403);
  });

  it("runs the wiki digest job", async () => {
    runWikiDigest.mockResolvedValueOnce({
      status: "completed",
      dryRun: false,
      considered: 2,
      written: 2,
      errors: 0,
    });
    const res = await POST(
      new Request("http://localhost/api/wiki/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false, force: true }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, summary: { written: 2 } });
  });
});
