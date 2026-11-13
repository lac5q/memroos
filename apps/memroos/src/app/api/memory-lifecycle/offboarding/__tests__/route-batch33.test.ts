// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `offboard-b33-${crypto.randomUUID()}`);

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: () => true,
  registryWriteUnauthorizedResponse: () => new Response("{}", { status: 401 }),
}));

function jsonRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(TMP_ROOT, `${crypto.randomUUID()}.db`);
});

afterEach(async () => {
  const { closeDb } = await import("@/lib/db");
  closeDb();
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  vi.resetModules();
});

describe("POST /api/memory-lifecycle/offboarding batch33", () => {
  it("returns 400 when required string fields are missing (L18)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      jsonRequest("http://localhost/api/memory-lifecycle/offboarding", {
        action: "trigger",
        scope: { tenantId: "default-tenant", purpose: "recall" },
        actorId: "admin",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/subjectHash is required/i);
  });

  it("attach_plan returns 404 when review is missing (L52)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      jsonRequest("http://localhost/api/memory-lifecycle/offboarding", {
        action: "attach_plan",
        tenantId: "default-tenant",
        reviewId: `missing-${crypto.randomUUID()}`,
        planId: "plan-b33",
        actorId: "admin",
      }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("review_not_found");
  });
});
