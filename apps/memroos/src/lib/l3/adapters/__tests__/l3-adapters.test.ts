// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHubSpotAdapter } from "../hubspot";
import { createIntercomAdapter } from "../intercom";
import { createNetSuiteAdapter } from "../netsuite";
import { createQuickBooksAdapter } from "../quickbooks";
import { createSalesforceAdapter } from "../salesforce";
import { createZendeskAdapter } from "../zendesk";

describe("L3 adapters — mock fixtures", () => {
  const since = new Date("2026-06-01T12:00:00.000Z");

  it("quickbooks mock returns finance events", async () => {
    const adapter = createQuickBooksAdapter({ mock: true });
    const events = await adapter.poll(since);
    expect(adapter.name).toBe("quickbooks");
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((e) => e.sourceSystem === "finance")).toBe(true);
  });

  it("intercom mock returns helpdesk events", async () => {
    const events = await createIntercomAdapter({ mock: true }).poll(since);
    expect(events.some((e) => e.eventType === "conversation_resolved")).toBe(true);
  });

  it("hubspot mock returns crm events", async () => {
    const events = await createHubSpotAdapter({ mock: true }).poll(since);
    expect(events.some((e) => e.eventType === "deal_advance")).toBe(true);
  });

  it("fixture adapters return stable shapes in non-production", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      for (const create of [
        createZendeskAdapter,
        createSalesforceAdapter,
        createNetSuiteAdapter,
      ]) {
        const adapter = create();
        const events = await adapter.poll(since);
        expect(events.length).toBeGreaterThan(0);
        expect(events[0]?.polledAt).toBe(since.toISOString());
      }
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("fixture zendesk adapter exposes helpdesk category", () => {
    const adapter = createZendeskAdapter();
    expect(adapter.category).toBe("helpdesk");
    expect(adapter.name).toBe("zendesk");
  });
});

describe("L3 adapters — live fetch paths (mocked fetch)", () => {
  const since = new Date("2026-06-01T12:00:00.000Z");
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.INTERCOM_ACCESS_TOKEN;
    delete process.env.HUBSPOT_ACCESS_TOKEN;
    delete process.env.QUICKBOOKS_CLIENT_ID;
    delete process.env.QUICKBOOKS_CLIENT_SECRET;
    delete process.env.QUICKBOOKS_REFRESH_TOKEN;
    delete process.env.QUICKBOOKS_REALM_ID;
  });

  it("intercom returns empty when token missing", async () => {
    const events = await createIntercomAdapter({ mock: false }).poll(since);
    expect(events).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("intercom maps conversations with correlation id", async () => {
    process.env.INTERCOM_ACCESS_TOKEN = "tok";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        conversations: [
          {
            id: "c1",
            state: "closed",
            open: false,
            waiting_since: null,
            snoozed_until: null,
            custom_attributes: { memroos_correlation_id: "corr-intercom" },
            conversation_rating: { rating: 5 },
            tags: { tags: [] },
            statistics: { time_to_first_close: 30 },
          },
        ],
      }),
    });

    const events = await createIntercomAdapter({ mock: false }).poll(since);
    expect(events.some((e) => e.correlationId === "corr-intercom")).toBe(true);
    expect(events.some((e) => e.eventType === "csat_rating")).toBe(true);
  });

  it("hubspot maps closed-won deals", async () => {
    process.env.HUBSPOT_ACCESS_TOKEN = "tok";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            id: "d1",
            properties: {
              memroos_correlation_id: "corr-hs",
              dealstage: "closedwon",
            },
          },
        ],
      }),
    });

    const events = await createHubSpotAdapter({ mock: false }).poll(since);
    expect(events.filter((e) => e.correlationId === "corr-hs").length).toBeGreaterThan(0);
    expect(events.some((e) => e.eventType === "lead_disposition")).toBe(true);
  });

  it("quickbooks returns empty when realm id missing", async () => {
    process.env.QUICKBOOKS_CLIENT_ID = "id";
    process.env.QUICKBOOKS_CLIENT_SECRET = "secret";
    process.env.QUICKBOOKS_REFRESH_TOKEN = "refresh";
    const events = await createQuickBooksAdapter({ mock: false }).poll(since);
    expect(events).toEqual([]);
  });

  it("quickbooks maps paid invoices from query response", async () => {
    process.env.QUICKBOOKS_CLIENT_ID = "id";
    process.env.QUICKBOOKS_CLIENT_SECRET = "secret";
    process.env.QUICKBOOKS_REFRESH_TOKEN = "refresh";
    process.env.QUICKBOOKS_REALM_ID = "realm-1";

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "access" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          QueryResponse: {
            Invoice: [
              {
                Id: "inv-1",
                Balance: 0,
                TotalAmt: 100,
                CustomField: [{ Name: "memroos_correlation_id", StringValue: "corr-qbo" }],
                MetaData: { LastUpdatedTime: "2026-06-02T00:00:00Z" },
              },
            ],
          },
        }),
      });

    const events = await createQuickBooksAdapter({ mock: false }).poll(since);
    expect(events.some((e) => e.correlationId === "corr-qbo" && e.eventType === "payment_reconciled")).toBe(
      true,
    );
  });
});
