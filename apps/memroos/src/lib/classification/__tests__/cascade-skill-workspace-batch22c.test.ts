// @vitest-environment node
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { initSchema } from "@/lib/db-schema";
import { classifyText, decideClassificationReview, listClassificationReviews } from "../cascade";
import { loadWorkspace, recordCrossSpaceRead } from "@/lib/workspace";

const TMP = path.join(os.tmpdir(), `cascade-skill-workspace-b22c-${crypto.randomUUID()}`);
const skillsRoot = path.join(TMP, "skills");
const statePath = path.join(TMP, "skill-review-state.json");

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("classification cascade batch22c", () => {
  it("classifyText detects personal domain keywords and skips input_too_long scanner noise", () => {
    const personal = classifyText({
      content: "This mentions family medical history and a home address.",
      sourceType: "message",
      metadata: {},
    });
    expect(personal.label.domain).toBe("personal");

    const long = "x".repeat(5000);
    const chunked = classifyText({ content: long, sourceType: "message", metadata: {} });
    expect(chunked.reasonCodes.length).toBeGreaterThan(0);
  });

  it("decideClassificationReview rejects missing reviews and lists malformed JSON arrays", () => {
    const db = new Database(":memory:");
    initSchema(db);
    expect(() =>
      decideClassificationReview(db, "missing-review", {
        decision: "approve",
        reviewerId: "operator",
      }),
    ).toThrow(/not found/i);

    db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('default-tenant', 'Default')`).run();
    db.prepare(
      `INSERT INTO raw_artifacts
        (id, tenant_id, source_type, source_id, session_id, artifact_uri, artifact_path, content_hash, created_at)
       VALUES ('art-1', 'default-tenant', 'message', 'src', 'sess', 'vault://art-1', '/tmp/art-1', 'sha256:artifact', '2026-01-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO classification_reviews
        (id, tenant_id, artifact_id, source_type, source_id, session_id, status, reason_codes_json, evidence_spans_json,
         proposed_visibility, proposed_domain, proposed_sensitivity, proposed_policy, created_at)
       VALUES ('rev-b22c', 'default-tenant', 'art-1', 'message', 'src', 'sess', 'open', 'not-json', '[]',
               'private', 'engineering', 'internal', 'sealed', '2026-01-01T00:00:00Z')`,
    ).run();
    const listed = listClassificationReviews(db, { tenantId: "default-tenant", status: "all", limit: 5 });
    expect(listed[0]?.reasonCodes).toEqual([]);
    db.close();
  });
});

describe("skill-workflow + workspace batch22c", () => {
  beforeEach(() => {
    process.env.SKILL_REVIEW_STATE_PATH = statePath;
    fs.rmSync(statePath, { force: true });
    fs.rmSync(skillsRoot, { recursive: true, force: true });
    fs.mkdirSync(skillsRoot, { recursive: true });
  });

  it("readSkillReviewState ignores invalid records and metadataStage infers enterprise", async () => {
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        "bad-skill": { stage: "not-a-stage", status: "approved" },
        "good-skill": { stage: "general", status: "approved", notes: "", draftBody: "", changeReason: "", updatedAt: "", updatedBy: "op" },
      }),
      "utf8",
    );
    const skillDir = path.join(skillsRoot, "enterprise-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: enterprise-skill
description: Enterprise compliance governance workflow
owner: ops
---
# Enterprise Skill
Use when validating governance controls.
`,
      "utf8",
    );
    const { readSkillReviewState, buildSkillWorkflowItems } = await import("@/lib/skill-workflow");
    const state = await readSkillReviewState();
    expect(state["bad-skill"]).toBeUndefined();
    expect(state["good-skill"]?.stage).toBe("general");
    const items = await buildSkillWorkflowItems({
      skillsPath: skillsRoot,
      skillNames: ["enterprise-skill"],
      coverageGaps: [],
      skillUsage: {},
      reviewState: state,
    });
    expect(items[0]?.stage).toBe("enterprise");
  });

  it("loadWorkspace and recordCrossSpaceRead validate required identifiers", () => {
    const db = new Database(":memory:");
    initSchema(db);
    db.prepare(`INSERT OR IGNORE INTO tenants (id, name) VALUES ('default-tenant', 'Default')`).run();
    db.prepare(`INSERT INTO spaces (id, tenant_id, name) VALUES ('space-a', 'default-tenant', 'Space A')`).run();
    expect(() => loadWorkspace(db, { spaceId: " ", actorId: "operator" })).toThrow(/spaceId is required/i);
    expect(() => loadWorkspace(db, { spaceId: "space-a", actorId: " " })).toThrow(/actorId is required/i);
    loadWorkspace(db, { spaceId: "space-a", actorId: "operator" });
    expect(() =>
      recordCrossSpaceRead(db, { fromSpaceId: " ", toSpaceId: "space-a", actorId: "operator" }),
    ).toThrow(/fromSpaceId is required/i);
    expect(() =>
      recordCrossSpaceRead(db, { fromSpaceId: "space-a", toSpaceId: " ", actorId: "operator" }),
    ).toThrow(/toSpaceId is required/i);
    expect(() =>
      recordCrossSpaceRead(db, { fromSpaceId: "space-a", toSpaceId: "space-a", actorId: " " }),
    ).toThrow(/actorId is required/i);
    recordCrossSpaceRead(db, { fromSpaceId: "space-a", toSpaceId: "space-a", actorId: "operator" });
    db.close();
  });
});
