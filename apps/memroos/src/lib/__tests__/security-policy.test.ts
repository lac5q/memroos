// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import {
  checkA2aSendPolicy,
  checkDispatchPolicy,
  checkMemoryWritePolicy,
} from "../security-policy";
import type { RegisteredAgent, RemoteAgentConfig } from "@/types";

function registeredAgent(capabilities: RegisteredAgent["capabilities"] = []): RegisteredAgent {
  return {
    id: "agent-1",
    name: "Agent",
    role: "Agent",
    platform: "codex",
    protocol: "a2a",
    status: "active",
    lastHeartbeat: null,
    currentTask: null,
    lessonsCount: 0,
    todayMemoryCount: 0,
    location: "local",
    isRemote: false,
    latencyMs: null,
    capabilities,
    metadata: {},
    host: null,
    port: null,
    healthEndpoint: null,
    tunnelUrl: null,
    createdAt: "2026-05-11T00:00:00.000Z",
    updatedAt: "2026-05-11T00:00:00.000Z",
    deregisteredAt: null,
  };
}

function remoteAgent(skills: RemoteAgentConfig["skills"] = []): RemoteAgentConfig {
  return {
    id: "remote-1",
    name: "Remote",
    role: "Remote",
    platform: "claude",
    protocol: "rest",
    location: "tailscale",
    host: "203.0.113.10",
    port: 18889,
    healthEndpoint: "/health",
    skills,
    metadata: {},
  };
}

describe("security policy guards", () => {
  afterEach(() => {
    delete process.env.MEMROOS_A2A_PROFILE;
    delete process.env.MEMROOS_ALLOW_LEGACY_UNDECLARED_CAPABILITIES;
  });

  it("allows legacy agents with no declared capabilities", () => {
    process.env.MEMROOS_A2A_PROFILE = "local-dev";
    expect(checkDispatchPolicy("memroos", remoteAgent())).toEqual({ allowed: true });
    expect(checkA2aSendPolicy(registeredAgent())).toEqual({ allowed: true });
    expect(checkMemoryWritePolicy(registeredAgent(), "graph")).toEqual({ allowed: true });
  });

  it("denies legacy undeclared capabilities outside local-dev defaults", () => {
    process.env.MEMROOS_A2A_PROFILE = "cloud-https";
    expect(checkDispatchPolicy("memroos", remoteAgent())).toMatchObject({ allowed: false, code: "MISSING_CAPABILITY" });
    expect(checkA2aSendPolicy(registeredAgent())).toMatchObject({ allowed: false, code: "MISSING_CAPABILITY" });
    expect(checkMemoryWritePolicy(registeredAgent(), "graph")).toMatchObject({ allowed: false, code: "MISSING_CAPABILITY" });
  });

  it("denies dispatch when a target declares capabilities but none permit dispatch", () => {
    expect(checkDispatchPolicy("memroos", remoteAgent([
      { id: "memory:write", name: "Memory", description: "", tags: [] },
    ]))).toMatchObject({
      allowed: false,
      code: "MISSING_CAPABILITY",
    });
  });

  it("falls back to agent.host when metadata endpointUrl is invalid", () => {
    process.env.MEMROOS_A2A_PROFILE = "cloud-https";
    const agent = remoteAgent([
      { id: "task:accept", name: "Accept Tasks", description: "", tags: [] },
    ]);
    agent.metadata = { a2a: { endpointUrl: "not-a-valid-url" } };
    agent.host = "203.0.113.10";
    expect(checkDispatchPolicy("memroos", agent)).toEqual({ allowed: true });
  });

  it("allows dispatch when target declares a dispatch-compatible capability", () => {
    expect(checkDispatchPolicy("memroos", remoteAgent([
      { id: "task:accept", name: "Accept Tasks", description: "", tags: [] },
    ]))).toEqual({ allowed: true });
  });

  it("denies A2A send when caller capabilities omit A2A send permission", () => {
    expect(checkA2aSendPolicy(registeredAgent([
      { id: "memory:write", name: "Memory", description: "", tags: [] },
    ]))).toMatchObject({
      allowed: false,
      code: "MISSING_CAPABILITY",
    });
  });

  it("allows legacy undeclared capabilities when explicit override env is set", () => {
    process.env.MEMROOS_A2A_PROFILE = "cloud-https";
    process.env.MEMROOS_ALLOW_LEGACY_UNDECLARED_CAPABILITIES = "1";
    expect(checkDispatchPolicy("memroos", remoteAgent())).toEqual({ allowed: true });
    expect(checkA2aSendPolicy(registeredAgent())).toEqual({ allowed: true });
  });

  it("allows tier-specific memory writes only for matching tiers", () => {
    const agent = registeredAgent([
      { id: "memory:write:episodic", name: "Episodic", description: "", tags: [] },
    ]);

    expect(checkMemoryWritePolicy(agent, "episodic")).toEqual({ allowed: true });
    expect(checkMemoryWritePolicy(agent, "graph")).toMatchObject({
      allowed: false,
      code: "MISSING_CAPABILITY",
    });
  });
});
