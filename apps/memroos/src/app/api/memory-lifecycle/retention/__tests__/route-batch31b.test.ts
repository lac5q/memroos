// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `retention-route-b31b-${randomUUID()}`);

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: () => true,
  registryWriteUnauthorizedResponse: () => new Response("{}", { status: 401 }),
}));

function jsonRequest(body: Record<string, unknown>, method: "POST" | "GET" = "POST"): Request {
  if (method === "GET") {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    const qs = params.toString();
    return new Request(`http://localhost/api/memory-lifecycle/retention${qs ? `?${qs}` : ""}`, { method: "GET" });
  }
  return new Request("http://localhost/api/memory-lifecycle/retention", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

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

describe("memory-lifecycle retention route batch31b", () => {
  it("asInt rejects non-integer priority (line 30)", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      jsonRequest({
        action: "create_policy",
        name: "bad-priority-b31b",
        ontologyType: "memory.note",
        securityLabel: { visibility: "internal" },
        purpose: "recall",
        scope: { tenantId: "default-tenant" },
        durationDays: 30,
        priority: "not-a-number",
        actorId: "operator-b31b",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/priority must be an integer/i);
  });

  it("GET lists retention receipts (line 99)", async () => {
    const { POST, GET } = await import("../route");
    const recordId = `rec-${randomUUID().slice(0, 8)}`;
    const policy = await POST(
      jsonRequest({
        action: "create_policy",
        id: `policy-b31b-${randomUUID().slice(0, 6)}`,
        name: "batch31b policy",
        ontologyType: "memory.note",
        securityLabel: { visibility: "internal" },
        purpose: "recall",
        scope: { tenantId: "default-tenant", project: "alpha" },
        durationDays: 30,
        actorId: "operator-b31b",
      }),
    );
    expect(policy.status).toBe(200);

    const register = await POST(
      jsonRequest({
        action: "register_record",
        recordType: "message",
        recordId,
        ontologyType: "memory.note",
        securityLabel: { visibility: "internal" },
        purpose: "recall",
        scope: { tenantId: "default-tenant", project: "alpha" },
        actorId: "operator-b31b",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    expect(register.status).toBe(200);

    const listed = await GET(jsonRequest({ recordId }, "GET"));
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.ok).toBe(true);
    expect(body.receipts.length).toBeGreaterThan(0);
  });
});
