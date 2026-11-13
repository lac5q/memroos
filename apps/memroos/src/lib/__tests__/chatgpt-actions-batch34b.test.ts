// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/constants", () => ({
  CLAUDE_MEMORY_PATH: "/tmp/claude-memory-batch34b",
  MEM0_URL: "http://localhost:19999",
}));

vi.mock("@/lib/memory/backends", () => ({
  searchVectorMemory: vi.fn(),
  queryGraphMemory: vi.fn(),
}));

vi.mock("@/lib/parsers", () => ({
  parseClaudeMemory: vi.fn(async () => [
    {
      id: "ep-1",
      content: "episodic batch34b body",
      type: "note",
      agent: "cli-agent",
      source: "",
      date: "2026-07-01",
      score: 0.5,
    },
  ]),
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
  checkMemoryWritePolicy: vi.fn(() => ({ allowed: true })),
}));
vi.mock("@/lib/privacy/pii-storage", () => ({
  protectMemoryPayloadForStorage: (payload: unknown) => payload,
}));

describe("chatgpt-actions batch34b — host parsing and graph rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY;
    delete process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requestHostname falls back to Host header (lines 57, 68)", async () => {
    const { authorizeChatGptAction } = await import("@/lib/chatgpt-actions");
    process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL = "true";
    process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY = "batch34b-key";
    const res = authorizeChatGptAction(
      new Request("http://0.0.0.0:3000/api/chatgpt/actions/search", {
        headers: { host: "localhost:3000", "x-api-key": "batch34b-key" },
      }),
    );
    expect(res).toBeNull();
  });

  it("decodeChatGptActionResult rejects non-record payloads (lines 153–154)", async () => {
    const { decodeChatGptActionResult } = await import("@/lib/chatgpt-actions");
    const bad = `memroos:${Buffer.from(JSON.stringify("not-record"), "utf8").toString("base64url")}`;
    expect(() => decodeChatGptActionResult(bad)).toThrow(/Invalid MemRoOS result payload/);
  });

  it("normalizeGraph reads row array shape (lines 222, 233)", async () => {
    const { searchMemroosForChatGpt } = await import("@/lib/chatgpt-actions");
    const { queryGraphMemory } = await import("@/lib/memory/backends");
  vi.mocked(queryGraphMemory).mockResolvedValue({
      results: [{ data: [{ row: [{ memory: "graph row batch34b" }] }] }],
    });
    vi.mocked((await import("@/lib/memory/backends")).searchVectorMemory).mockResolvedValue([]);
    const { results } = await searchMemroosForChatGpt("graph batch34b", 3);
    expect(results.some((r) => r.tier === "graph" && r.text.includes("graph row batch34b"))).toBe(true);
  });

  it("normalizeEpisodic falls back to agent id as source (line 259)", async () => {
    const { searchMemroosForChatGpt } = await import("@/lib/chatgpt-actions");
    const { searchVectorMemory, queryGraphMemory } = await import("@/lib/memory/backends");
    vi.mocked(searchVectorMemory).mockResolvedValue([]);
    vi.mocked(queryGraphMemory).mockResolvedValue({ results: [] });
    const { results } = await searchMemroosForChatGpt("episodic batch34b", 3);
    const episodic = results.find((r) => r.tier === "episodic");
    expect(episodic?.source).toBe("cli-agent");
  });

  it("saveMemroosFromChatGpt records metadata and content branches (lines 384–385)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "mem-added" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const registry = await import("@/lib/agent-registry");
    const { saveMemroosFromChatGpt } = await import("@/lib/chatgpt-actions");
    await saveMemroosFromChatGpt({
      text: "save batch34b",
      metadata: { channel: "mobile" },
    });
    expect(registry.recordMemoryWrite).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/memory/add"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("hostnameFromHostHeader strips ipv6 brackets (line 57)", async () => {
    const { authorizeChatGptAction } = await import("@/lib/chatgpt-actions");
    process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL = "true";
    process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY = "batch34b-brackets-key";
    const res = authorizeChatGptAction(
      new Request("http://0.0.0.0:3000/api/chatgpt/actions/search", {
        headers: { host: "[::1]:3000", authorization: "Bearer batch34b-brackets-key" },
      }),
    );
    expect(res).toBeNull();
  });
});
