// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const runGraphCatchup = vi.hoisted(() => vi.fn());
const isCronJobRunnable = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/memory/graph-catchup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory/graph-catchup")>();
  return {
    ...actual,
    runGraphCatchup: (...args: unknown[]) => runGraphCatchup(...args),
  };
});

vi.mock("@/lib/cron-health", () => ({
  ensureDefaultCronJobs: vi.fn(),
  isCronJobRunnable: (...args: unknown[]) => isCronJobRunnable(...args),
  recordCronHealthRun: vi.fn(),
  listCronHealthJobs: vi.fn(() => [{ id: "graph-catchup", status: "running" }]),
}));

const LOOPBACK = "http://localhost";

describe("graph-catchup route batch28 — cron gate and failure statuses", () => {
  beforeEach(() => {
    runGraphCatchup.mockReset();
    isCronJobRunnable.mockReturnValue(true);
    vi.resetModules();
  });

  it("POST returns 409 when cron is paused unless force=true", async () => {
    isCronJobRunnable.mockReturnValue(false);
    const { POST } = await import("../graph-catchup/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/memory-lifecycle/graph-catchup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, jobId: "graph-catchup" });
  });

  it("POST returns 500 when catchup summary status is failed", async () => {
    runGraphCatchup.mockResolvedValueOnce({
      status: "failed",
      reason: "neo4j batch28",
      projected: 0,
      considered: 0,
      errors: 1,
      dryRun: false,
    });
    const { POST } = await import("../graph-catchup/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/memory-lifecycle/graph-catchup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: true }),
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.summary.status).toBe("failed");
  });

  it("GET returns checkpoint payload on loopback", async () => {
    const { GET } = await import("../graph-catchup/route");
    const res = await GET(new Request(`${LOOPBACK}/api/memory-lifecycle/graph-catchup`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty("checkpoint");
    expect(body.job?.id).toBe("graph-catchup");
  });
});
