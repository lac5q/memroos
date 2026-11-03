// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  discordMessageMemoryAdapter,
  normalizeDiscordMessage,
  normalizeSlackEvent,
  slackMessageMemoryAdapter,
} from "../adapters";

describe("message-memory adapters batch20b", () => {
  it("normalizeDiscordMessage returns null when guild or channel is missing", () => {
    expect(
      normalizeDiscordMessage({
        id: "1",
        channel_id: "c1",
        author: { id: "u1" },
      }),
    ).toBeNull();
  });

  it("normalizeDiscordMessage maps attachments and bot authors", () => {
    const normalized = normalizeDiscordMessage({
      id: "d1",
      guild_id: "g1",
      channel_id: "c1",
      content: "hello discord",
      timestamp: "2026-07-01T12:00:00.000Z",
      author: { id: "bot-1", username: "bot", bot: true },
      attachments: [{ id: "a1", url: "http://localhost/file", filename: "f.txt", content_type: "text/plain" }],
      jump_url: "http://localhost/jump",
    });
    expect(normalized?.author.isBot).toBe(true);
    expect(normalized?.attachments[0]?.filename).toBe("f.txt");
    expect(discordMessageMemoryAdapter.normalize).toBe(normalizeDiscordMessage);
  });

  it("normalizeSlackEvent ignores non-message events", () => {
    expect(normalizeSlackEvent({ team_id: "T1", event: { type: "reaction_added", channel: "C1", ts: "1.0" } })).toBeNull();
  });

  it("normalizeSlackEvent resolves workspace from authorizations fallback", () => {
    const normalized = normalizeSlackEvent({
      authorizations: [{ team_id: "T-auth" }],
      event: {
        type: "message",
        channel: "C1",
        user: "U1",
        text: "hello slack",
        ts: "1710000000.1234",
        thread_ts: "1710000000.0000",
        files: [{ id: "F1", name: "doc.pdf", mimetype: "application/pdf", url_private: "http://localhost/doc" }],
      },
    });
    expect(normalized?.workspaceId).toBe("T-auth");
    expect(normalized?.threadId).toBe("1710000000.0000");
    expect(slackMessageMemoryAdapter.supportsThreads).toBe(true);
  });
});
