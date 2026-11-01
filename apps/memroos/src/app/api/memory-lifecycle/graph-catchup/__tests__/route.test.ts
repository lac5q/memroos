// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const runGraphCatchup = vi.hoisted(() =>
  vi.fn(async () => ({
    status: "completed" as const,
    projected: 2,
    considered: 2,
    errors: 0,
    dryRun: false,
  }))
);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/memory/graph-catchup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory/graph-catchup")>();
  return {
    ...actual,
    runGraphCatchup: (...args: unknown[]) => runGraphCatchup(...args),
    readGraphCatchupCheckpoint: vi.fn(() => ({ cursor: null })),
    isNeo4jConfigured: vi.fn(() => false),
  };
});

const { GET, POST } = await import("../route");

describe("/api/memory-lifecycle/graph-catchup", () => {
  beforeEach(() => {
    runGraphCatchup.mockClear();
  });

  it("GET returns checkpoint and job status on loopback", async () => {
    const res = await GET(new Request("http://localhost/api/memory-lifecycle/graph-catchup") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.job?.id).toBe("graph-catchup");
  });

  it("POST returns 409 when cron paused and force not set", async () => {
    testDb
      .prepare("UPDATE cron_health_jobs SET status = ? WHERE id = ?")
      .run("paused", "graph-catchup");
    const res = await POST(
      new Request("http://localhost/api/memory-lifecycle/graph-catchup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(409);
  });

  it("POST runs catchup when forced", async () => {
    testDb
      .prepare("UPDATE cron_health_jobs SET status = ? WHERE id = ?")
      .run("paused", "graph-catchup");
    const res = await POST(
      new Request("http://localhost/api/memory-lifecycle/graph-catchup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true, dryRun: true }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(runGraphCatchup).toHaveBeenCalled();
  });
});
