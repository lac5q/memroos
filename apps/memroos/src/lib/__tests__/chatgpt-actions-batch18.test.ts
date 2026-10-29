// @vitest-environment node
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initSchema } from "@/lib/db-schema";

const testDb = new Database(":memory:");
initSchema(testDb);

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

const mockRecordMemoryWrite = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-registry")>();
  return {
    ...actual,
    recordMemoryWrite: (...args: unknown[]) => mockRecordMemoryWrite(...args),
  };
});

vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/response-cache", () => ({
  responseCache: { invalidateTag: vi.fn() },
}));

import {
  authorizeChatGptAction,
  decodeChatGptActionResult,
  saveMemroosFromChatGpt,
  searchMemroosForChatGpt,
} from "@/lib/chatgpt-actions";
import { queryGraphMemory, searchVectorMemory } from "@/lib/memory/backends";

const LOOPBACK = "http://localhost";

describe("chatgpt-actions batch18 — host parsing, normalization, save path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY;
    delete process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL;
  });

  it("hostnameFromHostHeader parses bracketed IPv6 host values", () => {
    process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL = "true";
    process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY = "local-key";
    const res = authorizeChatGptAction(
      new Request(`${LOOPBACK}/api/chatgpt/actions/search`, {
        headers: { host: "[::1]:3000", "x-api-key": "local-key" },
      }),
    );
    expect(res).toBeNull();
  });

  it("authorizeChatGptAction falls back to Host header when URL hostname is 0.0.0.0", () => {
    process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL = "true";
    process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY = "local-key";
    const res = authorizeChatGptAction(
      new Request("http://0.0.0.0/api/chatgpt/actions/search", {
        headers: { host: "localhost:3000", "x-api-key": "local-key" },
      }),
    );
    expect(res).toBeNull();
  });

  it("searchMemroosForChatGpt JSON-stringifies vector items without string memory fields", async () => {
    vi.mocked(searchVectorMemory).mockResolvedValue([
      {
        payload: { nested: { value: 42 } },
        metadata: { visibility: "internal", policy: "agent_visible" },
      },
    ]);
    vi.mocked(queryGraphMemory).mockResolvedValue({ results: [] });
    const { results } = await searchMemroosForChatGpt("nested", 5);
    expect(results.some((r) => r.tier === "vector" && r.text.includes("nested"))).toBe(true);
  });

  it("decodeChatGptActionResult rejects payloads missing title or text", () => {
    const payload = {
      title: "",
      text: "Body",
      tier: "vector",
      source: "memroos",
      label: { visibility: "internal", policy: "agent_visible" },
    };
    const id = `memroos:${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
    expect(() => decodeChatGptActionResult(id)).toThrow(/Invalid MemRoOS result payload/);
  });

  it("saveMemroosFromChatGpt rejects when mem0 write fails", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);
    let rejected: unknown;
    try {
      await saveMemroosFromChatGpt({ text: "hello from chatgpt", type: "episodic" });
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toBeTruthy();
    expect(fetchMock).toHaveBeenCalled();
    expect(mockRecordMemoryWrite).not.toHaveBeenCalled();
  });

  it("saveMemroosFromChatGpt records write on successful mem0 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: "mem-1" }),
      })),
    );
    const saved = await saveMemroosFromChatGpt({ text: "persist me", type: "episodic" });
    expect(saved.tier).toBeTruthy();
    expect(mockRecordMemoryWrite).toHaveBeenCalled();
  });
});
