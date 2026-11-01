// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const authorizeRegistryWriteMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: authorizeRegistryWriteMock,
  registryWriteUnauthorizedResponse: () =>
    Response.json({ ok: false, error: "Registry write authorization required" }, { status: 403 }),
}));

const LOOPBACK = "http://localhost";

describe("/api/l3/events batch23 — error branches", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/db");
  });

  it("GET returns 500 when the database throws", async () => {
    vi.doMock("@/lib/db", () => ({
      getDb: () => {
        throw new Error("db unavailable batch23");
      },
      closeDb: () => {},
    }));
    const { GET } = await import("../route");
    const res = await GET(new Request(`${LOOPBACK}/api/l3/events`) as never);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "db unavailable batch23" });
  });

  it("POST treats invalid JSON as missing required fields after auth", async () => {
    const testDb = new Database(":memory:");
    initSchema(testDb);
    vi.doMock("@/lib/db", () => ({
      getDb: () => testDb,
      closeDb: () => testDb.close(),
    }));
    authorizeRegistryWriteMock.mockReturnValue(true);
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/l3/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      }) as never
    );
    expect(res.status).toBe(400);
  });

  it("POST returns 500 when insert fails", async () => {
    const testDb = new Database(":memory:");
    initSchema(testDb);
    const broken = {
      prepare: () => {
        throw new Error("insert failed batch23");
      },
    };
    vi.doMock("@/lib/db", () => ({
      getDb: () => broken,
      closeDb: () => {},
    }));
    authorizeRegistryWriteMock.mockReturnValue(true);
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/l3/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          correlationId: "c-batch23",
          sourceSystem: "crm",
          adapter: "hubspot",
          eventType: "deal_won",
          kpiKey: "revenue",
        }),
      }) as never
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "insert failed batch23" });
  });

  it("GET applies since/until/agentId filters", async () => {
    const testDb = new Database(":memory:");
    initSchema(testDb);
    vi.doMock("@/lib/db", () => ({
      getDb: () => testDb,
      closeDb: () => testDb.close(),
    }));
    testDb
      .prepare(
        `INSERT INTO business_outcome_events
         (tenant_id, correlation_id, source_system, adapter, event_type, kpi_key, kpi_value, raw_json, agent_id, polled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "default-tenant",
        "in-window",
        "crm",
        "hubspot",
        "x",
        "k",
        1,
        "{}",
        "agent-z",
        "2026-06-01T12:00:00.000Z"
      );
    testDb
      .prepare(
        `INSERT INTO business_outcome_events
         (tenant_id, correlation_id, source_system, adapter, event_type, kpi_key, kpi_value, raw_json, agent_id, polled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "default-tenant",
        "out-window",
        "crm",
        "hubspot",
        "x",
        "k",
        1,
        "{}",
        "other-agent",
        "2026-01-01T00:00:00.000Z"
      );
    const { GET } = await import("../route");
    const res = await GET(
      new Request(
        `${LOOPBACK}/api/l3/events?agentId=agent-z&since=2026-06-01T00:00:00.000Z&until=2026-06-30T23:59:59.000Z`
      ) as never
    );
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.events[0].correlationId).toBe("in-window");
  });
});
