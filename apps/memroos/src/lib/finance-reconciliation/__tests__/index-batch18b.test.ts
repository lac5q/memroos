// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { buildDefaultEvalConfig } from "@/lib/evals/config";
import {
  generateMockTransactions,
  processReconciliationEvents,
  resolveFinanceTerminology,
  validateFinanceGoldenSetExamples,
} from "../index";

describe("finance-reconciliation batch18b", () => {
  it("processReconciliationEvents opens HIL escalations for mismatched rows", () => {
    const db = new Database(":memory:");
    initSchema(db);
    const summary = processReconciliationEvents(
      [
        {
          transactionId: "txn-mismatch-b18b",
          correlationId: "corr-b18b",
          tenantId: "default-tenant",
          amount: 100,
          expectedAmount: 90,
          status: "mismatched",
          confidence: 0.4,
          occurredAt: "2026-07-10T00:00:00.000Z",
          raw: {},
        },
      ],
      db,
      { openHilForExceptions: true },
    );
    expect(summary.mismatched).toBe(1);
    expect(summary.hilEscalations).toBe(1);
    db.close();
  });

  it("validateFinanceGoldenSetExamples requires match/mismatch/escalation tags", () => {
    const ok = validateFinanceGoldenSetExamples([
      { tags: ["match"], humanScore: 1 },
      { tags: ["mismatch"], humanScore: 0 },
      { tags: ["escalation"], humanScore: 0 },
    ]);
    expect(ok.ok).toBe(true);
    expect(ok.agreementFloor).toBe(0.85);
  });

  it("generateMockTransactions includes duplicate and exception statuses", () => {
    const events = generateMockTransactions(50);
    expect(events.some((e) => e.status === "duplicate")).toBe(true);
    expect(events.some((e) => e.status === "exception")).toBe(true);
  });

  it("resolveFinanceTerminology exposes stable vocabulary keys when finance eval is enabled", () => {
    const config = buildDefaultEvalConfig();
    config.finance = {
      enabled: true,
      transactionLabel: "transaction",
      reconciliationLabel: "reconciliation",
      exceptionLabel: "exception",
    };
    const terms = resolveFinanceTerminology(config);
    expect(terms.enabled).toBe(true);
    expect(terms.trace).toBe("transaction");
  });
});
