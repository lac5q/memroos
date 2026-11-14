// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LOOPBACK = "http://localhost";

vi.mock("@/lib/constants", () => ({
  CLAUDE_MEMORY_PATH: "/tmp/claude-memory-batch29",
  MEM0_URL: "http://localhost:9999",
}));

vi.mock("@/lib/memory/backends", () => ({
  searchVectorMemory: vi.fn(),
  queryGraphMemory: vi.fn(async () => ({ results: [] })),
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

describe("chatgpt-actions batch29 — IPv6 host, textFrom, resultItems, mem0 errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY;
    delete process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses [::1] bracketed Host for loopback when local key is required", async () => {
    const { authorizeChatGptAction } = await import("@/lib/chatgpt-actions");
    process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL = "true";
    process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY = "batch29-local-key";
    const res = authorizeChatGptAction(
      new Request(`${LOOPBACK}/api/chatgpt/actions/search`, {
        headers: { host: "[::1]:3000", "x-api-key": "batch29-local-key" },
      }),
    );
    expect(res).toBeNull();
  });

  it("JSON-stringifies vector records with only non-string keyed fields", async () => {
    const { searchMemroosForChatGpt } = await import("@/lib/chatgpt-actions");
    const { searchVectorMemory } = await import("@/lib/memory/backends");
    vi.mocked(searchVectorMemory).mockResolvedValue([{ n: 42, flag: true }]);
    const { results } = await searchMemroosForChatGpt("batch29-textfrom", 5);
    const hit = results.find((r) => r.tier === "vector");
    expect(hit?.text).toBe(JSON.stringify({ n: 42, flag: true }));
  });

  it("returns no vector hits when mem0 payload is a record without array arms", async () => {
    const { searchMemroosForChatGpt } = await import("@/lib/chatgpt-actions");
    const { searchVectorMemory } = await import("@/lib/memory/backends");
    vi.mocked(searchVectorMemory).mockResolvedValue({ status: "ok", value: 1 });
    const { results, tiers } = await searchMemroosForChatGpt("batch29-no-array-arms", 5);
    expect(results.filter((r) => r.tier === "vector")).toHaveLength(0);
    expect(tiers.find((t) => t.tier === "vector")?.count).toBe(0);
  });

  it("saveMemroosFromChatGpt surfaces Memory backend unavailable on non-OK fetch", async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: "upstream" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { saveMemroosFromChatGpt } = await import("@/lib/chatgpt-actions");
    let err: unknown;
    try {
      await saveMemroosFromChatGpt({ text: "batch29 save", type: "episodic" });
    } catch (e) {
      err = e;
    }
    expect(fetchMock).toHaveBeenCalled();
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/Memory backend unavailable/);
  });
});
