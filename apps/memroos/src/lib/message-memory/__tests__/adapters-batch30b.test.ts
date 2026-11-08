// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { normalizeDiscordMessage, normalizeSlackEvent } from "../adapters";

describe("message-memory adapters batch30b — timestamp and workspace branches", () => {
  it("isoFromDiscordTimestamp falls back when timestamp missing or invalid (lines 52, 58)", () => {
    const guild = `g-${randomUUID().slice(0, 6)}`;
    const missing = normalizeDiscordMessage({
      id: "m1",
      guild_id: guild,
      channel_id: "c1",
      author: { id: "u1" },
    });
    expect(missing?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const invalid = normalizeDiscordMessage({
      id: "m2",
      guild_id: guild,
      channel_id: "c1",
      author: { id: "u1" },
      timestamp: "not-a-date",
    });
    expect(invalid?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("normalizeSlackEvent resolves workspace from authorizations (lines 100–102)", () => {
    const normalized = normalizeSlackEvent({
      authorizations: [{ team_id: `T-b30b-${randomUUID().slice(0, 6)}` }],
      event: {
        type: "message",
        channel: "C1",
        bot_id: "B-batch30b",
        text: "hello slack batch30b",
        ts: "not-finite",
      },
    });
    expect(normalized?.workspaceId).toMatch(/^T-b30b-/);
    expect(normalized?.author.isBot).toBe(true);
    expect(normalized?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("normalizeSlackEvent rejects incomplete workspace/channel/ts tuples", () => {
    expect(
      normalizeSlackEvent({
        team_id: "T1",
        event: { type: "message", channel: "", ts: "1.0" },
      }),
    ).toBeNull();
  });
});
