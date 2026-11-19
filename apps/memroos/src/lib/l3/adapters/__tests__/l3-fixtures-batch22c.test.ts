// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createNetSuiteAdapter } from "../netsuite";
import { createSalesforceAdapter } from "../salesforce";
import { createZendeskAdapter } from "../zendesk";

describe("L3 fixture adapters batch22c — fixture payloads", () => {
  const since = new Date("2026-06-01T12:00:00.000Z");

  it("netsuite returns finance transaction and reconciliation events", async () => {
    const events = await createNetSuiteAdapter().poll(since);
    expect(events.map((e) => e.eventType)).toEqual(["transaction_posted", "payment_reconciled"]);
    expect(events.every((e) => e.adapter === "netsuite")).toBe(true);
  });

  it("salesforce returns CRM opportunity and lead events", async () => {
    const events = await createSalesforceAdapter().poll(since);
    expect(events.some((e) => e.eventType === "opportunity_closed")).toBe(true);
    expect(events.some((e) => e.eventType === "lead_converted")).toBe(true);
  });

  it("zendesk returns helpdesk solved, csat, and escalation events", async () => {
    const events = await createZendeskAdapter().poll(since);
    expect(events.map((e) => e.eventType)).toEqual(["ticket_solved", "csat_rating", "escalation"]);
    expect(events.find((e) => e.eventType === "escalation")?.kpiValue).toBe(0);
  });
});
