// @vitest-environment node
import Database from "better-sqlite3";
import { describe, it, expect, vi, beforeEach } from "vitest";

const testDb = new Database(":memory:");
const { initSchema } = await import("@/lib/db-schema");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const authorizeRegistryWrite = vi.fn(() => true);

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () =>
    Response.json({ ok: false, error: "unauthorized" }, { status: 403 }),
}));

const { GET, POST, PATCH } = await import("../route");

describe("/api/cron-health", () => {
  beforeEach(() => {
    testDb.exec("DELETE FROM cron_health_jobs");
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
  });

  it("GET returns jobs and summary", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.jobs)).toBe(true);
    expect(data.summary).toMatchObject({
      total: data.jobs.length,
      healthy: expect.any(Number),
    });
  });

  it("POST returns 403 when registry write unauthorized", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const res = await POST(
      new Request("http://localhost/api/cron-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "x" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("POST returns 400 for invalid JSON or missing fields", async () => {
    expect(
      (await POST(new Request("http://localhost/api/cron-health", { method: "POST", body: "bad" })))
        .status
    ).toBe(400);
    const res = await POST(
      new Request("http://localhost/api/cron-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "custom-job" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("POST upserts a cron job", async () => {
    const res = await POST(
      new Request("http://localhost/api/cron-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "custom-job",
          name: "Custom",
          sourceFamily: "memory",
          schedule: "hourly",
          status: "active",
        }),
      })
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.job.id).toBe("custom-job");
  });

  it("PATCH returns 404 when job missing", async () => {
    const res = await PATCH(
      new Request("http://localhost/api/cron-health", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "missing-job", status: "paused" }),
      })
    );
    expect(res.status).toBe(404);
  });

  it("PATCH updates job status", async () => {
    await POST(
      new Request("http://localhost/api/cron-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "patch-me",
          name: "Patch Me",
          sourceFamily: "memory",
          schedule: "daily",
        }),
      })
    );
    const res = await PATCH(
      new Request("http://localhost/api/cron-health", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "patch-me", status: "paused" }),
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.job.status).toBe("paused");
  });
});
