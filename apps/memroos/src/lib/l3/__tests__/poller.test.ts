// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import type { BusinessSystemAdapter } from "../adapter-interface";
import type { BusinessOutcomeEvent } from "../types";
import { pollAllAdapters } from "../poller";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  initSchema(db);
  return db;
}

describe("pollAllAdapters", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    db.close();
  });

  it("writes polled events and deduplicates on retry", async () => {
    const since = new Date("2026-01-01T00:00:00.000Z");
    const event: BusinessOutcomeEvent = {
      tenantId: "default-tenant",
      correlationId: "corr-1",
      sourceSystem: "crm",
      adapter: "hubspot",
      eventType: "deal_advance",
      kpiKey: "completion_rate",
      kpiValue: 1,
      rawJson: "{}",
      polledAt: since.toISOString(),
    };

    const adapter: BusinessSystemAdapter = {
      name: "hubspot",
      category: "crm",
      poll: vi.fn(async () => [event]),
    };

    const first = await pollAllAdapters([adapter], db, since);
    expect(first.totalEventsWritten).toBe(1);
    expect(first.errors).toHaveLength(0);
    expect(first.adapterResults[0]?.eventsWritten).toBe(1);

    const second = await pollAllAdapters([adapter], db, since);
    expect(second.totalEventsWritten).toBe(0);
    expect(second.adapterResults[0]?.eventsWritten).toBe(0);
  });

  it("records adapter poll errors without throwing", async () => {
    const failing: BusinessSystemAdapter = {
      name: "broken",
      category: "crm",
      poll: async () => {
        throw new Error("poll boom");
      },
    };

    const summary = await pollAllAdapters([failing], db);
    expect(summary.totalEventsWritten).toBe(0);
    expect(summary.errors.some((e) => e.includes("poll boom"))).toBe(true);
    expect(summary.adapterResults[0]?.error).toContain("poll boom");
  });
});
