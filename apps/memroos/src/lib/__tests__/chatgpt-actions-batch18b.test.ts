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

vi.mock("@/lib/db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent-registry")>();
  return {
    ...actual,
    recordMemoryWrite: vi.fn(),
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
  parseActionLimit,
  readJsonBody,
  searchMemroosForChatGpt,
} from "@/lib/chatgpt-actions";
import { queryGraphMemory, searchVectorMemory } from "@/lib/memory/backends";

const LOOPBACK = "http://localhost";

describe("chatgpt-actions batch18b — auth edges and result normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY;
    delete process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL;
  });

  it("authorizeChatGptAction returns 503 when API key missing on non-loopback host", () => {
    const res = authorizeChatGptAction(
      new Request("https://memroos.example/api/chatgpt/actions/search", {
        headers: { host: "memroos.example" },
      }),
    );
    expect(res?.status).toBe(503);
  });

  it("parseActionLimit falls back when limit is not numeric", () => {
    expect(parseActionLimit("not-a-number", 6)).toBe(6);
    expect(parseActionLimit(undefined, 6)).toBe(6);
  });

  it("readJsonBody returns empty object for invalid JSON bodies", async () => {
    const body = await readJsonBody(
      new Request(`${LOOPBACK}/api/chatgpt/actions/search`, {
        method: "POST",
        body: "not-json",
      }),
    );
    expect(body).toEqual({});
  });

  it("searchMemroosForChatGpt normalizes graph results arrays into encoded action results", async () => {
    vi.mocked(searchVectorMemory).mockResolvedValue([] as never);
    vi.mocked(queryGraphMemory).mockResolvedValue({
      data: [{ content: "alpha graph fact", metadata: { visibility: "internal", policy: "agent_visible" } }],
    } as never);
    const { results } = await searchMemroosForChatGpt("alpha", 5);
    expect(results.some((r) => r.id.startsWith("memroos:"))).toBe(true);
    expect(results.some((r) => r.text.includes("alpha graph"))).toBe(true);
  });

  it("decodeChatGptActionResult rejects non-record decoded payloads", () => {
    const id = `memroos:${Buffer.from(JSON.stringify(["not", "record"]), "utf8").toString("base64url")}`;
    expect(() => decodeChatGptActionResult(id)).toThrow(/Invalid MemRoOS result payload/);
  });
});
