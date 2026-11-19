// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseTransactionCsv } from "../index";

describe("finance-reconciliation batch21 — CSV quoting", () => {
  it("parseTransactionCsv preserves escaped quotes inside quoted cells", () => {
    const csv = [
      "transaction_id,amount,expected_amount,status,occurred_at,reason",
      'txn-b21,"10","10","matched","2026-07-10T00:00:00.000Z","said ""ok"""',
    ].join("\n");
    const events = parseTransactionCsv(csv);
    expect(events).toHaveLength(1);
    expect(events[0]?.raw.reason).toBe('said "ok"');
    expect(events[0]?.transactionId).toBe("txn-b21");
  });
});
