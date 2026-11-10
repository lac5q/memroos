// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { readSkillBudgetReport } from "@/lib/skill-budget";

const tempDirs: string[] = [];

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("skill-budget batch33b", () => {
  it("honors maxDepth and ignores deep SKILL.md trees (95)", async () => {
    const home = tmp(`skill-budget-b33b-depth-${randomUUID().slice(0, 8)}-`);
    const root = path.join(home, "shallow-root");
    const deep = path.join(root, "a", "b", "c", "d");
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, "SKILL.md"), "---\nname: deep\ndescription: buried\n---\n");
    fs.writeFileSync(
      path.join(root, "SKILL.md"),
      "---\nname: surface\ndescription: top\n---\n",
    );

    const report = await readSkillBudgetReport({
      home,
      budgetTokens: 500,
      roots: [{ id: "shallow", path: root, type: "runtime", maxDepth: 0 }],
      openclawConfigPath: path.join(home, "missing-openclaw.json"),
    });

    expect(report.uniqueSkills).toBe(1);
    expect(report.sources[0]?.skillCount).toBe(1);
  });

  it("treats non-array openclaw extraDirs as empty (150)", async () => {
    const home = tmp(`skill-budget-b33b-extra-${randomUUID().slice(0, 8)}-`);
    const skillRoot = path.join(home, "skills");
    fs.mkdirSync(skillRoot, { recursive: true });
    fs.writeFileSync(
      path.join(skillRoot, "SKILL.md"),
      "---\nname: solo\ndescription: only root skill\n---\n",
    );
    const configPath = path.join(home, "openclaw.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ skills: { load: { extraDirs: "not-an-array-b33b" } } }),
    );

    const report = await readSkillBudgetReport({
      home,
      budgetTokens: 500,
      roots: [{ id: "solo", path: skillRoot, type: "runtime", maxDepth: 2 }],
      openclawConfigPath: configPath,
    });

    expect(report.uniqueSkills).toBe(1);
    expect(report.sources.some((s) => s.id.startsWith("openclaw-extra"))).toBe(false);
  });
});
