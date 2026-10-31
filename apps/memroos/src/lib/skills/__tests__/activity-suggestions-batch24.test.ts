// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { buildSkillSuggestionAudit } from "@/lib/skills/activity-suggestions";

describe("activity-suggestions batch24 — walk limits and cache reuse", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  it("ignores unreadable directories while walking activity roots", () => {
    const activityRoot = fs.mkdtempSync(path.join(os.tmpdir(), `act-b24-${randomUUID()}-`));
    const skillRoot = fs.mkdtempSync(path.join(os.tmpdir(), `skill-b24-${randomUUID()}-`));
    roots.push(activityRoot, skillRoot);
    const blocked = path.join(activityRoot, "blocked");
    fs.mkdirSync(blocked, { recursive: true });
    fs.chmodSync(blocked, 0o000);
    fs.writeFileSync(
      path.join(activityRoot, "open.jsonl"),
      JSON.stringify({ text: "memory classification policy sealed vault indexable" }),
      "utf8",
    );
    try {
      const suggestions = buildSkillSuggestionAudit({
        days: 30,
        activityRoots: { codex: activityRoot },
        skillRoots: { memroos: skillRoot },
      });
      expect(suggestions.some((s) => s.slug === "memroos-memory-classification")).toBe(true);
    } finally {
      fs.chmodSync(blocked, 0o755);
    }
  });

  it("matches skills using underscore slug variants when SKILL.md uses dashes", () => {
    const activityRoot = fs.mkdtempSync(path.join(os.tmpdir(), `act-slug-b24-${randomUUID()}-`));
    const skillRoot = fs.mkdtempSync(path.join(os.tmpdir(), `skill-slug-b24-${randomUUID()}-`));
    roots.push(activityRoot, skillRoot);
    fs.writeFileSync(
      path.join(activityRoot, "recent.jsonl"),
      JSON.stringify({ text: "memory classification policy sealed vault indexable" }),
      "utf8",
    );
    const slugDir = path.join(skillRoot, "memroos_memory_classification");
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(path.join(slugDir, "SKILL.md"), "---\nname: memroos-memory-classification\n---\n", "utf8");
    const suggestions = buildSkillSuggestionAudit({
      days: 30,
      activityRoots: { codex: activityRoot },
      skillRoots: { memroos: skillRoot },
    });
    const memory = suggestions.find((s) => s.slug === "memroos-memory-classification");
    expect(memory?.comparedHarnesses.memroos.exists).toBe(true);
  });
});
