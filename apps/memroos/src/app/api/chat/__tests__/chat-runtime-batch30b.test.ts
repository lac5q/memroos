// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetRegisteredAgent = vi.fn();

vi.mock("@/lib/agent-registry", () => ({
  getRegisteredAgent: (...args: unknown[]) => mockGetRegisteredAgent(...args),
}));

describe("chat-runtime batch30b", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "chat-rt-b30b-"));
    mockGetRegisteredAgent.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("registeredPlatformRuntime picks opus and sonnet anthropic models", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    mockGetRegisteredAgent.mockReturnValue({
      id: "opus-agent",
      name: "Opus Worker",
      role: "engineer",
      platform: "claude",
    });
    const { resolveChatRuntimePlan, buildAgentContext } = await import("../chat-runtime");
    const ctx = await buildAgentContext("opus-agent");
    const opusPlan = await resolveChatRuntimePlan("opus-agent", ctx);
    expect(opusPlan.candidates.some((c) => c.model.includes("opus"))).toBe(true);

    mockGetRegisteredAgent.mockReturnValue({
      id: "sonnet-agent",
      name: "Sonnet Worker",
      role: "engineer",
      platform: "claude",
    });
    const sonnetPlan = await resolveChatRuntimePlan("sonnet-agent", await buildAgentContext("sonnet-agent"));
    expect(sonnetPlan.candidates.some((c) => c.model.includes("sonnet"))).toBe(true);
  });

  it("pmoDefaultModelForAgent reads per-agent block when PMO agent dir exists", async () => {
    const routing = path.join(root, "model-routing.yaml");
    writeFileSync(
      routing,
      [
        "rules:",
        "  agent-y:",
        "    default_model: bailian/qwen3.5-plus",
        "  - name: default",
        "    match: {}",
        "    preferred_model: claude-haiku",
        "",
      ].join("\n"),
    );
    vi.stubEnv("PMO_MODEL_ROUTING_PATH", routing);
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    vi.stubEnv("AGENT_CONFIGS_PATH", path.join(root, "empty-knowledge"));
    mockGetRegisteredAgent.mockReturnValue(null);

    const pmoRoot = path.join(root, "pmo");
    mkdirSync(path.join(pmoRoot, "agent-y"), { recursive: true });
    writeFileSync(path.join(pmoRoot, "agent-y", "AGENTS.md"), "default_model: qwen3.5\n");
    vi.stubEnv("PMO_AGENT_CONFIGS_PATH", pmoRoot);

    const { buildAgentContext, resolveChatRuntimePlan } = await import("../chat-runtime");
    const ctx = await buildAgentContext("agent-y");
    expect(ctx.source).toBe("pmo");
    const planY = await resolveChatRuntimePlan("agent-y", ctx);
    expect(planY.candidates.some((c) => c.source === "agent-instructions")).toBe(true);
    expect(planY.candidates.some((c) => c.model.includes("qwen"))).toBe(true);
  });

  it("pmoDefaultModelForAgent reads model-routing.yaml for PMO-sourced context", async () => {
    const routing = path.join(root, "model-routing-pmo.yaml");
    writeFileSync(
      routing,
      "rules:\n  agent-y:\n    default_model: bailian/qwen3.5-plus\n",
    );
    vi.stubEnv("PMO_MODEL_ROUTING_PATH", routing);
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    mockGetRegisteredAgent.mockReturnValue(null);
    const { resolveChatRuntimePlan } = await import("../chat-runtime");
    const plan = await resolveChatRuntimePlan("agent-y", {
      systemPrompt: "test",
      source: "pmo",
      dir: "/tmp",
      agentInstructions: null,
    });
    expect(plan.candidates.some((c) => c.source === "pmo-routing")).toBe(true);
  });
});
