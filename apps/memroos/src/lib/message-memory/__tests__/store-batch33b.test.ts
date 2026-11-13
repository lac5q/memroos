// @vitest-environment node
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { discordMessageMemoryAdapter } from "@/lib/message-memory";
import {
  ensureMessageMemorySchema,
  getMessageMemoryRecordByDedupeKey,
  ingestPlatformMessageMemory,
} from "@/lib/message-memory/store";

describe("message-memory store batch33b", () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  it("parseObject returns {} for malformed metadata JSON (35)", () => {
    db = new Database(":memory:");
    initSchema(db);
    ensureMessageMemorySchema(db);
    const dedupeKey = `dedupe-b33b-${randomUUID()}`;
    db.prepare(
      `INSERT INTO platform_message_memory (
         id, dedupe_key, provider, workspace_id, channel_id, provider_message_id,
         author_id, content, content_hash, message_timestamp, metadata, created_at, updated_at
       ) VALUES (?, ?, 'discord', 'w', 'c', 'm', 'a', 'body', 'hash', datetime('now'), ?, datetime('now'), datetime('now'))`,
    ).run(`pmm-b33b-${randomUUID()}`, dedupeKey, "{not-json-batch33b");

    const record = getMessageMemoryRecordByDedupeKey(db, dedupeKey);
    expect(record?.metadata).toEqual({});
  });

  it("ingestPlatformMessageMemory returns a persisted record (176)", () => {
    db = new Database(":memory:");
    initSchema(db);
    const normalized = discordMessageMemoryAdapter.normalize({
      id: randomUUID(),
      guild_id: "guild-b33b",
      channel_id: "channel-b33b",
      content: "batch33b ingest",
      timestamp: "2026-11-10T12:00:00.000Z",
      author: { id: "author-b33b", username: "batch33b" },
    });
    expect(normalized).not.toBeNull();
    const result = ingestPlatformMessageMemory(db, normalized!);
    expect(result.created).toBe(true);
    expect(result.record.content).toContain("batch33b ingest");
  });
});
