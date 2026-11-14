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

describe("GET /api/security/report batch22", () => {
  beforeEach(() => {
    testDb.prepare("DELETE FROM audit_log").run();
  });

  it("returns watch status for medium policy events and ranks top actors", async () => {
    testDb
      .prepare(
        `INSERT INTO audit_log(actor, action, target, detail, severity, timestamp)
         VALUES (@actor, @action, @target, @detail, @severity, @timestamp)`
      )
      .run({
        actor: "agent-z",
        action: "policy_check",
        target: "dispatch",
        detail: null,
        severity: "medium",
        timestamp: "2026-02-01T00:00:00.000Z",
      });
    testDb
      .prepare(
        `INSERT INTO audit_log(actor, action, target, detail, severity, timestamp)
         VALUES (@actor, @action, @target, @detail, @severity, @timestamp)`
      )
      .run({
        actor: "agent-a",
        action: "security_scan",
        target: "agent-shield policy",
        detail: 'token sk-live-batch22-secret and Bearer abc.def.ghi',
        severity: "high",
        timestamp: "2026-02-03T00:00:00.000Z",
      });

    const res = await GET(makeGetRequest() as never);
    const data = await res.json();
    expect(data.summary.status).toBe("attention");
    expect(data.summary.topActors[0]).toEqual({ actor: "agent-a", count: 1 });
    const redacted = data.auditActivity.find((row: { detail: string | null }) =>
      String(row.detail ?? "").includes("[redacted]")
    );
    expect(redacted).toBeTruthy();
    expect(redacted.detail).not.toContain("sk-live-batch22-secret");
    expect(data.summary.mediumSeverity).toBeGreaterThanOrEqual(1);
  });
});
