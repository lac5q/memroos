// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import {
  generateMockTransactions,
  normalizeWebhookTransaction,
  parseTransactionCsv,
  processReconciliationEvents,
  validateFinanceGoldenSetExamples,
} from "../index";

describe("finance-reconciliation batch20b", () => {
  it("normalizeWebhookTransaction generates ids when transaction_id is missing", () => {
    const event = normalizeWebhookTransaction({ amount: 10, expected_amount: 10, status: "matched" });
    expect(event.transactionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(event.status).toBe("matched");
  });

  it("parseTransactionCsv assigns source_row_id for data rows", () => {
    const csv = ["transaction_id,amount,expected_amount,status,occurred_at", "txn-b20b,5,5,matched,2026-07-10T00:00:00.000Z"].join(
      "\n",
    );
    const events = parseTransactionCsv(csv);
    expect(events[0]?.sourceRowId).toBe("csv-row-2");
  });

  it("processReconciliationEvents escalates mismatched rows by default", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const summary = processReconciliationEvents(
      [
        {
          transactionId: "txn-mismatch-b20b",
          correlationId: "corr-mismatch-b20b",
          tenantId: "default-tenant",
          amount: 10,
          expectedAmount: 20,
          status: "mismatched",
          confidence: 0.4,
          occurredAt: "2026-07-10T00:00:00.000Z",
          raw: {},
        },
      ],
      db,
    );
    expect(summary.mismatched).toBe(1);
    expect(summary.hilEscalations).toBe(1);
    db.close();
  });

  it("processReconciliationEvents skips HIL when openHilForExceptions is false", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const summary = processReconciliationEvents(
      [
        {
          transactionId: "txn-exc-b20b",
          correlationId: "corr-exc-b20b",
          tenantId: "default-tenant",
          amount: 1,
          expectedAmount: 1,
          status: "exception",
          confidence: 0.2,
          occurredAt: "2026-07-10T00:00:00.000Z",
          raw: {},
        },
      ],
      db,
      { openHilForExceptions: false },
    );
    expect(summary.exceptions).toBe(1);
    expect(summary.hilEscalations).toBe(0);
    db.close();
  });

  it("validateFinanceGoldenSetExamples requires match, mismatch, and escalation tags", () => {
    const incomplete = validateFinanceGoldenSetExamples([{ tags: ["match"], humanScore: 1 }]);
    expect(incomplete.ok).toBe(false);
    const complete = validateFinanceGoldenSetExamples([
      { tags: ["match"], humanScore: 1 },
      { tags: ["mismatch"], humanScore: 0.5 },
      { tags: ["escalation"], humanScore: 0.2 },
    ]);
    expect(complete.ok).toBe(true);
  });

  it("generateMockTransactions produces deterministic status mix", () => {
    const events = generateMockTransactions(50);
    expect(events).toHaveLength(50);
    expect(events.some((e) => e.status === "matched")).toBe(true);
    expect(events.some((e) => e.status === "mismatched")).toBe(true);
  });
});
