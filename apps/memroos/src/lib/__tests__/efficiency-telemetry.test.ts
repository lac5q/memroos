// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CURRENT_SCHEMA_VERSION, initSchema } from "@/lib/db-schema";
import {
  listEfficiencyEvents,
  recordEfficiencyEvent,
  aggregateEfficiencyTokenLedger,
  mergeModelUsageSources,
  type EfficiencyEventType,
} from "@/lib/efficiency-telemetry";

let db: Database.Database;

describe("efficiency telemetry event foundation", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates efficiency_events through the current schema version", () => {
    const version = db.pragma("user_version", { simple: true }) as number;
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'efficiency_events'")
      .get() as { name: string } | undefined;
    const memoryTraceColumns = db.pragma("table_info(agent_memory_traces)") as { name: string }[];
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'efficiency_events_%'")
      .all() as { name: string }[];

    expect(version).toBe(CURRENT_SCHEMA_VERSION);
    expect(table?.name).toBe("efficiency_events");
    expect(memoryTraceColumns.map((column) => column.name)).toContain("agent_id");
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(["efficiency_events_type_ts", "efficiency_events_task"])
    );
  });

  it("upgrades a version-1 database with the efficiency event table", () => {
    db.exec("DROP TABLE efficiency_events");
    db.exec(`
      CREATE TABLE agent_memory_traces_old AS SELECT * FROM agent_memory_traces;
      DROP TABLE agent_memory_traces;
      CREATE TABLE agent_memory_traces (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT 'default-tenant' REFERENCES tenants(id),
        task_id TEXT,
        run_id TEXT NOT NULL,
        causal_path_json TEXT NOT NULL,
        failure_classification TEXT CHECK(failure_classification IN ('retrieval_miss','bad_ranking','stale_memory','corrupted_memory','policy_redaction','consolidation_error','benchmark_error','model_misuse')),
        root_cause TEXT,
        replay_handle TEXT,
        proposed_repair TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
      INSERT INTO agent_memory_traces
      SELECT id, tenant_id, task_id, run_id, causal_path_json, failure_classification, root_cause, replay_handle, proposed_repair, created_at
      FROM agent_memory_traces_old;
      DROP TABLE agent_memory_traces_old;
    `);
    db.pragma("user_version = 1");

    initSchema(db);

    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'efficiency_events'")
      .get() as { name: string } | undefined;
    const memoryTraceColumns = db.pragma("table_info(agent_memory_traces)") as { name: string }[];
    expect(db.pragma("user_version", { simple: true })).toBe(CURRENT_SCHEMA_VERSION);
    expect(table?.name).toBe("efficiency_events");
    expect(memoryTraceColumns.map((column) => column.name)).toContain("agent_id");
  });

  it("round-trips all Phase 117 event payload types", () => {
    const base = {
      taskId: "task-1",
      agentId: "codex",
      createdAt: "2026-06-27T13:20:00.000Z",
    };

    const inserted = [
      recordEfficiencyEvent(db, {
        ...base,
        eventType: "retrieval_trace",
        payload: {
          query: "Phase 117 telemetry",
          sources: ["memory-trace"],
          tokensUsed: 42,
          usedInFirstResponse: true,
          timingGate: "before_plan",
        },
      }),
      recordEfficiencyEvent(db, {
        ...base,
        eventType: "source_read",
        payload: {
          sourceId: "README.md",
          sourceHash: "sha256:abc",
          toolId: "read_file",
        },
      }),
      recordEfficiencyEvent(db, {
        ...base,
        eventType: "token_ledger",
        payload: {
          rawContextTokens: 120,
          cachedTokens: 30,
          totalTokens: 300,
          modelId: "qwen3.7-plus",
        },
      }),
      recordEfficiencyEvent(db, {
        ...base,
        eventType: "operator_question",
        payload: {
          questionText: "Did we already search memory?",
          memoryHits: ["mem-1"],
          priorAnswerMatch: false,
        },
      }),
      recordEfficiencyEvent(db, {
        ...base,
        eventType: "memory_write",
        payload: {
          source: "agent_memory",
          firstSeenAt: "2026-06-27T13:19:00.000Z",
          dedupHash: "dedup-1",
          isRediscovery: false,
        },
      }),
    ];

    expect(inserted.map((event) => event.eventType)).toEqual([
      "retrieval_trace",
      "source_read",
      "token_ledger",
      "operator_question",
      "memory_write",
    ]);

    const rows = listEfficiencyEvents(db, { taskId: "task-1", limit: 10 });
    expect(rows).toHaveLength(5);
    expect(rows.map((event) => event.eventType).sort()).toEqual(
      [
        "memory_write",
        "operator_question",
        "retrieval_trace",
        "source_read",
        "token_ledger",
      ] satisfies EfficiencyEventType[]
    );
    expect(rows.find((event) => event.eventType === "retrieval_trace")?.payload).toMatchObject({
      query: "Phase 117 telemetry",
      usedInFirstResponse: true,
    });
  });

  it("filters by tenant, event type, task, since timestamp, and limit", () => {
    db.prepare("INSERT INTO tenants (id, name) VALUES (?, ?)").run("other-tenant", "Other Tenant");

    recordEfficiencyEvent(db, {
      tenantId: "default-tenant",
      eventType: "source_read",
      taskId: "task-a",
      payload: { sourceId: "a", sourceHash: "hash-a", toolId: "read" },
      createdAt: "2026-06-27T13:00:00.000Z",
    });
    recordEfficiencyEvent(db, {
      tenantId: "default-tenant",
      eventType: "source_read",
      taskId: "task-a",
      payload: { sourceId: "b", sourceHash: "hash-b", toolId: "read" },
      createdAt: "2026-06-27T14:00:00.000Z",
    });
    recordEfficiencyEvent(db, {
      tenantId: "other-tenant",
      eventType: "source_read",
      taskId: "task-a",
      payload: { sourceId: "c", sourceHash: "hash-c", toolId: "read" },
      createdAt: "2026-06-27T15:00:00.000Z",
    });
    recordEfficiencyEvent(db, {
      tenantId: "default-tenant",
      eventType: "memory_write",
      taskId: "task-a",
      payload: {
        source: "ingest",
        firstSeenAt: "2026-06-27T15:00:00.000Z",
        dedupHash: "hash-d",
        isRediscovery: true,
      },
      createdAt: "2026-06-27T15:00:00.000Z",
    });

    const rows = listEfficiencyEvents(db, {
      eventType: "source_read",
      taskId: "task-a",
      since: "2026-06-27T13:30:00.000Z",
      limit: 1,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: "default-tenant",
      eventType: "source_read",
      taskId: "task-a",
      createdAt: "2026-06-27T14:00:00Z",
      payload: { sourceId: "b", sourceHash: "hash-b" },
    });
  });

  it("rejects invalid event types before writing", () => {
    expect(() =>
      recordEfficiencyEvent(db, {
        eventType: "not_real",
        payload: {},
      } as never)
    ).toThrow(/Invalid efficiency event type/);

    expect(
      db.prepare("SELECT COUNT(*) AS count FROM efficiency_events").get()
    ).toEqual({ count: 0 });
  });

  it("aggregates token_ledger events into model-usage shape", () => {
    recordEfficiencyEvent(db, {
      eventType: "token_ledger",
      agentId: "maeve",
      payload: {
        modelId: "MiniMax-M3",
        rawContextTokens: 1000,
        cachedTokens: 400,
        totalTokens: 1400,
      },
      createdAt: "2026-07-17T01:00:00.000Z",
    });
    recordEfficiencyEvent(db, {
      eventType: "token_ledger",
      agentId: "codex",
      payload: {
        modelId: "MiniMax-M3",
        rawContextTokens: 500,
        cachedTokens: 100,
        totalTokens: 600,
      },
      createdAt: "2026-07-17T02:00:00.000Z",
    });
    recordEfficiencyEvent(db, {
      eventType: "token_ledger",
      agentId: "codex",
      payload: {
        modelId: "gpt-5",
        rawContextTokens: 200,
        cachedTokens: 50,
        totalTokens: 250,
      },
      createdAt: "2026-07-17T03:00:00.000Z",
    });

    const usage = aggregateEfficiencyTokenLedger(db);
    expect(usage.models).toHaveLength(2);
    const mini = usage.models.find((m) => m.id === "MiniMax-M3");
    expect(mini).toMatchObject({
      inputTokens: 1500,
      cacheRead: 500,
      totalTokens: 2000,
      requests: 2,
    });
    expect(usage.total.requests).toBe(3);
    expect(usage.total.totalTokens ?? usage.total.inputTokens + usage.total.cacheRead).toBeGreaterThan(0);

    const merged = mergeModelUsageSources(
      {
        models: [
          {
            id: "MiniMax-M3",
            name: "MiniMax-M3",
            inputTokens: 10,
            outputTokens: 5,
            cacheRead: 0,
            cacheCreation: 0,
            requests: 1,
            totalTokens: 15,
          },
        ],
        total: { inputTokens: 10, outputTokens: 5, cacheRead: 0, cacheCreation: 0, requests: 1 },
      },
      usage
    );
    expect(merged.models.find((m) => m.id === "MiniMax-M3")?.requests).toBe(3);
  });

  it("throws when stored event payload JSON is corrupt", () => {
    recordEfficiencyEvent(db, {
      eventType: "source_read",
      taskId: "task-bad",
      payload: { sourceId: "a", sourceHash: "h" },
    });
    db.prepare("UPDATE efficiency_events SET payload = ? WHERE task_id = ?").run("not-json", "task-bad");
    expect(() => listEfficiencyEvents(db, { taskId: "task-bad", limit: 5 })).toThrow(
      /Invalid efficiency event payload JSON/
    );
  });

  it("skips corrupt token_ledger payloads and zero-token rows when aggregating", () => {
    recordEfficiencyEvent(db, {
      eventType: "token_ledger",
      payload: { modelId: "empty-model", rawContextTokens: 0, cachedTokens: 0, totalTokens: 0 },
    });
    db.prepare(
      `INSERT INTO efficiency_events (tenant_id, event_type, task_id, agent_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("default-tenant", "token_ledger", "t", "a", "{not-json", new Date().toISOString());
    expect(aggregateEfficiencyTokenLedger(db).models).toEqual([]);
  });
});
