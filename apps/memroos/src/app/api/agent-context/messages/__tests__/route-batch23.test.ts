// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const mockAuthenticate = vi.hoisted(() => vi.fn(() => ({ id: "sender-agent" })));

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", () => ({
  authenticateAgentHeaders: (...args: unknown[]) => mockAuthenticate(...args),
  recordMemoryWrite: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/content-scanner", () => ({
  scanContent: (text: string) => ({ cleanContent: text, blocked: false, matches: [] }),
}));

const LOOPBACK = "http://localhost";

describe("/api/agent-context/messages batch23", () => {
  beforeEach(() => {
    mockAuthenticate.mockReturnValue({ id: "sender-agent" });
  });

  it("POST rejects non-object payloads and missing routing fields", async () => {
    const { POST } = await import("../route");
    const badPayload = await POST(
      new Request(`${LOOPBACK}/api/agent-context/messages`, {
        method: "POST",
        headers: { authorization: "Bearer k", "content-type": "application/json" },
        body: JSON.stringify("not-an-object"),
      }) as never
    );
    expect(badPayload.status).toBe(400);

    const missingFields = await POST(
      new Request(`${LOOPBACK}/api/agent-context/messages`, {
        method: "POST",
        headers: { authorization: "Bearer k", "content-type": "application/json" },
        body: JSON.stringify({ fromAgent: "sender-agent", body: "hello" }),
      }) as never
    );
    expect(missingFields.status).toBe(400);

    const badType = await POST(
      new Request(`${LOOPBACK}/api/agent-context/messages`, {
        method: "POST",
        headers: { authorization: "Bearer k", "content-type": "application/json" },
        body: JSON.stringify({
          fromAgent: "sender-agent",
          toAgent: "receiver",
          body: "hello",
          messageType: "not-a-type",
        }),
      }) as never
    );
    expect(badType.status).toBe(400);
    expect(await badType.json()).toMatchObject({ error: expect.stringContaining("Invalid messageType") });
  });
});
