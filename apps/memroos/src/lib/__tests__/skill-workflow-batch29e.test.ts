// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { readSkillReviewState } from "@/lib/skill-workflow";

const TMP = path.join(os.tmpdir(), `skill-wf-b29e-${randomUUID()}`);

afterEach(() => {
  delete process.env.SKILL_REVIEW_STATE_PATH;
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("skill-workflow batch29e — readSkillReviewState invalid row paths", () => {
  it("skips non-object values and invalid stage/status (lines 85–91)", async () => {
    fs.mkdirSync(TMP, { recursive: true });
    const statePath = path.join(TMP, "skill-review-state-b29e.json");
    process.env.SKILL_REVIEW_STATE_PATH = statePath;
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        "good-batch29e": {
          stage: "general",
          status: "approved",
          notes: "",
          draftBody: "",
          changeReason: "",
          updatedAt: "2026-01-01T00:00:00.000Z",
          updatedBy: "tester",
        },
        "bad-value-batch29e": "not-an-object",
        "bad-stage-batch29e": {
          stage: "not-a-real-stage",
          status: "approved",
        },
        "bad-status-batch29e": {
          stage: "general",
          status: "not-a-real-status",
        },
      }),
      "utf8",
    );

    const state = await readSkillReviewState();
    expect(Object.keys(state)).toEqual(["good-batch29e"]);
    expect(state["good-batch29e"]?.stage).toBe("general");
  });

  it("metadataStage promotes enterprise when raw mentions governance (line 277)", async () => {
    const skillsPath = path.join(TMP, "skills-b29e");
    fs.mkdirSync(skillsPath, { recursive: true });
    const name = `skill-gov-${randomUUID().slice(0, 8)}`;
    const dir = path.join(skillsPath, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      [
        "---",
        "name: batch29e",
        "---",
        "",
        "This skill covers compliance and governance checks for enterprise workflows.",
      ].join("\n"),
      "utf8",
    );

    const { buildSkillWorkflowItems } = await import("@/lib/skill-workflow");
    const items = await buildSkillWorkflowItems({
      skillsPath,
      skillNames: [name],
      coverageGaps: [],
      skillUsage: {},
      reviewState: {},
    });
    expect(items[0]?.stage).toBe("enterprise");
  });
});
