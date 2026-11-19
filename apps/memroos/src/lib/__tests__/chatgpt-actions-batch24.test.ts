// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

vi.mock("@/lib/constants", () => ({
  CLAUDE_MEMORY_PATH: "/tmp/claude-memory",
  MEM0_URL: "http://mem0.test",
}));

vi.mock("@/lib/memory/backends", () => ({
  searchVectorMemory: vi.fn(async () => []),
  queryGraphMemory: vi.fn(async () => ({ results: [] })),
}));

vi.mock("@/lib/parsers", () => ({
  parseClaudeMemory: vi.fn(async () => []),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-registry")>();
  return { ...actual, recordMemoryWrite: vi.fn() };
});

vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/response-cache", () => ({ responseCache: { invalidateTag: vi.fn() } }));
vi.mock("@/lib/memory/policy-gate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory/policy-gate")>();
  return {
    ...actual,
    filterAuthorizedMemoryItems: (_db: unknown, items: unknown[]) => items,
  };
});

import {
  authorizeChatGptAction,
  decodeChatGptActionResult,
  parseActionLimit,
  searchMemroosForChatGpt,
} from "@/lib/chatgpt-actions";
import { searchVectorMemory } from "@/lib/memory/backends";

describe("chatgpt-actions batch24 — auth, limits, text extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY;
    delete process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL;
  });

  it("authorizeChatGptAction accepts bearer tokens on non-loopback hosts when configured", () => {
    process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY = "secret-b24";
    const res = authorizeChatGptAction(
      new Request("https://memroos.example/api/chatgpt/actions/search", {
        headers: { authorization: "Bearer secret-b24" },
      }),
    );
    expect(res).toBeNull();
  });

  it("authorizeChatGptAction returns 503 when API key env is missing on remote hosts", () => {
    const res = authorizeChatGptAction(new Request("https://memroos.example/api/chatgpt/actions/search"));
    expect(res?.status).toBe(503);
  });

  it("parseActionLimit clamps invalid and oversized values", () => {
    expect(parseActionLimit(undefined, 8)).toBe(8);
    expect(parseActionLimit("999", 8)).toBe(20);
    expect(parseActionLimit("0", 8)).toBe(1);
    expect(parseActionLimit("not-a-number", 5)).toBe(5);
  });

  it("decodeChatGptActionResult accepts nested text fields", () => {
    const payload = {
      title: "Hit",
      text: "Body",
      tier: "vector",
      source: "memroos",
      label: { visibility: "internal", policy: "agent_visible" },
    };
    const id = `memroos:${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
    expect(decodeChatGptActionResult(id).text).toBe("Body");
  });

  it("searchMemroosForChatGpt JSON-stringifies vector payloads without string memory fields", async () => {
    vi.mocked(searchVectorMemory).mockResolvedValueOnce([
      {
        payload: { nested: { value: "batch24-vector" } },
        metadata: { visibility: "internal", policy: "agent_visible" },
      },
    ] as never);
    const { results } = await searchMemroosForChatGpt("batch24 nested", 3);
    expect(results.some((row) => row.tier === "vector" && row.text.includes("batch24-vector"))).toBe(true);
  });
});
