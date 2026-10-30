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

const LOOPBACK = "http://localhost";

describe("POST /api/operations/telemetry batch22", () => {
  beforeEach(() => {
    authorizeRegistryWrite.mockReturnValue(true);
    testDb.prepare("DELETE FROM efficiency_events").run();
    testDb.prepare("DELETE FROM messages").run();
  });

  it("skips blank messages and zero-token ledgers", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/operations/telemetry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purpose: "batch22-skip",
          messages: [{ content: "   " }, { content: "valid telemetry batch22" }],
          tokenLedgers: [
            { modelId: "gpt-skip", rawContextTokens: 0, cachedTokens: 0, totalTokens: 0 },
            { modelId: "gpt-keep", rawContextTokens: 5, cachedTokens: 0, totalTokens: 5 },
            { modelId: "   " },
          ],
        }),
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messagesCreated).toBe(1);
    expect(body.ledgersCreated).toBe(1);
  });
});
