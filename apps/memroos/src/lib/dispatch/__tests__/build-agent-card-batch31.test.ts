// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { buildAgentCard } from "../build-agent-card";
import type { RemoteAgentConfig } from "@/types";

describe("build-agent-card batch31", () => {
  it("uses tunnelUrl for cloudflare agents", () => {
    const agent: RemoteAgentConfig = {
      id: `agent-b31-${randomUUID().slice(0, 8)}`,
      name: "Batch31 Cloud",
      host: "ignored.example",
      port: 9000,
      platform: "openclaw",
      location: "cloudflare",
      role: "researcher",
      tunnelUrl: "https://localhost-tunnel-b31.example/mcp",
      skills: [],
    };
    const card = buildAgentCard(agent);
    expect(card.url).toBe("https://localhost-tunnel-b31.example/mcp");
    expect(card.extensions.memroos.id).toBe(agent.id);
  });

  it("falls back to deriveSkills when skills array is empty", () => {
    const agent: RemoteAgentConfig = {
      id: `agent-b31b-${randomUUID().slice(0, 8)}`,
      name: "Batch31 Local",
      host: "localhost",
      port: 3000,
      platform: "openclaw",
      location: "local",
      role: "operator",
    };
    const card = buildAgentCard(agent);
    expect(card.url).toBe("http://localhost:3000");
    expect(card.skills.length).toBeGreaterThan(0);
    expect(card.capabilities.stateTransitionHistory).toBe(true);
  });
});
