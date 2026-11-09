// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as retentionExpiry from "@/lib/memory/retention-expiry";
import {
  startRetentionExpiryScheduler,
  stopRetentionExpiryScheduler,
} from "@/lib/memory-retention-expiry-scheduler";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

beforeEach(() => {
  stopRetentionExpiryScheduler();
});

afterEach(() => {
  stopRetentionExpiryScheduler();
  vi.restoreAllMocks();
});

describe("memory-retention-expiry-scheduler batch32 — failed tick catch paths", () => {
  it("logs initial tick failure without throwing from startRetentionExpiryScheduler (104)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(retentionExpiry, "runRetentionExpiry").mockImplementation(() => {
      throw new Error("retention-b32-boom");
    });
    const intervalSpy = vi.spyOn(global, "setInterval").mockReturnValue({ unref: vi.fn() } as never);

    expect(() => startRetentionExpiryScheduler()).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      "[retention-expiry] initial tick failed",
      expect.any(Error),
    );
    expect(intervalSpy).toHaveBeenCalledTimes(1);
  });

  it("logs interval tick failure when runScheduledRetentionExpiry throws (110)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(retentionExpiry, "runRetentionExpiry").mockImplementation(() => {
      throw new Error("retention-tick-b32");
    });

    let tick: (() => void) | undefined;
    vi.spyOn(global, "setInterval").mockImplementation((fn) => {
      tick = fn as () => void;
      return { unref: vi.fn() } as never;
    });

    startRetentionExpiryScheduler();
    expect(tick).toBeTypeOf("function");
    tick?.();

    expect(errorSpy).toHaveBeenCalledWith(
      "[retention-expiry] tick failed",
      expect.any(Error),
    );
  });
});
