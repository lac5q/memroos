// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as auditWrite from "@/lib/audit/write";
import { runSlaActions } from "@/lib/hil/sla-actions";

let testDb: Database.Database;

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: vi.fn(),
}));

function pastDeadline(): string {
  return new Date(Date.now() - 120_000).toISOString();
}

beforeEach(() => {
  testDb = new Database(":memory:");
  initSchema(testDb);
});

afterEach(() => {
  vi.restoreAllMocks();
  testDb.close();
});

describe("sla-actions batch37", () => {
  it("runSlaActions logs and continues when applyAction throws (65)", () => {
    testDb
      .prepare(
        `INSERT INTO hil_escalations
          (id, tenant_id, entity_type, entity_id, escalation_type, sla_seconds, sla_deadline,
           status, opened_by, created_at)
         VALUES (?, 'default-tenant', 'run', 'run-b37', 'agent_escalate', 60, ?, 'open', 'operator-b37', ?)`,
      )
      .run("esc-b37-fail", pastDeadline(), new Date().toISOString());
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(auditWrite, "writeAuditEntry").mockImplementation(() => {
      throw new Error("audit write blocked b37");
    });
    const result = runSlaActions(testDb);
    expect(result.acted).toBe(0);
    expect(err.mock.calls.some((call) => String(call[0]).includes("[sla-actions]"))).toBe(true);
  });
});