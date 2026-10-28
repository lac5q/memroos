// @vitest-environment node
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as wikiDigest from "@/lib/wiki-digest";
import { WIKI_DIGEST_CRON_ID } from "@/lib/wiki-digest";
import {
  runScheduledWikiDigest,
  startWikiDigestScheduler,
  stopWikiDigestScheduler,
} from "@/lib/wiki-digest-scheduler";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

beforeEach(() => {
  stopWikiDigestScheduler();
});

afterEach(() => {
  stopWikiDigestScheduler();
  vi.restoreAllMocks();
});

describe("wiki-digest-scheduler batch20c", () => {
  it("runScheduledWikiDigest skips when cron job is paused", async () => {
    const { ensureDefaultCronJobs } = await import("@/lib/cron-health");
    ensureDefaultCronJobs(testDb);
    testDb.prepare(`UPDATE cron_health_jobs SET status = ? WHERE id = ?`).run("paused", WIKI_DIGEST_CRON_ID);
    const result = await runScheduledWikiDigest({ dryRun: true });
    expect(result).toEqual({ status: "skipped", reason: "cron_paused_or_stopped" });
  });

  it("startWikiDigestScheduler registers interval once", () => {
    const intervalSpy = vi.spyOn(global, "setInterval").mockReturnValue({ unref: vi.fn() } as never);
    startWikiDigestScheduler();
    startWikiDigestScheduler();
    expect(intervalSpy).toHaveBeenCalledTimes(1);
    intervalSpy.mockRestore();
    stopWikiDigestScheduler();
  });
});
