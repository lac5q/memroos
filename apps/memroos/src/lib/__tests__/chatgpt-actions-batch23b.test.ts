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

vi.mock("@/lib/security-policy", () => ({
  checkMemoryWritePolicy: vi.fn(() => ({ allowed: true })),
}));

import {
  authorizeChatGptAction,
  decodeChatGptActionResult,
  readJsonBody,
  searchMemroosForChatGpt,
} from "@/lib/chatgpt-actions";
import { searchVectorMemory } from "@/lib/memory/backends";

describe("chatgpt-actions batch23b — hostname parsing, policy deny, memory write", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY;
    delete process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL;
  });


  it("readJsonBody returns {} when body is not an object", async () => {
    const body = await readJsonBody(new Request("http://example.com", { method: "POST", body: "[]" }));
    expect(body).toEqual({});
  });

  it("decodeChatGptActionResult accepts structured object payloads", () => {
    const payload = {
      title: "Result",
      text: "Body batch23b",
      tier: "vector",
      source: "memroos",
      label: { visibility: "internal", policy: "agent_visible" },
    };
    const id = `memroos:${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
    const decoded = decodeChatGptActionResult(id);
    expect(decoded.title).toBe("Result");
  });


  it("searchMemroosForChatGpt JSON-stringifies vector items without string memory fields", async () => {
    vi.mocked(searchVectorMemory).mockResolvedValueOnce([
      {
        payload: { nested: { value: 42 } },
        metadata: { visibility: "internal", policy: "agent_visible" },
      },
    ] as never);
    const { results } = await searchMemroosForChatGpt("nested batch23b", 5);
    expect(results.some((r) => r.tier === "vector" && r.text.includes("nested"))).toBe(true);
  });
});
