// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readSkillBudgetReport,
  summarizeSkillBudget,
  type SkillCatalogEntry,
} from "@/lib/skill-budget";

function entry(
  name: string,
  description: string,
  sourceId = "runtime"
): SkillCatalogEntry {
  return {
    name,
    description,
    path: `/tmp/${sourceId}/${name}/SKILL.md`,
    sourceId,
    sourceType: sourceId.includes("plugin") ? "plugin" : "runtime",
  };
}

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.SKILL_BUDGET_ROOTS;
  delete process.env.SKILL_METADATA_BUDGET_TOKENS;
  delete process.env.CODEX_PLUGIN_SKILLS_PATH;
});

describe("summarizeSkillBudget", () => {
  it("dedupes skill names before calculating model-visible metadata", () => {
    const report = summarizeSkillBudget(
      [
        entry("browser", "Open and inspect browser targets.", "codex-runtime"),
        entry("browser", "Duplicate plugin browser skill.", "plugin-cache"),
        entry("github", "Manage GitHub issues and pull requests.", "plugin-cache"),
      ],
      500
    );

    expect(report.totalSkills).toBe(3);
    expect(report.uniqueSkills).toBe(2);
    expect(report.duplicateSkills).toEqual(["browser"]);
    expect(report.metadataChars).toBeLessThan(120);
    expect(report.recommendations).toContain(
      "Dedupe duplicate skill names across source, runtime, and plugin roots before rendering prompt metadata."
    );
  });

  it("sorts duplicate skill names lexicographically when multiple names collide", () => {
    const report = summarizeSkillBudget(
      [
        entry("zebra", "z", "src-a"),
        entry("zebra", "z dup", "src-b"),
        entry("alpha", "a", "src-a"),
        entry("alpha", "a dup", "src-b"),
      ],
      500
    );
    expect(report.duplicateSkills).toEqual(["alpha", "zebra"]);
  });

  it("flags over-budget catalogs with actionable recommendations", () => {
    const entries = Array.from({ length: 90 }, (_, index) =>
      entry(
        `skill-${index}`,
        "This description is intentionally verbose so it simulates a client catalog that should be projected into a smaller runtime set."
      )
    );

    const report = summarizeSkillBudget(entries, 200);

    expect(report.status).toBe("over");
    expect(report.recommendations).toContain(
      "Reduce model-visible skill metadata before startup; current metadata exceeds the configured budget."
    );
    expect(report.recommendations).toContain(
      "Use role-specific runtime projections instead of exposing the full shared skill catalog."
    );
  });

  it("marks watch status and long-description recommendations", () => {
    const longDesc = "x".repeat(200);
    // metadataChars = 4 + 200 + 4 = 208 → 52 tokens; budget 55 → ~0.95 utilization (watch)
    const report = summarizeSkillBudget([entry("long", longDesc)], 55);
    expect(report.status).toBe("watch");
    expect(report.recommendations).toContain(
      "Shorten long frontmatter descriptions; keep routing descriptions under 180 characters and put details in the skill body."
    );
  });

  it("handles empty catalogs and zero budgets", () => {
    const report = summarizeSkillBudget([], 0);
    expect(report.status).toBe("ok");
    expect(report.uniqueSkills).toBe(0);
    expect(report.averageDescriptionChars).toBe(0);
    expect(report.utilization).toBe(0);
    expect(report.sources).toEqual([]);
  });
});

describe("readSkillBudgetReport", () => {
  it("discovers skills from roots, parses frontmatter, and merges openclaw extras", async () => {
    const home = makeTempDir("skill-budget-home-");
    const skillRoot = path.join(home, "skills");
    const nested = path.join(skillRoot, "browser");
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(path.join(skillRoot, "node_modules", "ignored"), { recursive: true });
    fs.writeFileSync(path.join(skillRoot, "node_modules", "ignored", "SKILL.md"), "---\nname: ignored\n---\n");
    fs.writeFileSync(
      path.join(nested, "SKILL.md"),
      `---\nname: "browser"\ndescription: 'Open pages'\n---\n# Body\n`
    );
    fs.writeFileSync(path.join(skillRoot, "README.md"), "not a skill");
    fs.writeFileSync(path.join(skillRoot, "broken-dir"), "file");

    const bareDir = path.join(skillRoot, "fallback-name");
    fs.mkdirSync(bareDir, { recursive: true });
    fs.writeFileSync(path.join(bareDir, "SKILL.md"), "# no frontmatter\n");

    const unreadableDir = path.join(skillRoot, "unreadable");
    fs.mkdirSync(unreadableDir, { recursive: true });
    fs.writeFileSync(path.join(unreadableDir, "SKILL.md"), "---\nname: secret\n---\n");
    fs.chmodSync(path.join(unreadableDir, "SKILL.md"), 0);

    const openclawConfig = path.join(home, "openclaw.json");
    const extraRoot = path.join(home, "extra-skills", "extra");
    fs.mkdirSync(extraRoot, { recursive: true });
    fs.writeFileSync(
      path.join(extraRoot, "SKILL.md"),
      "---\nname: extra\ndescription: configured root\n---\n"
    );
    fs.writeFileSync(
      openclawConfig,
      JSON.stringify({
        skills: { load: { extraDirs: [path.join(home, "extra-skills"), "", 12] } },
      })
    );

    const report = await readSkillBudgetReport({
      home,
      budgetTokens: 1000,
      roots: [
        { id: "primary", path: skillRoot, type: "runtime", maxDepth: 3 },
        { id: "primary-dup", path: skillRoot, type: "runtime", maxDepth: 3 },
        { id: "missing", path: path.join(home, "missing"), type: "source", maxDepth: 2 },
      ],
      openclawConfigPath: openclawConfig,
    });

    expect(report.totalSkills).toBeGreaterThanOrEqual(2);
    expect(report.uniqueSkills).toBeGreaterThanOrEqual(2);
    expect(report.sources.some((source) => source.id === "primary")).toBe(true);
    expect(report.sources.some((source) => source.id === "openclaw-extra-1")).toBe(true);
  });

  it("uses SKILL_BUDGET_ROOTS env defaults and tolerates bad openclaw configs", async () => {
    const root = makeTempDir("skill-budget-env-");
    const skillDir = path.join(root, "env-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: env-skill\ndescription: from env root\n---\n"
    );
    process.env.SKILL_BUDGET_ROOTS = `${root}${path.delimiter}${root}`;
    process.env.SKILL_METADATA_BUDGET_TOKENS = "250";

    const report = await readSkillBudgetReport({
      home: makeTempDir("skill-budget-empty-home-"),
      openclawConfigPath: path.join(root, "missing-openclaw.json"),
    });

    expect(report.budgetTokens).toBe(250);
    expect(report.uniqueSkills).toBe(1);
    expect(report.sources[0]?.id).toBe("env-root-1");
  });

  it("falls back to home default roots when env roots are unset", async () => {
    const home = makeTempDir("skill-budget-default-home-");
    const codexSkills = path.join(home, ".codex", "skills", "demo");
    fs.mkdirSync(codexSkills, { recursive: true });
    fs.writeFileSync(
      path.join(codexSkills, "SKILL.md"),
      '---\nname: demo\ndescription: "quoted"\n---\n'
    );
    fs.mkdirSync(path.join(home, ".openclaw"), { recursive: true });
    fs.writeFileSync(path.join(home, ".openclaw", "openclaw.json"), "{not-json");

    const report = await readSkillBudgetReport({ home, budgetTokens: 500 });
    expect(report.uniqueSkills).toBe(1);
    expect(report.sources.some((source) => source.id === "codex-runtime")).toBe(true);
  });
});
