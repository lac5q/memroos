// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authorizeRegistryWrite = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: (...args: unknown[]) => authorizeRegistryWrite(...args),
  registryWriteUnauthorizedResponse: () =>
    Response.json({ ok: false, error: "unauthorized" }, { status: 403 }),
}));

const { POST } = await import("../route");

describe("POST /api/operations/telemetry", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReset();
    authorizeRegistryWrite.mockReturnValue(true);
  });

  it("returns 403 when unauthorized", async () => {
    authorizeRegistryWrite.mockReturnValueOnce(false);
    const res = await POST(
      new Request("http://localhost/api/operations/telemetry", {
        method: "POST",
        body: JSON.stringify({}),
      }) as never
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid body", async () => {
    const res = await POST(new Request("http://localhost/api/operations/telemetry", { method: "POST", body: "x" }) as never);
    expect(res.status).toBe(400);
  });

  it("ingests messages and token ledgers", async () => {
    const res = await POST(
      new Request("http://localhost/api/operations/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: "noc-smoke",
          messages: [{ content: "hello telemetry", agentId: "operator" }],
          tokenLedgers: [{ modelId: "gpt-test", rawContextTokens: 10, cachedTokens: 2, totalTokens: 12 }],
        }),
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.messagesCreated).toBe(1);
    expect(body.ledgersCreated).toBe(1);
  });
});
