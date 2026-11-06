// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/constants", () => ({
  CLAUDE_MEMORY_PATH: "/tmp/claude-memory-batch29e",
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

describe("chatgpt-actions batch29e — host fallback, textFrom non-record, json catch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY;
    delete process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hostnameFromHostHeader parses [::1] when URL hostname is 0.0.0.0 (line 56)", async () => {
    const { authorizeChatGptAction } = await import("@/lib/chatgpt-actions");
    process.env.MEMROOS_CHATGPT_ACTIONS_REQUIRE_KEY_LOCAL = "true";
    process.env.MEMROOS_CHATGPT_ACTIONS_API_KEY = "batch29e-local-key";
    const res = authorizeChatGptAction(
      new Request("http://0.0.0.0:3000/api/chatgpt/actions/search", {
        headers: { host: "[::1]:3000", "x-api-key": "batch29e-local-key" },
      }),
    );
    expect(res).toBeNull();
  });

  it("textFrom returns empty string for non-record vector items (line 121)", async () => {
    const { searchMemroosForChatGpt } = await import("@/lib/chatgpt-actions");
    const { searchVectorMemory } = await import("@/lib/memory/backends");
    vi.mocked(searchVectorMemory).mockResolvedValue([42, true, null]);
    const { results } = await searchMemroosForChatGpt("batch29e-nonrecord", 5);
    expect(results.filter((r) => r.tier === "vector")).toHaveLength(0);
  });

  it("saveMemroosFromChatGpt uses empty object when response.json rejects (line 377 catch)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error("bad json");
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { saveMemroosFromChatGpt } = await import("@/lib/chatgpt-actions");
    await expect(saveMemroosFromChatGpt({ text: "batch29e save", type: "episodic" })).rejects.toBeTruthy();
    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]?.[0] ?? "")).toContain("/memory/add");
  });
});
