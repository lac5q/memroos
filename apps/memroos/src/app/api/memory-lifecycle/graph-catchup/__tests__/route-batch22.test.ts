// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const runGraphCatchup = vi.hoisted(() =>
  vi.fn(async () => ({
    status: "completed" as const,
    projected: 0,
    considered: 0,
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
  };
});

const LOOPBACK = "http://localhost";
const REMOTE = "https://memroos.example.test";

describe("/api/memory-lifecycle/graph-catchup batch22", () => {
  beforeEach(() => {
    runGraphCatchup.mockReset();
    runGraphCatchup.mockResolvedValue({
      status: "completed",
      projected: 1,
      considered: 1,
      errors: 0,
      dryRun: true,
    });
    vi.resetModules();
  });

  it("GET returns 403 on non-loopback without operator key", async () => {
    const { GET } = await import("../route");
    const res = await GET(new Request(`${REMOTE}/api/memory-lifecycle/graph-catchup`) as never);
    expect(res.status).toBe(403);
  });

  it("POST tolerates invalid JSON body and ignores non-finite batchSize", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/memory-lifecycle/graph-catchup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      })
    );
    expect(res.status).toBe(200);
    expect(runGraphCatchup).toHaveBeenCalledWith(
      testDb,
      expect.objectContaining({ batchSize: undefined, dryRun: false })
    );

    runGraphCatchup.mockClear();
    await POST(
      new Request(`${LOOPBACK}/api/memory-lifecycle/graph-catchup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: true, batchSize: Number.NaN }),
      })
    );
    expect(runGraphCatchup).toHaveBeenCalledWith(
      testDb,
      expect.objectContaining({ batchSize: undefined })
    );
  });

  it("POST returns 400 when runGraphCatchup throws", async () => {
    runGraphCatchup.mockRejectedValueOnce(new Error("catchup exploded"));
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/memory-lifecycle/graph-catchup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: true }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/exploded/);
  });
});
