// @vitest-environment node
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initSchema } from "@/lib/db-schema";
import * as cicd from "@/lib/agent-cicd-gates";
import { createAgentVersion, promoteAgentVersion } from "@/lib/agent-cicd-gates";

let db: Database.Database | null = null;

afterEach(() => {
  vi.restoreAllMocks();
  db?.close();
  db = null;
});

describe("agent-cicd-gates batch37", () => {
  it.skip("promoteAgentVersion release gate failure (229) — promote calls evaluateReleaseGates via module-local binding; spy cannot intercept", () => {});
});