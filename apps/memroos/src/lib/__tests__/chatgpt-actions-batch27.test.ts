// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const LOOPBACK = "http://localhost:3000";

vi.mock("@/lib/constants", () => ({
  CLAUDE_MEMORY_PATH: "/tmp/claude-memory",
  MEM0_URL: "http://localhost:9999",
}));

vi.mock("@/lib/memory/backends", () => ({
  searchVectorMemory: vi.fn(async () => [
    { score: 0.9, memory: { title: "nested", content: "from memory key" } },
    { similarity: 0.2, content: "plain vector hit" },
    "skip-me",
  ]),
  queryGraphMemory: vi.fn(async () => ({ data: [{ name: "graph-node" }] })),
}));

vi.mock("@/lib/parsers", () => ({
  parseClaudeMemory: vi.fn(async () => []),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    prepare: () => ({ get: () => null, all: () => [] }),
  }),
  closeDb: () => {},
}));

vi.mock("@/lib/agent-registry", () => ({
  registerAgent: () => ({ agent: { id: "chatgpt-mobile" } }),
  recordMemoryWrite: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/response-cache", () => ({ responseCache: { invalidateTag: vi.fn() } }));
vi.mock("@/lib/memory/policy-gate", () => ({
  authorizeMemoryUse: () => ({ decision: "allow" }),
  extractMemoryLabelSnapshot: () => ({ visibility: "internal", policy: "agent_visible" }),
  filterAuthorizedMemoryItems: (_db: unknown, items: unknown[]) => items,
}));
vi.mock("@/lib/security-policy", () => ({
  checkMemoryWritePolicy: () => ({ allowed: true }),
}));
vi.mock("@/lib/privacy/pii-storage", () => ({
  protectMemoryPayloadForStorage: (payload: unknown) => payload,
}));

import {
  authorizeChatGptAction,
  readJsonBody,
  saveMemroosFromChatGpt,
  searchMemroosForChatGpt,
} from "@/lib/chatgpt-actions";

describe("chatgpt-actions batch27 — host parsing, normalization, write failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY;
    delete process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL;
  });

  it("parses bracketed IPv6 Host headers for loopback authorization", () => {
    process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL = "true";
    process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY = "local-key";
    const res = authorizeChatGptAction(
      new Request(`${LOOPBACK}/api/chatgpt/actions/search`, {
        headers: { host: "[2001:db8::1]:3000", "x-api-key": "local-key" },
      }),
    );
    expect(res).toBeNull();
  });

  it("readJsonBody returns empty object for non-record JSON bodies", async () => {
    const body = await readJsonBody(
      new Request(`${LOOPBACK}/`, { method: "POST", body: JSON.stringify([1, 2, 3]) }),
    );
    expect(body).toEqual({});
  });

  it("searchMemroosForChatGpt normalizes nested memory objects and numeric scores", async () => {
    const search = await searchMemroosForChatGpt("vector", 5);
    expect(search.results.some((item) => item.text.includes("from memory key"))).toBe(true);
    expect(search.results.some((item) => typeof item.score === "number")).toBe(true);
    expect(search.results.every((item) => item.text.trim().length > 0)).toBe(true);
  });

  it("saveMemroosFromChatGpt rejects when mem0 responds with a non-OK status", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);
    let rejected: unknown;
    try {
      await saveMemroosFromChatGpt({ text: "batch27 write failure", type: "episodic" });
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as Error).message).toMatch(/Memory backend unavailable/);
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
