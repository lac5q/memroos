// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  discordMessageMemoryAdapter,
  normalizeDiscordMessage,
  normalizeSlackEvent,
  slackMessageMemoryAdapter,
} from "../adapters";

describe("message-memory platform adapters", () => {
  it("normalizes Discord messages with guild, channel, and author", () => {
    const msg = normalizeDiscordMessage({
      id: "m1",
      guild_id: "G1",
      channel_id: "C1",
      content: "hello discord",
      timestamp: "2026-07-01T12:00:00.000Z",
      author: { id: "U1", username: "alice", bot: false },
      jump_url: "https://discord.com/channels/G1/C1/m1",
    });
    expect(msg?.provider).toBe("discord");
    expect(msg?.messageId).toBe("m1");
    expect(msg?.permalink).toContain("discord.com");
    expect(discordMessageMemoryAdapter.normalize({})).toBeNull();
  });

  it("returns null when Discord payload lacks required ids", () => {
    expect(normalizeDiscordMessage({ id: "m1", channel_id: "C1" })).toBeNull();
  });

  it("normalizes Slack message events with team and channel", () => {
    const msg = normalizeSlackEvent({
      team_id: "T1",
      event: {
        type: "message",
        channel: "C1",
        user: "U1",
        text: "hello slack",
        ts: "1710000000.1234",
        thread_ts: "1710000000.0000",
      },
    });
    expect(msg?.provider).toBe("slack");
    expect(msg?.threadId).toBe("1710000000.0000");
    expect(slackMessageMemoryAdapter.supportsThreads).toBe(true);
  });

  it("ignores non-message Slack events", () => {
    expect(
      normalizeSlackEvent({
        team_id: "T1",
        event: { type: "reaction_added", channel: "C1", ts: "1.0" },
      })
    ).toBeNull();
  });
});
