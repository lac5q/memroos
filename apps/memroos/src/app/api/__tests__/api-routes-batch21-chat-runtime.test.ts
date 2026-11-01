// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("api routes batch21 — chat-runtime", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "chat-rt-b21-"));
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("buildAgentContext uses HEARTBEAT.md when HEARTBEAT_STATE.md is absent", async () => {
    const configsRoot = path.join(root, "configs");
    const agentDir = path.join(configsRoot, "heartbeat-agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(path.join(agentDir, "SOUL.md"), "Soul text.");
    writeFileSync(path.join(agentDir, "HEARTBEAT.md"), "Recent heartbeat activity.");
    vi.stubEnv("AGENT_CONFIGS_PATH", configsRoot);

    const { buildAgentContext } = await import("../chat/chat-runtime");
    const built = await buildAgentContext("heartbeat-agent");
    expect(built.systemPrompt).toContain("Recent Activity");
    expect(built.systemPrompt).toContain("Recent heartbeat activity.");
  });

  it("resolveChatRuntimePlan ignores cursor platform defaults", async () => {
    const { registerAgent } = await import("@/lib/agent-registry");
    const agentId = `cursor-${randomUUID().slice(0, 8)}`;
    registerAgent({
      id: agentId,
      name: "Cursor Agent",
      role: "dev",
      platform: "cursor",
      protocol: "rest",
    });
    vi.stubEnv("ANTHROPIC_API_KEY", "key");

    const { buildAgentContext, resolveChatRuntimePlan } = await import("../chat/chat-runtime");
    const context = await buildAgentContext("missing-dir-agent");
    const plan = await resolveChatRuntimePlan(agentId, context);
    expect(plan.candidates.some((c) => c.source === "registered-platform")).toBe(false);
  });
});
