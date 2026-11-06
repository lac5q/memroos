// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  normalizeWebhookTransaction,
  parseTransactionCsv,
  processReconciliationEvents,
} from "../index";

describe("finance-reconciliation batch19", () => {
  it("parseTransactionCsv parses quoted commas and normalizes headers", () => {
    const csv = [
      "Transaction ID,Expected Amount,Status,Occurred At",
      '"txn-b19,quoted",100,mismatched,2026-07-10T00:00:00.000Z',
    ].join("\n");
    const events = parseTransactionCsv(csv);
    expect(events).toHaveLength(1);
    expect(events[0]?.transactionId).toBe("txn-b19,quoted");
    expect(events[0]?.status).toBe("mismatched");
  });

  it("normalizeWebhookTransaction coerces unknown status values to exception", () => {
    const event = normalizeWebhookTransaction({
      transaction_id: "txn-unknown-status",
      amount: 10,
      expected_amount: 10,
      status: "mystery-status",
      occurred_at: "2026-07-10T00:00:00.000Z",
    });
    expect(event.status).toBe("exception");
  });

  it("processReconciliationEvents records duplicate rows without HIL by default", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const summary = processReconciliationEvents(
      [
        {
          transactionId: "txn-dup-b19",
          correlationId: "corr-dup-b19",
          tenantId: "default-tenant",
          amount: 50,
          expectedAmount: 50,
          status: "duplicate",
          confidence: 0.95,
          occurredAt: "2026-07-10T00:00:00.000Z",
          raw: {},
        },
      ],
      db,
    );
    expect(summary.duplicates).toBe(1);
    expect(summary.hilEscalations).toBe(0);
    db.close();
  });

  it("processReconciliationEvents writes outcome events for matched rows", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const summary = processReconciliationEvents(
      [
        {
          transactionId: "txn-match-b19",
          correlationId: "corr-match-b19",
          tenantId: "default-tenant",
          amount: 42,
          expectedAmount: 42,
          status: "matched",
          confidence: 0.99,
          occurredAt: "2026-07-10T00:00:00.000Z",
          raw: {},
        },
      ],
      db,
    );
    expect(summary.matched).toBe(1);
    expect(summary.outcomeEvents).toBeGreaterThan(0);
    db.close();
  });
});
