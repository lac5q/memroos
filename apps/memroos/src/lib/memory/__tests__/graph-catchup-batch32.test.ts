// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { runGraphCatchup } from "../graph-catchup";

describe("graph-catchup batch32 — defaultLog wiring", () => {
  let testDb: Database.Database;

  beforeEach(() => {
    testDb = new Database(":memory:");
    initSchema(testDb);
  });

  afterEach(() => {
    testDb.close();
    delete process.env.NEO4J_PASSWORD;
    vi.restoreAllMocks();
  });

  // sticky: defaultLog one-argument branch (line 121) — all bundled log() calls pass an extra payload.

  it("runGraphCatchup uses injected log hook without breaking dry-run vector paging", async () => {
    process.env.NEO4J_PASSWORD = "neo4j-b32";
    const messages: string[] = [];
    await runGraphCatchup(testDb, {
      skipEpisodic: true,
      oneshot: true,
      batchSize: 1,
      dryRun: true,
      log: (message, extra) => {
        messages.push(extra ? `${message}:${Object.keys(extra).join(",")}` : message);
      },
      fetchVectorPage: async () => ({
        items: [{ id: `v-b32-${randomUUID().slice(0, 6)}`, memory: "batch32 vector", created_at: "2026-03-01T09:00:00.000Z" }],
        nextCursor: null,
      }),
      now: new Date("2026-03-01T12:00:00.000Z"),
    });
    expect(messages.some((line) => line.startsWith("vector page:"))).toBe(true);
    expect(messages.some((line) => line.startsWith("complete:"))).toBe(true);
  });
});
