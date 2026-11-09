// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

const authorizeRegistryWriteMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/operator-auth", () => ({
  authorizeRegistryWrite: authorizeRegistryWriteMock,
  registryWriteUnauthorizedResponse: () =>
    Response.json({ ok: false, error: "Registry write authorization required" }, { status: 403 }),
}));

const { GET, POST } = await import("../route");

describe("/api/l3/events", () => {
  beforeEach(() => {
    testDb.prepare("DELETE FROM business_outcome_events").run();
    authorizeRegistryWriteMock.mockReturnValue(true);
  });

  it("GET lists events ordered by polled_at desc", async () => {
    const insert = testDb.prepare(
      `INSERT INTO business_outcome_events
       (tenant_id, correlation_id, source_system, adapter, event_type, kpi_key, kpi_value, raw_json, agent_id, polled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run(
      "default-tenant",
      "corr-1",
      "crm",
      "hubspot",
      "deal_won",
      "revenue",
      100,
      "{}",
      "agent-a",
      "2026-01-01T10:00:00.000Z"
    );
    insert.run(
      "default-tenant",
      "corr-2",
      "helpdesk",
      "intercom",
      "ticket_closed",
      "csat",
      5,
      "{}",
      "agent-b",
      "2026-01-02T10:00:00.000Z"
    );

    const req = new Request("http://localhost/api/l3/events?limit=10");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.events[0].correlationId).toBe("corr-2");
    expect(body.events[1].correlationId).toBe("corr-1");
  });

  it("GET filters by correlationId", async () => {
    testDb
      .prepare(
        `INSERT INTO business_outcome_events
         (tenant_id, correlation_id, source_system, adapter, event_type, kpi_key, kpi_value, raw_json, polled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run("default-tenant", "keep-me", "crm", "hubspot", "x", "k", 1, "{}", "2026-01-01T00:00:00.000Z");
    testDb
      .prepare(
        `INSERT INTO business_outcome_events
         (tenant_id, correlation_id, source_system, adapter, event_type, kpi_key, kpi_value, raw_json, polled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run("default-tenant", "drop-me", "crm", "hubspot", "x", "k", 1, "{}", "2026-01-01T00:00:00.000Z");

    const req = new Request("http://localhost/api/l3/events?correlationId=keep-me");
    const res = await GET(req as never);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.events[0].correlationId).toBe("keep-me");
  });

  it("POST returns 403 when registry write unauthorized", async () => {
    authorizeRegistryWriteMock.mockReturnValueOnce(false);
    const req = new Request("http://localhost/api/l3/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(403);
  });

  it("POST returns 400 when required fields missing", async () => {
    const req = new Request("http://localhost/api/l3/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correlationId: "only-one" }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("POST inserts a business outcome event", async () => {
    const req = new Request("http://localhost/api/l3/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correlationId: "corr-new",
        sourceSystem: "crm",
        adapter: "hubspot",
        eventType: "deal_created",
        kpiKey: "pipeline",
        kpiValue: 42,
      }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.inserted).toBe(true);

    const row = testDb
      .prepare("SELECT correlation_id FROM business_outcome_events WHERE correlation_id = ?")
      .get("corr-new") as { correlation_id: string };
    expect(row.correlation_id).toBe("corr-new");
  });
});
