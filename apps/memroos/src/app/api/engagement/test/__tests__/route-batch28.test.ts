// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent-registry", () => ({
  getRemoteAgents: vi.fn(),
  listRegisteredAgents: vi.fn(),
}));
vi.mock("@/lib/dispatch/adapter-factory", () => ({
  selectAdapter: vi.fn(),
}));
vi.mock("@/app/api/chat/chat-runtime", () => ({
  buildAgentContext: vi.fn(async () => ({ systemPrompt: "x", source: "pmo", dir: null, agentInstructions: null })),
  chatRuntimeStatus: vi.fn(),
  resolveChatRuntimePlan: vi.fn(),
}));

const { POST } = await import("../route");
const { getRemoteAgents, listRegisteredAgents } = await import("@/lib/agent-registry");
const { selectAdapter } = await import("@/lib/dispatch/adapter-factory");
const { chatRuntimeStatus, resolveChatRuntimePlan } = await import("@/app/api/chat/chat-runtime");

const mockList = vi.mocked(listRegisteredAgents);
const mockRemotes = vi.mocked(getRemoteAgents);
const mockSelect = vi.mocked(selectAdapter);
const mockStatus = vi.mocked(chatRuntimeStatus);
const mockPlan = vi.mocked(resolveChatRuntimePlan);

const LOOPBACK = "http://localhost";

const baseAgent = {
  id: "agent-batch28",
  name: "Batch28 Agent",
  role: "worker",
  platform: "codex",
  protocol: "local",
  status: "active",
  lastHeartbeat: null,
  currentTask: null,
  lessonsCount: 0,
  todayMemoryCount: 0,
  location: "local",
  isRemote: false,
  latencyMs: null,
  capabilities: [],
  metadata: {},
  host: "localhost",
  port: 8080,
  healthEndpoint: "/health",
  tunnelUrl: undefined,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deregisteredAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ELEVENLABS_API_KEY", "test-key-batch28");
  mockRemotes.mockReturnValue([]);
  mockSelect.mockReturnValue({ name: "poll", platform: ["codex"], dispatch: vi.fn() } as never);
  mockPlan.mockResolvedValue({
    primary: { runner: "anthropic", model: "primary-batch28", source: "env" },
    candidates: [
      { runner: "anthropic", model: "primary-batch28", source: "env" },
      { runner: "opencode", model: "fallback-batch28", source: "fallback" },
    ],
  } as never);
});

describe("POST /api/engagement/test batch28 — chat fallback and remote dispatch", () => {
  it("marks chat warning when primary runtime is blocked but fallback is ready", async () => {
    mockList.mockReturnValue([baseAgent] as never);
    mockStatus.mockImplementation((candidate) =>
      candidate.runner === "anthropic"
        ? { status: "blocked", detail: "blocked batch28", lastError: "quota" }
        : { status: "ready", detail: "fallback ready batch28" },
    );

    const res = await POST(
      new Request(`${LOOPBACK}/api/engagement/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentIds: ["agent-batch28"] }),
      }) as never,
    );
    const body = await res.json();
    expect(body.results[0].chat.status).toBe("warning");
    expect(body.results[0].chat.detail).toMatch(/Fallback ready: opencode\/fallback-batch28/i);
    expect(body.results[0].voice.status).toBe("ready");
  });

  it("marks remote dispatch warning when adapter is poll-only", async () => {
    mockList.mockReturnValue([baseAgent] as never);
    mockRemotes.mockReturnValue([
      {
        id: "agent-batch28",
        name: "Remote Batch28",
        role: "worker",
        platform: "codex",
        protocol: "a2a",
        location: "remote",
        host: "localhost",
        port: 9000,
        healthEndpoint: "/health",
        metadata: {},
        skills: [],
      },
    ] as never);
    mockSelect.mockReturnValue({ name: "poll", platform: ["codex"], dispatch: vi.fn() } as never);
    mockStatus.mockReturnValue({ status: "ready", detail: "ready batch28" });

    const res = await POST(
      new Request(`${LOOPBACK}/api/engagement/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }) as never,
    );
    const body = await res.json();
    expect(body.results[0].dispatch.status).toBe("warning");
    expect(body.results[0].dispatch.detail).toMatch(/poll queue/i);
  });
});
