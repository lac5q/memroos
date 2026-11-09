// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `cron-health-route-b31b-${randomUUID()}`);

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (request: Request) => request.headers.get("x-test-auth") === "1",
  registryWriteUnauthorizedResponse: () => Response.json({ ok: false }, { status: 401 }),
}));

beforeEach(async () => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(TMP_ROOT, `${randomUUID()}.db`);
  const { closeDb } = await import("@/lib/db");
  closeDb();
});

afterEach(async () => {
  const { closeDb } = await import("@/lib/db");
  closeDb();
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("cron-health route batch31b", () => {
  it("GET returns seeded jobs and summary counts", async () => {
    const { GET } = await import("../route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.jobs.length).toBeGreaterThanOrEqual(8);
    expect(body.summary.total).toBe(body.jobs.length);
  });

  it("POST requires registry write authorization", async () => {
    const { POST } = await import("../route");
    const denied = await POST(
      new Request("http://localhost/api/cron-health", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "custom-b31b",
          name: "Custom",
          sourceFamily: "memory",
          schedule: "hourly",
        }),
      }),
    );
    expect(denied.status).toBe(401);

    const allowed = await POST(
      new Request("http://localhost/api/cron-health", {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-auth": "1" },
        body: JSON.stringify({
          id: "custom-b31b",
          name: "Custom",
          sourceFamily: "memory",
          schedule: "hourly",
        }),
      }),
    );
    expect(allowed.status).toBe(201);
  });
});
