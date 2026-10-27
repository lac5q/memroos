// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/constants", () => ({
  CLAUDE_MEMORY_PATH: "/tmp/claude-memory",
  MEM0_URL: "http://localhost:9999",
}));

vi.mock("@/lib/memory/backends", () => ({
  searchVectorMemory: vi.fn(),
  queryGraphMemory: vi.fn(),
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
  readJsonBody,
  searchMemroosForChatGpt,
} from "@/lib/chatgpt-actions";
import { queryGraphMemory, searchVectorMemory } from "@/lib/memory/backends";

describe("chatgpt-actions batch16 — host parsing and result normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY;
    delete process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL;
  });

  it("authorizeChatGptAction parses bracketed IPv6 host headers on loopback", () => {
    process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL = "true";
    process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY = "local-key";
    const response = authorizeChatGptAction(
      new Request("http://localhost/api/chatgpt/actions/search", {
        headers: { host: "[::1]:3000", "x-api-key": "local-key" },
      }),
    );
    expect(response).toBeNull();
  });

  it("decodeChatGptActionResult extracts nested text fields and rejects unauthorized labels", () => {
    const allowedPayload = {
      title: "Hit",
      text: "Body",
      tier: "vector",
      source: "memroos",
      label: { visibility: "internal", policy: "agent_visible" },
    };
    const id = `memroos:${Buffer.from(JSON.stringify(allowedPayload), "utf8").toString("base64url")}`;
    const decoded = decodeChatGptActionResult(id);
    expect(decoded.title).toBe("Hit");
    expect(decoded.text).toBe("Body");

    const deniedPayload = {
      title: "Denied",
      text: "Secret",
      tier: "vector",
      source: "memroos",
      label: { visibility: "restricted", policy: "operator_only" },
    };
    const deniedId = `memroos:${Buffer.from(JSON.stringify(deniedPayload), "utf8").toString("base64url")}`;
    expect(() => decodeChatGptActionResult(deniedId)).toThrow(/not authorized/i);
  });

  it("searchMemroosForChatGpt normalizes nested memory objects and malformed graph payloads", async () => {
    vi.mocked(searchVectorMemory).mockResolvedValue([
      { memory: "flat vector memory hit", score: 0.7, metadata: { visibility: "internal", policy: "agent_visible" } },
    ]);
    vi.mocked(queryGraphMemory).mockResolvedValue("not-an-object");
    const { results, tiers } = await searchMemroosForChatGpt("checkout", 5);
    expect(results.some((r) => r.text.includes("flat vector memory hit"))).toBe(true);
    expect(results.every((r) => r.id.startsWith("memroos:"))).toBe(true);
    expect(tiers.some((t) => t.tier === "graph" && t.ok === true && t.count === 0)).toBe(true);
  });

  it("readJsonBody returns empty object for invalid JSON bodies", async () => {
    await expect(
      readJsonBody(new Request("http://localhost/api/chatgpt/actions/search", { method: "POST", body: "not-json" })),
    ).resolves.toEqual({});
  });
});
