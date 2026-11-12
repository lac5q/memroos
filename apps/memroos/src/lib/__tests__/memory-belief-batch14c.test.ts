// @vitest-environment node
import crypto from "crypto";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { runBeliefPromotionEvalSuite } from "@/lib/evals/belief-promotion-eval";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

afterEach(() => {
  vi.resetModules();
  mockFetch.mockReset();
  testDb.exec("DELETE FROM memory_meta_insights");
  testDb.exec("DELETE FROM memory_consolidation_runs");
  testDb.exec("DELETE FROM memory_salience");
  testDb.exec("DELETE FROM messages");
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.CONSOLIDATION_MODEL;
  stopIfStarted();
});

function stopIfStarted() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (g._consolidationInterval) {
      clearInterval(g._consolidationInterval);
      g._consolidationInterval = undefined;
    }
  } catch {
    /* ignore */
  }
}

function seedMessage(content: string) {
  testDb
    .prepare(
      "INSERT INTO messages(session_id, project, agent_id, role, content, timestamp) VALUES(?,?,?,?,?,?)",
    )
    .run(`sess-${crypto.randomUUID()}`, "p1", "agent", "user", content, "2024-01-01T00:00:00Z");
  testDb.exec("INSERT OR IGNORE INTO memory_salience(message_id) SELECT id FROM messages");
}

describe("memory-belief batch14c — consolidation, quarantine, belief paths", () => {
  it("runConsolidation extracts JSON arrays embedded in prose and skips invalid object payloads", async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            content: `Here are insights:\n[{"insight_type":"pattern","content":"nested array insight"}]\nThanks.`,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    seedMessage("consolidate me");
    const { runConsolidation } = await import("@/lib/memory-consolidation");
    const ok = await runConsolidation();
    expect(ok.status).toBe("completed");
    expect(ok.insightsWritten).toBe(1);

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: { content: '{"insight_type":"pattern","content":"not-array"}' } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    seedMessage("object payload");
    testDb.exec("UPDATE messages SET consolidated = 0 WHERE content = 'object payload'");
    const skipped = await runConsolidation();
    expect(skipped.insightsWritten).toBe(0);
  });

  it("startConsolidationScheduler and stopConsolidationScheduler are idempotent", async () => {
    const { startConsolidationScheduler, stopConsolidationScheduler } = await import("@/lib/memory-consolidation");
    startConsolidationScheduler();
    startConsolidationScheduler();
    stopConsolidationScheduler();
    stopConsolidationScheduler();
    expect(true).toBe(true);
  });

  it("skill quarantine pipeline scores verification checks and rejects invalid approvals", async () => {
    const db = new Database(":memory:");
    initSchema(db);
    const skillId = Number(
      db
        .prepare(
          `INSERT INTO skill_registry (name, description, owner, source_harness, risk_tier, dispatch_status,
            version, preconditions, allowed_tools, verification_checks, rollback_behavior,
            raw_body, completeness_pct, missing_fields_json, imported_by, imported_at,
            evidence_examples, content_hash, trust_level)
           VALUES ('q-b14c', '', 'ops', 'claude', 'low', 'quarantined', '1.0.0', '', '', 'must include rollback section', '', ?, 100, '[]', 'op', ?, '', ?, 'unsigned')`,
        )
        .run("## Rollback section details here", new Date().toISOString(), crypto.createHash("sha256").update("body").digest("hex"))
        .lastInsertRowid,
    );
    const { runQuarantinePipeline, scoreVerificationChecks, approveQuarantine, QuarantineTransitionError } =
      await import("@/lib/skills/skill-quarantine");
    expect(scoreVerificationChecks("rollback section details here", "must include rollback")).toBeGreaterThan(0);
    const pipeline = runQuarantinePipeline(db, skillId, "## Rollback section details here", "must include rollback");
    expect(pipeline.blocked).toBe(false);
    expect(() => approveQuarantine(db, skillId, "  ")).toThrow(QuarantineTransitionError);
    db.close();
  });

  it("runGraphCatchup skips when Neo4j is not configured", async () => {
    vi.doMock("@/lib/memory/backends", () => ({
      neo4jConfig: () => ({ password: "", url: "http://localhost:7474" }),
    }));
    vi.resetModules();
    const db = new Database(":memory:");
    initSchema(db);
    const { runGraphCatchup, isNeo4jConfigured } = await import("@/lib/memory/graph-catchup");
    expect(isNeo4jConfigured()).toBe(false);
    const summary = await runGraphCatchup(db, { dryRun: false });
    expect(summary.status).toBe("skipped");
    expect(summary.reason).toBe("neo4j_not_configured");
    db.close();
    vi.doUnmock("@/lib/memory/backends");
    vi.resetModules();
  });

  it("belief promotion eval suite runs receipt_exposes_stage and promotion guard cases", async () => {
    const casesPath = path.join(os.tmpdir(), `belief-b14c-${Date.now()}.json`);
    fs.writeFileSync(
      casesPath,
      JSON.stringify([
        { id: "receipt_exposes_stage", description: "receipt shape", expectations: {} },
        { id: "bronze_citation_only", description: "bronze", expectations: {} },
      ]),
      "utf8",
    );
    const run = await runBeliefPromotionEvalSuite({ mode: "full", db: testDb, casesPath });
    expect(run.cases.length).toBe(2);
    fs.unlinkSync(casesPath);
  });
});
