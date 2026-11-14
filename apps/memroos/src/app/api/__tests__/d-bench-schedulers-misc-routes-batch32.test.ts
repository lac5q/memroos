// @vitest-environment node
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const LOOPBACK = "http://localhost:3000";

const testDb = new Database(":memory:");
initSchema(testDb);

const runGraphCatchup = vi.hoisted(() =>
  vi.fn(async () => ({
    status: "completed",
    considered: 0,
    projected: 1,
    skipped: 0,
    errors: 0,
    dryRun: false,
    checkpointAfter: { episodicLastId: null, vectorLastId: null },
  })),
);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: () => true,
  registryWriteUnauthorizedResponse: () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
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
  isCronJobRunnable: vi.fn(() => true),
  recordCronHealthRun: vi.fn(),
  listCronHealthJobs: vi.fn(() => [{ id: "graph-catchup", status: "running" }]),
}));

describe("cluster D API routes batch32", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("graph-catchup POST forwards finite batchSize (asOptionalNumber line 25)", async () => {
    const { POST } = await import("../memory-lifecycle/graph-catchup/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/memory-lifecycle/graph-catchup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: true, batchSize: 16, dryRun: true }),
      }),
    );
    expect(res.status).toBe(200);
    expect(runGraphCatchup).toHaveBeenCalledWith(testDb, expect.objectContaining({ batchSize: 16, dryRun: true }));
  });

  it("slack events parseJson returns null on invalid JSON (line 31)", async () => {
    vi.stubEnv("SLACK_SIGNING_SECRET", "test-signing-secret-batch32");
    const { POST } = await import("../integrations/slack/events/route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/integrations/slack/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json-batch32",
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    vi.unstubAllEnvs();
  });

  it("directives budget POST rejects unauthenticated callers (line 98)", async () => {
    const { POST } = await import("../directives/budget/route");
    const res = await POST(
      new NextRequest(`${LOOPBACK}/api/directives/budget`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_id: "default-tenant" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
