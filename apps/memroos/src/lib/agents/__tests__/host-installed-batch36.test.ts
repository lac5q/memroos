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

describe("host-installed batch36 — sort comparator (149)", () => {
  beforeEach(() => {
    existsSync.mockReset();
    execFileSync.mockReset();
  });

  it("returns harnesses sorted by display name via localeCompare", () => {
    existsSync.mockImplementation((p: string) => {
      return (
        p.endsWith("/.openclaw") ||
        p.endsWith("/.claude") ||
        p.endsWith("/.hermes/hermes-agent")
      );
    });
    execFileSync.mockImplementation((cmd: string, args?: string[]) => {
      if (cmd === "which") {
        const bin = args?.[0];
        return bin === "claude" || bin === "openclaw" ? `/usr/bin/${bin}\n` : "";
      }
      if (cmd === "claude") return "2.0.0\n";
      if (cmd === "openclaw") return "2026.7.1\n";
      return "";
    });

    const found = detectInstalledHarnesses({
      hostId: "host-b36",
      homeDir: "/home/b36",
      skipVersions: false,
    });

    const names = found.map((h) => h.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(found.length).toBeGreaterThanOrEqual(2);
  });
});
