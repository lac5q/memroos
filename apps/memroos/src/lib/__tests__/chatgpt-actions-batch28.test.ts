// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  authorizeChatGptAction,
  decodeChatGptActionResult,
  parseActionLimit,
} from "@/lib/chatgpt-actions";

describe("chatgpt-actions batch28 — parseActionLimit, decode payload, remote authorize", () => {
  it("parseActionLimit clamps and falls back for non-finite values", () => {
    expect(parseActionLimit(undefined, 6)).toBe(6);
    expect(parseActionLimit("not-a-number", 4)).toBe(4);
    expect(parseActionLimit(0, 8)).toBe(1);
    expect(parseActionLimit(99, 8)).toBe(20);
  });

  it("decodeChatGptActionResult rejects malformed ids and payloads", () => {
    expect(() => decodeChatGptActionResult("not-memroos:id")).toThrow(/Invalid MemRoOS result id/);
    const badPayload = `memroos:${Buffer.from(JSON.stringify({ title: "", text: "x", tier: "vector" }), "utf8").toString("base64url")}`;
    expect(() => decodeChatGptActionResult(badPayload)).toThrow(/Invalid MemRoOS result payload/);
  });

  it("decodeChatGptActionResult decodes an authorized vector payload", () => {
    const payload = {
      title: "Batch28 hit",
      text: "Decoded body",
      tier: "vector",
      source: "test",
      label: { visibility: "internal", policy: "agent_visible" },
    };
    const id = `memroos:${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
    const decoded = decodeChatGptActionResult(id);
    expect(decoded.text).toBe("Decoded body");
    expect(decoded.tier).toBe("vector");
  });

  it("authorizeChatGptAction returns 503 when API key is unset on non-loopback host", () => {
    delete process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY;
    const res = authorizeChatGptAction(new Request("https://memroos.example.com/api/chatgpt/actions/search"));
    expect(res?.status).toBe(503);
  });
});
