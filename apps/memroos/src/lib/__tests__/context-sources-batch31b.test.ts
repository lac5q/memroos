// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { evaluateContextSources } from "../context-sources";

describe("context-sources batch31b — single-file document counts", () => {
  const files: string[] = [];

  afterEach(() => {
    for (const file of files) fs.rmSync(file, { force: true });
    files.length = 0;
  });

  it("defaultCountDocs returns 1 when sourcePath is a markdown file (lines 126-128)", () => {
    const file = path.join(os.tmpdir(), `ctx-file-b31b-${randomUUID()}.md`);
    fs.writeFileSync(file, "# solo file\n", "utf8");
    files.push(file);

    const health = evaluateContextSources(
      {
        sources: [
          {
            id: "markdown-file",
            type: "local-folder",
            enabled: true,
            requiredTools: [],
            envVars: [],
            sourcePath: file,
            ingestCommand: null,
            indexCommand: null,
            freshnessThresholdMinutes: 10_000,
            qmdCollection: null,
            safeAnswerPolicy: "optional",
          },
        ],
      },
      { now: new Date("2026-11-08T00:00:00Z") },
    );
    expect(health.sources[0].documentCount).toBe(1);
  });
});
