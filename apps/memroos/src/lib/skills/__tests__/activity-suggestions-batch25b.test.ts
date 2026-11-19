// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { buildSkillSuggestionAudit } from "@/lib/skills/activity-suggestions";

describe("activity-suggestions batch25b — empty roots and harness coverage", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  it("still emits baseline catalog suggestions when activity roots are empty", () => {
    const suggestions = buildSkillSuggestionAudit({
      days: 7,
      activityRoots: {},
      skillRoots: {},
    });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((s) => Object.keys(s.comparedHarnesses).length === 0)).toBe(true);
  });

  it("records missing harness coverage when skill file is absent", () => {
    const activityRoot = fs.mkdtempSync(path.join(os.tmpdir(), `act-b25b-${randomUUID()}-`));
    const skillRoot = fs.mkdtempSync(path.join(os.tmpdir(), `skill-b25b-${randomUUID()}-`));
    roots.push(activityRoot, skillRoot);
    fs.writeFileSync(
      path.join(activityRoot, "trace.jsonl"),
      JSON.stringify({ text: "memory classification policy sealed vault indexable" }),
      "utf8",
    );
    const suggestions = buildSkillSuggestionAudit({
      days: 30,
      activityRoots: { codex: activityRoot },
      skillRoots: { memroos: skillRoot },
    });
    const memory = suggestions.find((s) => s.slug === "memroos-memory-classification");
    expect(memory?.comparedHarnesses.memroos.exists).toBe(false);
  });
});
