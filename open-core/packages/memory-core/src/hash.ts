import crypto from "node:crypto";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Canonical (key-sorted) SHA-256 of any JSON-serialisable value. Shared by policy, workflow and learning code. */
export function hashEngineRequest(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(stable(value)).digest("hex")}`;
}
