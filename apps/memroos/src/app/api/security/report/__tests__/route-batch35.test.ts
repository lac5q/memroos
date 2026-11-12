// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";

const testDb = new Database(":memory:");
const { initSchema } = await import("@/lib/db-schema");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const { GET } = await import("../route");

function makeGetRequest(params: Record<string, string> = {}): Request {
  const url = new URL("http://localhost/api/security/report");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return new Request(url.toString(), { method: "GET" });
}

describe("GET /api/security/report batch35", () => {
  beforeEach(() => {
    testDb.prepare("DELETE FROM audit_log").run();
  });

  it("statusFor returns clear when only info events are present (stmt/fn 61)", async () => {
    testDb
      .prepare(
        `INSERT INTO audit_log(actor, action, target, detail, severity, timestamp)
         VALUES (@actor, @action, @target, @detail, @severity, @timestamp)`,
      )
      .run({
        actor: "agent-clear-b35",
        action: "security_audit",
        target: "console",
        detail: "routine info batch35",
        severity: "info",
        timestamp: "2026-03-01T00:00:00.000Z",
      });
    const res = await GET(makeGetRequest() as never);
    const data = await res.json();
    expect(data.summary.status).toBe("clear");
  });

  it("clampLimit honors numeric query params", async () => {
    const res = await GET(makeGetRequest({ limit: "5" }) as never);
    const data = await res.json();
    expect(data.auditActivity.length).toBeLessThanOrEqual(5);
  });
});
