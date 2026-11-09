// @vitest-environment node
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";
import { pollAllAdapters } from "../poller";
import type { BusinessSystemAdapter } from "../adapter-interface";

describe("pollAllAdapters", () => {
  it("records adapter poll failures and write failures", async () => {
    const db = new Database(":memory:");
    initSchema(db);

    const failing: BusinessSystemAdapter = {
      name: "fail-adapter",
      category: "crm",
      poll: vi.fn(async () => {
        throw new Error("poll exploded");
      }),
    };

    const pollSummary = await pollAllAdapters([failing], db);
    expect(pollSummary.errors.some((entry) => entry.includes("poll exploded"))).toBe(true);
    expect(pollSummary.adapterResults[0]?.error).toContain("poll exploded");

    const writing: BusinessSystemAdapter = {
      name: "write-adapter",
      category: "crm",
      poll: vi.fn(async () => [
        {
          tenantId: "default-tenant",
          correlationId: "corr-1",
          sourceSystem: "test",
          adapter: "write-adapter",
          eventType: "deal.updated",
          kpiValue: 1,
          kpiKey: "amount",
          rawJson: "{}",
          polledAt: new Date().toISOString(),
        },
      ]),
    };

    const brokenDb = {
      prepare: () => {
        throw new Error("write exploded");
      },
      transaction: (fn: (rows: unknown[]) => number) => fn,
    } as unknown as Database.Database;

    const writeSummary = await pollAllAdapters([writing], brokenDb);
    expect(writeSummary.errors.some((entry) => entry.includes("write exploded"))).toBe(true);

    const okAdapter: BusinessSystemAdapter = {
      name: "ok-adapter",
      category: "crm",
      poll: vi.fn(async () => [
        {
          tenantId: "default-tenant",
          correlationId: "corr-2",
          sourceSystem: "test",
          adapter: "ok-adapter",
          eventType: "deal.updated",
          kpiValue: 2,
          kpiKey: "amount",
          rawJson: "{}",
          polledAt: new Date().toISOString(),
        },
      ]),
    };
    const okSummary = await pollAllAdapters([okAdapter], db);
    expect(okSummary.adapterResults[0]?.eventsPolled).toBe(1);
    expect(okSummary.adapterResults[0]?.error).toBeNull();
    expect(okSummary.errors).toHaveLength(0);
    db.close();
  });
});
