// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { buildSkillSuggestionAudit } from "../activity-suggestions";

const ROOT = path.join(os.tmpdir(), `act-sugg-b34-${randomUUID()}`);

afterEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("activity-suggestions batch34 — stat failures, cache, harness copy", () => {
  it("skips entries when statSync fails (101–102) and still scores reachable jsonl (87, 96, 110)", () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const activityRoot = path.join(ROOT, "memory");
    const goodDir = path.join(activityRoot, "good");
    fs.mkdirSync(goodDir, { recursive: true });
    const statSync = fs.statSync;
    vi.spyOn(fs, "statSync").mockImplementation((target) => {
      const p = target.toString();
      if (p.includes("bad-stat")) {
        throw new Error("EACCES batch34-stat");
      }
      return statSync.call(fs, target);
    });

    fs.mkdirSync(path.join(activityRoot, "bad-stat"), { recursive: true });
    const jsonl = path.join(goodDir, `evt-b34-${randomUUID().slice(0, 6)}.jsonl`);
    fs.writeFileSync(
      jsonl,
      `{"memory":"classification","policy":"vault","auth":"invite","oauth":"role"}\n`,
      "utf8",
    );

    const suggestions = buildSkillSuggestionAudit({
      now: new Date(),
      days: 365,
      activityRoots: { harnessB34: activityRoot },
      skillRoots: { memroos: path.join(ROOT, "skills-empty") },
    });
    expect(suggestions.length).toBeGreaterThan(0);
  });

  it("reuses default-root cache within five minutes (146, 166–168)", () => {
    const first = buildSkillSuggestionAudit({ days: 30 });
    const second = buildSkillSuggestionAudit({ days: 30 });
    expect(second).toBe(first);
  });

  it("extends recommendation when harness skill already exists (200–202, 209)", () => {
    fs.mkdirSync(ROOT, { recursive: true });
    const activityRoot = path.join(ROOT, "memory");
    const skillRoot = path.join(ROOT, "skills");
    const slugDir = path.join(skillRoot, "auth-team-hardening");
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(path.join(slugDir, "SKILL.md"), "---\nname: auth-team-hardening\n---\n", "utf8");
    const nested = path.join(activityRoot, "auth");
    fs.mkdirSync(nested, { recursive: true });
    const jsonl = path.join(nested, `auth-b34-${randomUUID().slice(0, 6)}.jsonl`);
    fs.writeFileSync(
      jsonl,
      `{"auth":"invite","password":"reset","oauth":"role","tenant":"lifecycle","api key":"rotate"}\n`.repeat(4),
      "utf8",
    );

    const suggestions = buildSkillSuggestionAudit({
      now: new Date(),
      days: 365,
      activityRoots: { harnessB34: activityRoot },
      skillRoots: { memroos: skillRoot },
    });
    const auth = suggestions.find((s) => s.slug === "auth-team-hardening");
    expect(auth?.recommendation).toMatch(/Existing harness coverage/i);
    expect(suggestions.every((s) => s.confidence >= 0.35 || s.evidence.length > 0)).toBe(true);
  });
});
