// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TMP_ROOT = path.join(os.tmpdir(), `memlife-b30b-${crypto.randomUUID()}`);

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: () => true,
  registryWriteUnauthorizedResponse: () => new Response("{}", { status: 401 }),
}));

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/memory-lifecycle/consolidation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function source(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    canonicalId: `canon-${crypto.randomUUID().slice(0, 8)}`,
    recordType: "message",
    recordId: "1",
    content: "raw",
    contentHash: crypto.createHash("sha256").update("raw").digest("hex"),
    ontologyType: "memory.note",
    tier: "mid",
    classification: { visibility: "internal", policy: "sealed" },
    ...overrides,
  };
}

beforeEach(async () => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  process.env.SQLITE_DB_PATH = path.join(TMP_ROOT, `${crypto.randomUUID()}.db`);
  const { closeDb } = await import("@/lib/db");
  closeDb();
});

afterEach(async () => {
  const { closeDb } = await import("@/lib/db");
  closeDb();
  delete process.env.SQLITE_DB_PATH;
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("memory-lifecycle consolidation route batch30b", () => {
  it("uses providerOverride.summary when supplied", async () => {
    const { POST } = await import("../consolidation/route");
    const res = await POST(
      jsonRequest({
        runKey: `run-${crypto.randomUUID().slice(0, 6)}`,
        actorId: "operator",
        scope: { tenantId: "default-tenant", purpose: "recall" },
        sources: [source()],
        providerOverride: { summary: "custom episodic summary b30b" },
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("returns 400 when sources array is missing", async () => {
    const { POST } = await import("../consolidation/route");
    const res = await POST(
      jsonRequest({
        runKey: "run-missing-sources",
        actorId: "operator",
        scope: { tenantId: "default-tenant", purpose: "recall" },
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/sources must be an array/i);
  });

  it("builds default provider summary from promptSafe when override has no summary", async () => {
    const { POST } = await import("../consolidation/route");
    const res = await POST(
      jsonRequest({
        runKey: `run-prompt-${crypto.randomUUID().slice(0, 6)}`,
        actorId: "operator",
        scope: { tenantId: "default-tenant", purpose: "recall" },
        sources: [source({ content: "alpha beta gamma" })],
        providerOverride: { model: "stub" },
      }),
    );
    expect(res.status).toBe(200);
  });
});
