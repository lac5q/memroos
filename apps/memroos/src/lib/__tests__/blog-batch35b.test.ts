// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

let prevCwd: string;

beforeEach(() => {
  prevCwd = process.cwd();
});

afterEach(() => {
  process.chdir(prevCwd);
  vi.resetModules();
});

describe("blog batch35b", () => {
  it("getAllPostSlugs returns [] when content dir missing (32)", async () => {
    const emptyRoot = path.join(os.tmpdir(), `blog-b35b-${randomUUID()}`);
    fs.mkdirSync(emptyRoot, { recursive: true });
    process.chdir(emptyRoot);
    const { getAllPostSlugs, getPostBySlug } = await import("../blog");
    expect(getAllPostSlugs()).toEqual([]);
    expect(getPostBySlug("any-slug-b35b")).toBeNull();
  });

  it("getPostBySlug returns null for missing slug file when blog dir exists (41–43)", async () => {
    const root = path.join(os.tmpdir(), `blog-b35b-${randomUUID()}`);
    const blogDir = path.join(root, "content", "blog");
    fs.mkdirSync(blogDir, { recursive: true });
    process.chdir(root);
    const { getPostBySlug } = await import("../blog");
    expect(getPostBySlug(`missing-${randomUUID().slice(0, 8)}`)).toBeNull();
  });
});
