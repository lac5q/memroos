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

describe("/api/l3/events batch28 — auth, dedupe, limit cap", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/db");
    authorizeRegistryWriteMock.mockReturnValue(true);
  });

  it("POST returns 403 when registry write auth fails", async () => {
    authorizeRegistryWriteMock.mockReturnValue(false);
    const { POST } = await import("../route");
    const res = await POST(
      new Request(`${LOOPBACK}/api/l3/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          correlationId: "c-batch28",
          sourceSystem: "crm",
          adapter: "hubspot",
          eventType: "deal_won",
          kpiKey: "revenue",
        }),
      }) as never,
    );
    expect(res.status).toBe(403);
  });

  it("POST reports inserted=false for duplicate correlation rows", async () => {
    const testDb = new Database(":memory:");
    initSchema(testDb);
    vi.doMock("@/lib/db", () => ({
      getDb: () => testDb,
      closeDb: () => testDb.close(),
    }));
    const polledAt = "2026-06-15T12:00:00.000Z";
    const payload = {
      correlationId: "dup-batch28",
      sourceSystem: "crm",
      adapter: "hubspot",
      eventType: "deal_won",
      kpiKey: "revenue",
      kpiValue: 42,
      polledAt,
    };
    const { POST } = await import("../route");
    const first = await POST(
      new Request(`${LOOPBACK}/api/l3/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }) as never,
    );
    expect((await first.json()).inserted).toBe(true);

    vi.resetModules();
    authorizeRegistryWriteMock.mockReturnValue(true);
    vi.doMock("@/lib/db", () => ({
      getDb: () => testDb,
      closeDb: () => testDb.close(),
    }));
    const { POST: POST2 } = await import("../route");
    const second = await POST2(
      new Request(`${LOOPBACK}/api/l3/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }) as never,
    );
    expect((await second.json()).inserted).toBe(false);
    testDb.close();
  });

  it("GET caps limit query param at 200 rows", async () => {
    const testDb = new Database(":memory:");
    initSchema(testDb);
    const insert = testDb.prepare(
      `INSERT INTO business_outcome_events
         (tenant_id, correlation_id, source_system, adapter, event_type, kpi_key, kpi_value, raw_json, agent_id, polled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (let i = 0; i < 205; i++) {
      insert.run(
        "default-tenant",
        `corr-${i}`,
        "crm",
        "hubspot",
        "evt",
        "kpi",
        1,
        "{}",
        null,
        new Date(Date.UTC(2026, 5, 1, 12, i % 60)).toISOString(),
      );
    }
    vi.doMock("@/lib/db", () => ({
      getDb: () => testDb,
      closeDb: () => testDb.close(),
    }));
    const { GET } = await import("../route");
    const res = await GET(new Request(`${LOOPBACK}/api/l3/events?limit=999`) as never);
    const body = await res.json();
    expect(body.count).toBe(200);
    testDb.close();
  });
});
