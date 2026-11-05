// @vitest-environment node
import { randomUUID } from "node:crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { buildSkillSuggestionAudit } from "../activity-suggestions";

describe("activity-suggestions batch22b — custom roots and cache", () => {
  let tmpRoot: string;

  afterEach(() => {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("buildSkillSuggestionAudit scans custom activity roots and respects cache", () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), `activity-b22b-${randomUUID()}-`));
    const activityRoot = path.join(tmpRoot, "activity");
    const skillRoot = path.join(tmpRoot, "skills");
    fs.mkdirSync(activityRoot, { recursive: true });
    fs.mkdirSync(path.join(skillRoot, "deploy-checklist"), { recursive: true });
    fs.writeFileSync(path.join(skillRoot, "deploy-checklist", "SKILL.md"), "# deploy", "utf8");
    const jsonl = path.join(activityRoot, "session.jsonl");
    fs.writeFileSync(
      jsonl,
      `${JSON.stringify({ text: "need deploy checklist runbook deploy checklist" })}\n`,
      "utf8",
    );
    const now = new Date();
    const first = buildSkillSuggestionAudit({
      now,
      days: 30,
      activityRoots: { codex: activityRoot },
      skillRoots: { memroos: skillRoot },
    });
    const second = buildSkillSuggestionAudit({
      now,
      days: 30,
      activityRoots: { codex: activityRoot },
      skillRoots: { memroos: skillRoot },
    });
    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
  });
});
