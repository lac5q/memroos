// @vitest-environment node
import { describe, expect, it } from "vitest";

import { computeContentHash } from "@/lib/skills/registry";
import { SkillSyncError, diffSkills, requireHarness } from "../skill-sync";

describe("skill-sync batch16b — harness validation and diffs", () => {
  it("requireHarness rejects unsupported harness names", () => {
    expect(() => requireHarness("unknown-harness")).toThrow(SkillSyncError);
    expect(requireHarness("codex")).toBe("codex");
  });

  it("diffSkills classifies add, no_change, and change", () => {
    const body = "---\nname: demo\nversion: 1\n---\n# Demo";
    const hash = computeContentHash(body);
    const detected = {
      skill_name: "demo",
      source_harness: "claude" as const,
      raw_body: body,
      content_hash: hash,
      version: "1",
    };
    const add = diffSkills(null, detected);
    expect(add.kind).toBe("add");

    const noChange = diffSkills(
      { skill_name: "demo", source_harness: "claude", content_hash: hash, version: "1" },
      detected,
    );
    expect(noChange.kind).toBe("no_change");

    const changedBody = body.replace("Demo", "Demo v2");
    const change = diffSkills(
      { skill_name: "demo", source_harness: "claude", content_hash: hash, raw_body: body, version: "1" },
      {
        ...detected,
        raw_body: changedBody,
        content_hash: computeContentHash(changedBody),
        version: "2",
      },
    );
    expect(change.kind).toBe("change");
    expect(change.changed_fields.some((f) => f.field === "content_hash")).toBe(true);
  });
});
