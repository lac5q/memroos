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
  parseActionLimit,
  readJsonBody,
  searchMemroosForChatGpt,
} from "@/lib/chatgpt-actions";
import { queryGraphMemory, searchVectorMemory } from "@/lib/memory/backends";

const LOOPBACK = "http://localhost";

describe("chatgpt-actions batch17b — auth, limits, and graph normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY;
    delete process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL;
  });

  it("parseActionLimit clamps and falls back for invalid input", () => {
    expect(parseActionLimit(undefined, 5)).toBe(5);
    expect(parseActionLimit("99", 5)).toBe(20);
    expect(parseActionLimit(0, 5)).toBe(1);
    expect(parseActionLimit("not-a-number", 8)).toBe(8);
  });

  it("readJsonBody returns empty object for non-object JSON", async () => {
    const req = new Request(`${LOOPBACK}/api/chatgpt/actions/search`, {
      method: "POST",
      body: JSON.stringify(["array"]),
    });
    await expect(readJsonBody(req)).resolves.toEqual({});
  });

  it("authorizeChatGptAction returns 503 when key is required but unset", () => {
    process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL = "true";
    const res = authorizeChatGptAction(new Request(`${LOOPBACK}/api/chatgpt/actions/search`));
    expect(res?.status).toBe(503);
  });

  it("authorizeChatGptAction returns 401 for wrong bearer on non-loopback host", () => {
    process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY = "expected-key";
    const res = authorizeChatGptAction(
      new Request("https://memroos.example/api/chatgpt/actions/search", {
        headers: { authorization: "Bearer wrong-key" },
      }),
    );
    expect(res?.status).toBe(401);
  });

  it("decodeChatGptActionResult rejects invalid id prefix", () => {
    expect(() => decodeChatGptActionResult("bad-id")).toThrow(/Invalid MemRoOS result id/);
  });

  it("searchMemroosForChatGpt normalizes neo4j row.data graph shape", async () => {
    vi.mocked(searchVectorMemory).mockRejectedValue(new Error("vector down"));
    vi.mocked(queryGraphMemory).mockResolvedValue([
      {
        content: "graph adapter content hit",
        metadata: { visibility: "internal", policy: "agent_visible" },
      },
    ]);
    const { results, tiers } = await searchMemroosForChatGpt("graph adapter", 5);
    expect(tiers.find((t) => t.tier === "graph")?.ok).toBe(true);
    expect(results.some((r) => r.tier === "graph" && r.text.includes("graph adapter"))).toBe(true);
  });
});
