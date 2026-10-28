// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/constants", () => ({
  CLAUDE_MEMORY_PATH: "/tmp/claude-memory",
  MEM0_URL: "http://localhost:9999",
}));

vi.mock("@/lib/memory/backends", () => ({
  searchVectorMemory: vi.fn(async () => []),
  queryGraphMemory: vi.fn(async () => ({ results: [] })),
}));

vi.mock("@/lib/parsers", () => ({
  parseClaudeMemory: vi.fn(async () => []),
}));

vi.mock("@/lib/db", () => ({
  getDb: vi.fn(() => ({
    prepare: () => ({
      get: () => null,
      all: () => [],
    }),
  })),
}));

import {
  authorizeChatGptAction,
  decodeChatGptActionResult,
  parseActionLimit,
  readJsonBody,
} from "@/lib/chatgpt-actions";

describe("chatgpt-actions batch16c — limits, body parsing, save guardrails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY;
    delete process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL;
  });

  it("parseActionLimit clamps and falls back for invalid numbers", () => {
    expect(parseActionLimit(undefined, 5)).toBe(5);
    expect(parseActionLimit("999", 5)).toBe(20);
    expect(parseActionLimit("0", 5)).toBe(1);
    expect(parseActionLimit("not-a-number", 7)).toBe(7);
  });

  it("readJsonBody returns empty object for invalid JSON bodies", async () => {
    const req = new Request("http://localhost/api/chatgpt/actions/search", {
      method: "POST",
      body: "{ broken",
      headers: { "content-type": "application/json" },
    });
    const body = await readJsonBody(req);
    expect(body).toEqual({});
  });

  it("authorizeChatGptAction rejects non-loopback hosts when actions are disabled", () => {
    const response = authorizeChatGptAction(new Request("https://example.com/api/chatgpt/actions/search"));
    expect(response?.status).toBeGreaterThanOrEqual(401);
  });

  it("decodeChatGptActionResult rejects invalid tier labels in encoded ids", () => {
    const payload = {
      title: "Hit",
      text: "Body",
      tier: "invalid-tier",
      source: "memroos",
      label: { visibility: "internal", policy: "agent_visible" },
    };
    const id = `memroos:${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
    expect(() => decodeChatGptActionResult(id)).toThrow(/Invalid MemRoOS result payload/i);
  });
});
