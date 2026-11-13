// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/memory/graph-catchup", () => ({
  GRAPH_CATCHUP_CRON_ID: "graph-catchup",
  runGraphCatchup: vi.fn(async () => ({ processed: 0, skipped: 0 })),
}));

vi.mock("@/lib/cron-health", () => ({
  ensureDefaultCronJobs: vi.fn(),
  isCronJobRunnable: vi.fn(() => true),
  recordCronHealthRun: vi.fn(),
}));

const LOOPBACK = "http://localhost";

describe("graph-catchup route batch27 — optional body coercions", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("POST ignores non-finite batchSize values while forcing catchup", async () => {
    const { POST } = await import("../graph-catchup/route");
    const { runGraphCatchup } = await import("@/lib/memory/graph-catchup");
    const res = await POST(
      new Request(`${LOOPBACK}/api/memory-lifecycle/graph-catchup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: true, batchSize: Number.NaN, dryRun: true }),
      }),
    );
    expect(res.status).toBe(200);
    expect(runGraphCatchup).toHaveBeenCalledWith(
      testDb,
      expect.objectContaining({ dryRun: true, batchSize: undefined }),
    );
  });
});
