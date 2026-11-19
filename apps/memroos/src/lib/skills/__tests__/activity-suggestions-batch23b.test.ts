// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { buildSkillSuggestionAudit } from "@/lib/skills/activity-suggestions";

describe("activity-suggestions batch23b — custom roots and audit cache", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  it("scores patterns from recent jsonl activity under custom roots", () => {
    const activityRoot = fs.mkdtempSync(path.join(os.tmpdir(), `act-b23b-${randomUUID()}-`));
    const skillRoot = fs.mkdtempSync(path.join(os.tmpdir(), `skill-b23b-${randomUUID()}-`));
    roots.push(activityRoot, skillRoot);
    const logPath = path.join(activityRoot, "trace.jsonl");
    fs.writeFileSync(
      logPath,
      [
        JSON.stringify({ text: "memory classification policy sealed vault indexable" }),
        JSON.stringify({ text: "agent chat dispatch provider fallback model quota" }),
      ].join("\n"),
      "utf8",
    );
    const now = new Date();
    const suggestions = buildSkillSuggestionAudit({
      now,
      days: 30,
      activityRoots: { codex: activityRoot },
      skillRoots: { memroos: skillRoot },
    });
    const memory = suggestions.find((s) => s.slug === "memroos-memory-classification");
    const chat = suggestions.find((s) => s.slug === "agent-chat-provider-failover");
    expect(memory?.evidence.length).toBeGreaterThan(0);
    expect(chat?.evidence.length).toBeGreaterThan(0);
    expect(memory?.confidence).toBeGreaterThanOrEqual(0.35);
  });

  it("mentions existing harness coverage when SKILL.md is present for a slug", () => {
    const activityRoot = fs.mkdtempSync(path.join(os.tmpdir(), `act-skill-b23b-${randomUUID()}-`));
    const skillRoot = fs.mkdtempSync(path.join(os.tmpdir(), `skill-hit-b23b-${randomUUID()}-`));
    roots.push(activityRoot, skillRoot);
    fs.writeFileSync(
      path.join(activityRoot, "recent.jsonl"),
      JSON.stringify({ text: "memory classification policy sealed vault indexable" }),
      "utf8",
    );
    const slugDir = path.join(skillRoot, "memroos-memory-classification");
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(path.join(slugDir, "SKILL.md"), "---\nname: memroos-memory-classification\n---\n", "utf8");

    const suggestions = buildSkillSuggestionAudit({
      days: 30,
      activityRoots: { codex: activityRoot },
      skillRoots: { memroos: skillRoot },
    });
    const memory = suggestions.find((s) => s.slug === "memroos-memory-classification");
    expect(memory?.comparedHarnesses.memroos.exists).toBe(true);
    expect(memory?.recommendation).toMatch(/Existing harness coverage/i);
  });
});
