// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";

import {
  addMemory,
  buildContextInjection,
  memoryTool,
  searchMemories,
} from "../memory-client";
import { normalizeDiscordMessage, normalizeSlackEvent } from "@/lib/message-memory/adapters";

const ROOT = path.join(os.tmpdir(), `memory-client-adapters-b22c-${crypto.randomUUID()}`);

afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe("memory-client + message-memory adapters batch22c", () => {
  it("readStore tolerates corrupt JSON and cosine handles empty token sets", () => {
    const root = path.join(ROOT, "corrupt");
    fs.mkdirSync(path.join(root, "memory"), { recursive: true });
    fs.writeFileSync(path.join(root, "memory", "store.json"), "{not-json", "utf8");
    expect(searchMemories(root, "anything", { threshold: 0 })).toEqual([]);
    addMemory(root, { content: "valid memory after corrupt read" });
    expect(searchMemories(root, "valid", { threshold: 0.01 }).length).toBe(1);
  });

  it("buildContextInjection stops at maxChars and memoryTool validates required fields", () => {
    const root = path.join(ROOT, "context");
    addMemory(root, { content: "First memory line for injection testing with enough tokens." });
    addMemory(root, { content: "Second memory line should not fit once maxChars is tiny." });
    const injection = buildContextInjection(root, "injection testing tokens", { maxChars: 40, limit: 5 });
    expect(injection.text.length).toBeLessThanOrEqual(40);
    expect(memoryTool(root, { action: "add" })).toEqual({ ok: false, error: "content is required" });
    expect(memoryTool(root, { action: "replace", id: "missing", content: "" })).toEqual({
      ok: false,
      error: "id and content are required",
    });
  });

  it("normalizeDiscordMessage and normalizeSlackEvent handle invalid timestamps and missing authors", () => {
    expect(
      normalizeDiscordMessage({
        id: "d1",
        channel_id: "c1",
        guild_id: "g1",
        author: { id: "u1" },
        timestamp: "not-a-date",
      }).timestamp,
    ).toMatch(/^\d{4}-/);

    expect(
      normalizeSlackEvent({
        team_id: "T1",
        event: {
          type: "message",
          channel: "C1",
          ts: "not-a-ts",
          user: "U1",
        },
      })?.timestamp,
    ).toMatch(/^\d{4}-/);

    expect(
      normalizeDiscordMessage({
        id: "d2",
        channel_id: "c2",
        guild_id: "g2",
        author: {},
      }),
    ).toBeNull();

    expect(
      normalizeSlackEvent({
        authorizations: [{ team_id: "T-auth" }],
        event: { type: "message", channel: "C2", ts: "1700000000.000100" },
      }),
    ).toBeNull();
  });
});
