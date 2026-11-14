// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `cron-health-route-b34b-${randomUUID()}`);

const authorizeRegistryWrite = vi.fn(() => true);

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () => Response.json({ ok: false }, { status: 401 }),
}));

beforeEach(async () => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(TMP_ROOT, `${randomUUID()}.db`);
  authorizeRegistryWrite.mockReset();
  authorizeRegistryWrite.mockReturnValue(true);
  const { closeDb } = await import("@/lib/db");
  closeDb();
  vi.resetModules();
});

afterEach(async () => {
  const { closeDb } = await import("@/lib/db");
  closeDb();
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("cron-health route batch34b", () => {
  it("PATCH requires registry write authorization (line 76)", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const { PATCH } = await import("../route");
    const res = await PATCH(
      new Request("http://localhost/api/cron-health", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "missing", status: "paused" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("POST maps optional body fields and rejects array metadata (lines 56–68)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/cron-health", {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-auth": "1" },
        body: JSON.stringify({
          id: `custom-b34b-${randomUUID().slice(0, 8)}`,
          name: "Optional fields",
          sourceFamily: "memory",
          schedule: "hourly",
          owner: "operator",
          status: "not-a-status",
          healthEndpoint: null,
          expectedIntervalMinutes: 30,
          lastRunAt: "2026-07-01T00:00:00.000Z",
          lastSuccessAt: null,
          lastFailureAt: null,
          itemsProcessed: 12,
          warning: "late",
          metadata: ["ignored"],
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.job.owner).toBe("operator");
    expect(body.job.healthEndpoint).toBeNull();
    expect(body.job.metadata).toEqual({});
    expect(body.job.itemsProcessed).toBe(12);
  });
});
