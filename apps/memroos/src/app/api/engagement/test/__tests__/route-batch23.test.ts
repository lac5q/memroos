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
  chatRuntimeStatus: vi.fn(() => ({ status: "ready", detail: "ready" })),
  resolveChatRuntimePlan: vi.fn(async () => ({
    primary: { runner: "anthropic", model: "claude-test", source: "env", detail: "env" },
    candidates: [],
  })),
}));

const { POST } = await import("../route");
const { getRemoteAgents, listRegisteredAgents } = await import("@/lib/agent-registry");
const { selectAdapter } = await import("@/lib/dispatch/adapter-factory");

const mockList = vi.mocked(listRegisteredAgents);
const mockRemotes = vi.mocked(getRemoteAgents);
const mockSelect = vi.mocked(selectAdapter);

const LOOPBACK = "http://localhost";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ELEVENLABS_API_KEY", "");
  mockRemotes.mockReturnValue([]);
  mockSelect.mockReturnValue({ name: "a2a", platform: ["codex"], dispatch: vi.fn() } as never);
});

describe("POST /api/engagement/test batch23", () => {
  it("maps local agent capabilities into dispatch skill payloads", async () => {
    mockList.mockReturnValue([
      {
        id: "cap-agent",
        name: "Cap Agent",
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
        capabilities: [
          {
            id: "cap-1",
            name: "Deploy",
            description: "deploy svc",
            tags: ["ops"],
          },
        ],
        metadata: { team: "platform" },
        host: "localhost",
        port: 8080,
        healthEndpoint: "/healthz",
        tunnelUrl: undefined,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        deregisteredAt: null,
      },
    ] as never);

    const res = await POST(
      new Request(`${LOOPBACK}/api/engagement/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentIds: ["cap-agent"] }),
      }) as never
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].dispatch.status).toBe("ready");
    expect(body.results[0].voice.status).toBe("warning");
    expect(mockSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: [
          expect.objectContaining({
            id: "cap-1",
            name: "Deploy",
            inputModes: ["text"],
            outputModes: ["text"],
          }),
        ],
        metadata: { team: "platform" },
      })
    );
  });

  it("returns 500 when agent listing throws", async () => {
    mockList.mockImplementation(() => {
      throw new Error("registry offline batch23");
    });
    const res = await POST(
      new Request(`${LOOPBACK}/api/engagement/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }) as never
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "registry offline batch23" });
  });
});
