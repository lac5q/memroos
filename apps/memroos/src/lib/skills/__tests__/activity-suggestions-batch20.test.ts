// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tmpRoots.length = 0;
});

describe("activity-suggestions batch20 — walkRecentFiles and cache", () => {
  it("buildSkillSuggestionAudit walks custom activity roots and skips unreadable dirs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `act-b20-${crypto.randomUUID()}-`));
    tmpRoots.push(root);
    const activity = path.join(root, "claude");
    fs.mkdirSync(activity, { recursive: true });
    const recent = path.join(activity, "recent.jsonl");
    fs.writeFileSync(
      recent,
      JSON.stringify({ text: "email campaign workflow template sequence" }) + "\n",
      "utf8",
    );
    fs.utimesSync(recent, new Date(), new Date());
    const blocked = path.join(activity, "blocked");
    fs.mkdirSync(blocked);
    fs.chmodSync(blocked, 0o000);
    const skillRoot = path.join(root, "skills");
    fs.mkdirSync(skillRoot, { recursive: true });

    const { buildSkillSuggestionAudit } = await import("../activity-suggestions");
    const suggestions = buildSkillSuggestionAudit({
      now: new Date(),
      days: 30,
      activityRoots: { claude: activity },
      skillRoots: { memroos: skillRoot },
    });
    expect(Array.isArray(suggestions)).toBe(true);
    fs.chmodSync(blocked, 0o755);
  });

  it("buildSkillSuggestionAudit reuses default-root cache within five minutes", async () => {
    const { buildSkillSuggestionAudit } = await import("../activity-suggestions");
    const first = buildSkillSuggestionAudit({ days: 7 });
    const second = buildSkillSuggestionAudit({ days: 7 });
    expect(second).toBe(first);
  });
});
