/**
 * Observe capture depth policy tests (v8.16 Phase 167).
 */
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureCodingAgentSession } from "@/lib/agent-memory-continuity";
import { initSchema } from "@/lib/db-schema";
import {
  looksLikeTranscriptDump,
  projectCaptureDepth,
  resolveCaptureDepth,
} from "@/lib/observe-capture-depth";
import { readVaultArtifact } from "@/lib/vault/writer";

describe("observe capture depth policy", () => {
  it("detects transcript dump patterns", () => {
    expect(looksLikeTranscriptDump("user: hello\nassistant: hi\n".repeat(30))).toBe(true);
    expect(looksLikeTranscriptDump("short note")).toBe(false);
  });

  it("defaults to relevant and accepts env override", () => {
    expect(resolveCaptureDepth(undefined, undefined)).toBe("relevant");
    expect(resolveCaptureDepth("summary")).toBe("summary");
    expect(resolveCaptureDepth(undefined, "full")).toBe("full");
    expect(resolveCaptureDepth("nope", "summary")).toBe("summary");
    expect(resolveCaptureDepth("FULL")).toBe("full");
  });

  it("relevant projection never indexes transcript text", () => {
    const transcript = Array.from({ length: 20 }, (_, i) => `user: hi ${i}\nassistant: hello ${i}`).join("\n");
    const projected = projectCaptureDepth({
      summary: "Fixed wiki reader",
      decisionIntent: { decision: "ship depth policy" },
      transcript,
      events: [{ role: "user", text: "dump" }],
    });
    expect(projected.depth).toBe("relevant");
    expect(projected.sealTranscript).toBe(false);
    expect(projected.sealedTranscript).toBeNull();
    expect(JSON.stringify(projected.indexable)).not.toContain("user: hi 0");
  });

  it("full projection seals transcript under full_transcript retention", () => {
    const projected = projectCaptureDepth(
      {
        summary: "Debug session",
        transcript: "user: a\nassistant: b",
        events: [{ role: "user", text: "a" }],
      },
      "full"
    );
    expect(projected.sealTranscript).toBe(true);
    expect(projected.vaultLabel.retention).toBe("full_transcript");
    expect(projected.sealedTranscript).toContain("user: a");
  });

  it("detects transcript dumps", () => {
    const dump = Array.from({ length: 10 }, (_, i) => `user: q${i}\nassistant: a${i}`).join("\n");
    expect(looksLikeTranscriptDump(dump)).toBe(true);
    expect(looksLikeTranscriptDump("Ship the wiki surface")).toBe(false);
  });
});

describe("captureCodingAgentSession depth enforcement", () => {
  let db: Database.Database;
  let vaultRoot: string;

  beforeEach(() => {
    vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "memroos-observe-depth-"));
    vi.stubEnv("MEMROOS_VAULT_ROOT", vaultRoot);
    db = new Database(":memory:");
    initSchema(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(vaultRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("relevant capture does not index transcript into candidates or vault original", () => {
    const transcript = Array.from({ length: 12 }, (_, i) => `user: turn ${i}\nassistant: reply ${i}`).join("\n");
    const capture = captureCodingAgentSession(db, {
      sourceAgentId: "pi",
      runtime: "pi",
      sessionId: "sess-depth-1",
      summary: "Implemented observe capture depth.",
      decisionIntent: { decision: "default relevant" },
      transcript,
      events: [{ role: "user", content: "turn 0" }],
      captureDepth: "relevant",
    });
    expect(capture.captureDepth).toBe("relevant");
    const candidates = db
      .prepare("SELECT content FROM agent_memory_candidates WHERE capture_id = ?")
      .all(capture.id) as Array<{ content: string }>;
    expect(candidates.every((c) => !c.content.includes("user: turn 0"))).toBe(true);

    const replay = readVaultArtifact(db, capture.rawArtifactId!);
    expect(replay.body).not.toContain("user: turn 0");
    expect(JSON.parse(replay.body).captureDepth).toBe("relevant");
  });

  it("full capture seals transcript in vault while candidates stay structured", () => {
    const transcript = "user: please debug\nassistant: here is the fix";
    const capture = captureCodingAgentSession(db, {
      sourceAgentId: "codex",
      runtime: "codex",
      sessionId: "sess-depth-full",
      summary: "Debugged capture depth.",
      transcript,
      captureDepth: "full",
    });
    expect(capture.captureDepth).toBe("full");
    const replay = readVaultArtifact(db, capture.rawArtifactId!);
    const parsed = JSON.parse(replay.body) as {
      sealed?: { transcript?: string; retention?: string };
    };
    expect(parsed.sealed?.transcript).toContain("user: please debug");
    expect(parsed.sealed?.retention).toBe("full_transcript");
  });
});
