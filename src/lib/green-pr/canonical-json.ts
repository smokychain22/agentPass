import { createHash } from "node:crypto";

function canonicalizeValue(value: unknown): string {
  if (value === null) return "null";

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonical_json_non_finite_number");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeValue).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => {
        const entry = record[key];
        if (entry === undefined) {
          throw new Error(`canonical_json_undefined:${key}`);
        }
        return `${JSON.stringify(key)}:${canonicalizeValue(entry)}`;
      });
    return `{${entries.join(",")}}`;
  }

  throw new Error(`canonical_json_unsupported_type:${typeof value}`);
}

/** RepoDiet canonical JSON v1: sorted object keys, preserved array order, no undefined values. */
export function canonicalJson(value: unknown): string {
  return canonicalizeValue(value);
}

export function sha256Digest(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function canonicalDigest(value: unknown): string {
  return sha256Digest(canonicalJson(value));
}
