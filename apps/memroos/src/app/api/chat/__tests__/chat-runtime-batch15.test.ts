// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("chat-runtime batch15", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "chat-rt-b15-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("buildAgentContext stitches soul, heartbeat, memory, and lessons", async () => {
    const configsRoot = path.join(root, "configs");
    const agentDir = path.join(configsRoot, "agent-a");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(path.join(agentDir, "SOUL.md"), "---\ntitle: soul\n---\nI am the agent.\n");
    writeFileSync(path.join(agentDir, "AGENTS.md"), "Follow the plan.");
    writeFileSync(path.join(agentDir, "HEARTBEAT_STATE.md"), "Working on tests.");
    writeFileSync(path.join(agentDir, "MEMORY.md"), "Remember batch15.");
    writeFileSync(path.join(agentDir, "LESSONS.md"), "Keep tests deterministic.");
    vi.stubEnv("AGENT_CONFIGS_PATH", configsRoot);

    const {
      buildAgentContext,
      normalizeModel,
      chatRuntimeStatus,
      recordChatRuntimeFailure,
      recordChatRuntimeSuccess,
      isProviderLimitError,
    } = await import("../chat-runtime");

    const built = await buildAgentContext("agent-a");
    expect(built.systemPrompt).toContain("I am the agent");
    expect(built.systemPrompt).toContain("Agent Instructions");
    expect(built.systemPrompt).toContain("Current Status");
    expect(built.systemPrompt).toContain("Memory");
    expect(built.systemPrompt).toContain("Lessons Learned");

    expect(normalizeModel('"claude-sonnet"')).toBe("claude-sonnet-4-6");
    expect(isProviderLimitError("usage limit exceeded")).toBe(true);
    recordChatRuntimeFailure({ runner: "anthropic", model: "claude-test" }, "rate_limit_error");
    expect(chatRuntimeStatus({ runner: "anthropic", model: "claude-test" }).status).toBe("blocked");
    recordChatRuntimeSuccess({ runner: "anthropic", model: "claude-test" });

    vi.stubEnv("MEMROOS_ENABLE_OPENCODE", "false");
    expect(chatRuntimeStatus({ runner: "opencode", model: "qwen/test" }).status).toBe("blocked");
  });

  it("resolveChatRuntimePlan honors operator override and PMO routing", async () => {
    vi.stubEnv("MEMROOS_CHAT_MODEL", "custom/model");
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    const pmoRoot = path.join(root, "pmo");
    mkdirSync(path.join(pmoRoot, "agent-x"), { recursive: true });
    writeFileSync(path.join(pmoRoot, "agent-x", "AGENTS.md"), "default_model: qwen3.5\n");
    const pmoRouting = path.join(root, "routing.yaml");
    writeFileSync(
      pmoRouting,
      [
        "rules:",
        "  agent-x:",
        "    default_model: bailian/qwen3.5-plus",
        "  - name: default",
        "    match: {}",
        "    preferred_model: qwen3.5",
        "",
      ].join("\n"),
    );
    vi.stubEnv("PMO_AGENT_CONFIGS_PATH", pmoRoot);
    vi.stubEnv("PMO_MODEL_ROUTING_PATH", pmoRouting);

    const { buildAgentContext, resolveChatRuntimePlan } = await import("../chat-runtime");
    const context = await buildAgentContext("agent-x");
    const plan = await resolveChatRuntimePlan("agent-x", context);
    expect(plan.primary.model).toBe("custom/model");
    expect(plan.candidates.length).toBeGreaterThan(1);
  });
});
