// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { existsSync, execFileSync } = vi.hoisted(() => ({
  existsSync: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: { existsSync },
  existsSync,
}));

vi.mock("node:child_process", () => ({
  execFileSync,
}));

import { detectInstalledHarnesses } from "../host-installed";

describe("detectInstalledHarnesses", () => {
  beforeEach(() => {
    existsSync.mockReset();
    execFileSync.mockReset();
  });

  it("returns harness when config dir and binary exist", () => {
    existsSync.mockImplementation((p: string) => p.endsWith("/.claude"));
    execFileSync.mockImplementation((cmd: string) => {
      if (cmd === "which") return "/usr/local/bin/claude\n";
      if (cmd.includes("claude")) return "claude 2.1.0\n";
      return "";
    });

    const found = detectInstalledHarnesses({
      hostId: "host-a",
      homeDir: "/home/op",
      skipVersions: false,
    });

    expect(found.some((h) => h.id === "host-a:claude" && h.platform === "claude")).toBe(true);
    expect(found.find((h) => h.id === "host-a:claude")?.version).toBe("claude 2.1.0");
  });

  it("skips probes without config directory even if binary exists", () => {
    existsSync.mockReturnValue(false);
    execFileSync.mockImplementation((cmd: string, args?: string[]) => {
      if (cmd === "which") return "/usr/bin/codex\n";
      return "";
    });

    expect(
      detectInstalledHarnesses({ hostId: "host-b", homeDir: "/home/op", skipVersions: true }),
    ).toEqual([]);
  });

  it("detects Hermes runtime directory without binary", () => {
    existsSync.mockImplementation((p: string) => p.endsWith("/.hermes/hermes-agent"));
    execFileSync.mockReturnValue("");

    const found = detectInstalledHarnesses({
      hostId: "host-c",
      homeDir: "/home/op",
      skipVersions: true,
    });

    expect(found.some((h) => h.id === "host-c:hermes" && h.binary === null)).toBe(true);
  });
});
