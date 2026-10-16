// @vitest-environment node
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { filterNativeMemory } from "@/lib/native-memory/filter";
import {
  processNativeMemoryIngest,
  NATIVE_MEMORY_SINK_POLICY,
} from "@/lib/native-memory/sink";
import { DIRECTIVE_BUDGET_ENFORCEMENT } from "@/lib/directive-budget";
import { getRepoRoot } from "@/lib/paths";

describe("native-memory sink (ENTOPS-07 code slice)", () => {
  it("redacts HIGH-severity secrets from replay payload", () => {
    const secret = "ghp_" + "a".repeat(36);
    const content = `token=${secret}\nnotes=ok\n`;
    const filtered = filterNativeMemory(content);
    expect(filtered.redacted).toBe(true);
    expect(filtered.sanitized).not.toContain(secret);
    expect(filtered.sanitized).toContain("[REDACTED]");
  });

  it("skips diff alerts when canonical content matches", () => {
    const content = "line1\nline2\n";
    const result = processNativeMemoryIngest({
      source: "codex",
      agentId: "agent-2",
      userId: "user-2",
      content,
      memoryPath: "MEMORY.md",
      canonicalContent: content,
    });
    expect(result.diff?.identical).toBe(true);
    expect(result.alerts.some((a) => a.includes("directive_diff"))).toBe(false);
  });

  it("returns replay + budget + warn-only diff; never deletes", () => {
    const local = "line1\nline2-extra\n";
    const canonical = "line1\nline2\n";
    const result = processNativeMemoryIngest({
      source: "claude",
      agentId: "agent-1",
      userId: "user-1",
      content: local,
      memoryPath: "~/.claude/memory.md",
      canonicalContent: canonical,
    });

    expect(result.replay).toBe(local);
    expect(result.diff).not.toBeNull();
    expect(result.diff!.warnOnly).toBe(true);
    expect(result.diff!.identical).toBe(false);
    expect(result.enforcement).toBe(DIRECTIVE_BUDGET_ENFORCEMENT);
    expect(result.enforcement).toBe("warn_only");
    expect(NATIVE_MEMORY_SINK_POLICY.neverDelete).toBe(true);
    expect(NATIVE_MEMORY_SINK_POLICY.neverAutoTrim).toBe(true);
    expect(NATIVE_MEMORY_SINK_POLICY.harnessWiring).toBe("hermes_observe_opt_in");
    expect(result.alerts.some((a) => a.includes("directive_diff"))).toBe(true);
  });

  it("does not auto-trim over-budget content — only warns", () => {
    const lines = Array.from({ length: 250 }, (_, i) => `line-${i}`).join("\n");
    const result = processNativeMemoryIngest({
      source: "hermes",
      agentId: "hermes",
      userId: "user-1",
      content: lines,
      memoryPath: "MEMORY.md",
    });
    expect(result.budgetStatus).toBe("over");
    expect(result.replay).toBe(lines);
    expect(result.budget.overByLines).toBeGreaterThan(0);
  });

  it("Hermes MEMORY.md skills-routing layer is untouched (grep-proof)", () => {
    const repo = getRepoRoot();
    const candidates = [
      path.join(repo, "apps/memroos/src/lib/native-memory"),
      path.join(repo, "apps/memroos/src/app/api/native-memory"),
    ];
    for (const dir of candidates) {
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".ts")) continue;
        const text = fs.readFileSync(path.join(dir, file), "utf8");
        // Phase must not rewrite Hermes skills-routing — no writeFile to MEMORY.md.
        expect(text).not.toMatch(/writeFileSync\([^)]*MEMORY\.md/);
        expect(text).not.toMatch(/skills-routing/);
      }
    }
  });
});
