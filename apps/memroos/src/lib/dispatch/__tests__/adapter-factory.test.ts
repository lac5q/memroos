// @vitest-environment node
import { describe, it, expect } from "vitest";
import { selectAdapter } from "../adapter-factory";
import { a2aAdapter } from "../a2a-adapter";
import { hivePollAdapter } from "../hive-poll-adapter";
import { openclawAdapter } from "../openclaw-adapter";
import type { RemoteAgentConfig } from "@/types";

function makeAgent(id: string, platform: RemoteAgentConfig["platform"]): RemoteAgentConfig {
  return {
    id,
    name: id,
    role: "test",
    platform,
    location: "local",
    host: "localhost",
    port: 3000,
    healthEndpoint: "/health",
  };
}

describe("selectAdapter", () => {
  it("a2a protocol -> a2a adapter", () => {
    expect(
      selectAdapter({
        ...makeAgent("remote-a2a", "claude"),
        protocol: "a2a",
      })
    ).toBe(a2aAdapter);
  });

  it("unknown platform falls back to hive-poll", () => {
    expect(selectAdapter(makeAgent("unknown", "unknown-platform" as RemoteAgentConfig["platform"]))).toBe(
      hivePollAdapter
    );
  });

  it("sophia (claude) -> hive-poll", () => {
    expect(selectAdapter(makeAgent("sophia", "claude"))).toBe(hivePollAdapter);
  });

  it("maria (claude) -> hive-poll", () => {
    expect(selectAdapter(makeAgent("maria", "claude"))).toBe(hivePollAdapter);
  });

  it("lucia (claude) -> hive-poll", () => {
    expect(selectAdapter(makeAgent("lucia", "claude"))).toBe(hivePollAdapter);
  });

  it("alba (opencode) -> openclaw", () => {
    expect(selectAdapter(makeAgent("alba", "opencode"))).toBe(openclawAdapter);
  });

  it("openclaw platform -> openclaw queue adapter", () => {
    expect(selectAdapter(makeAgent("gwen", "openclaw"))).toBe(openclawAdapter);
  });

  it("gwen (claude) -> hive-poll (platform=claude, not opencode)", () => {
    expect(selectAdapter(makeAgent("gwen", "claude"))).toBe(hivePollAdapter);
  });

  it("codex platform -> hive-poll", () => {
    expect(selectAdapter(makeAgent("codex-agent", "codex"))).toBe(hivePollAdapter);
  });

  it("gemini platform -> hive-poll", () => {
    expect(selectAdapter(makeAgent("gemini-agent", "gemini"))).toBe(hivePollAdapter);
  });

  it("qwen platform -> hive-poll", () => {
    expect(selectAdapter(makeAgent("qwen-agent", "qwen"))).toBe(hivePollAdapter);
  });

  it("zcode platform -> hive-poll", () => {
    expect(selectAdapter(makeAgent("zcode-agent", "zcode"))).toBe(hivePollAdapter);
  });
});
