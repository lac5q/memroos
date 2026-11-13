// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `retention-route-b34b-${randomUUID()}`);

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

const label = { visibility: "internal" as const };
const scope = { tenantId: "default-tenant", project: "batch34b" };

beforeEach(async () => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(TMP_ROOT, `${randomUUID()}.db`);
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

describe("memory-lifecycle retention route batch34b", () => {
  it("create_policy honors tombstone action, disabled flag, and now override", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      jsonRequest({
        action: "create_policy",
        name: `policy-b34b-${randomUUID().slice(0, 6)}`,
        ontologyType: "memory.note",
        securityLabel: label,
        purpose: "recall",
        scope,
        durationDays: 14,
        retentionAction: "tombstone",
        enabled: false,
        actorId: "operator-b34b",
        now: "2026-06-01T00:00:00.000Z",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policy.action).toBe("tombstone");
    expect(body.policy.enabled).toBe(0);
  });

  it("returns 400 for unsupported actions and non-Error failures", async () => {
    const { POST } = await import("../route");
    const unsupported = await POST(jsonRequest({ action: "explode", actorId: "x" }));
    expect(unsupported.status).toBe(400);
    expect((await unsupported.json()).error).toMatch(/unsupported action/i);

    const bad = await POST(
      jsonRequest({
        action: "create_policy",
        name: "bad-priority-b34b",
        ontologyType: "memory.note",
        securityLabel: label,
        purpose: "recall",
        scope,
        durationDays: 30,
        priority: "nope",
        actorId: "operator-b34b",
      }),
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/priority must be an integer/i);
  });

  it("GET lists receipts with limit query param", async () => {
    const { POST, GET } = await import("../route");
    const recordId = `rec-b34b-${randomUUID().slice(0, 8)}`;
    await POST(
      jsonRequest({
        action: "create_policy",
        name: "batch34b-get",
        ontologyType: "memory.note",
        securityLabel: label,
        purpose: "recall",
        scope,
        durationDays: 5,
        retentionAction: "review",
        actorId: "operator-b34b",
      }),
    );
    await POST(
      jsonRequest({
        action: "register_record",
        recordType: "message",
        recordId,
        ontologyType: "memory.note",
        securityLabel: label,
        purpose: "recall",
        scope,
        actorId: "operator-b34b",
        createdAt: "2026-02-01T00:00:00.000Z",
      }),
    );

    const listed = await GET(jsonRequest({ recordId, limit: 1 }, "GET"));
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.ok).toBe(true);
    expect(body.receipts.length).toBeGreaterThan(0);
  });

  it("evaluate may return 409 when no policy matches", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      jsonRequest({
        action: "evaluate",
        ontologyType: "memory.note",
        securityLabel: label,
        purpose: "nonexistent-purpose-b34b",
        scope: { tenantId: "missing-tenant-b34b" },
        createdAt: "2020-01-01T00:00:00.000Z",
      }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.evaluation).toBeDefined();
  });
});
