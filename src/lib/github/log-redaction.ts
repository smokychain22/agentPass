const SECRET_PATTERNS: RegExp[] = [
  /(?:api[_-]?key|secret|token|password|private[_-]?key|authorization)\s*[:=]\s*['"]?[^\s'"]{8,}/gi,
  /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
  /ghp_[A-Za-z0-9]{20,}/g,
  /ghs_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /VERCEL_[A-Z_]+=\S+/g,
  /NEXT_PUBLIC_[A-Z0-9_]+=\S+/g,
];

const PATH_OUTSIDE_REPO = /(?:\/var\/task|\/tmp\/cursor|\/home\/[^/\s]+|C:\\Users\\)/gi;

export function redactSensitiveLogExcerpt(text: string, maxLength = 1200): string {
  let redacted = text.slice(0, maxLength * 2);
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  redacted = redacted.replace(PATH_OUTSIDE_REPO, "[runtime-path]/");
  if (redacted.length > maxLength) {
    redacted = `${redacted.slice(0, maxLength)}…`;
  }
  return redacted.trim();
}

export function firstActionableLogLine(text: string): string | undefined {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const actionable = lines.find((line) =>
    /error|failed|cannot|missing|not found|Type error|ENOENT|exit code/i.test(line)
  );
  return actionable ? redactSensitiveLogExcerpt(actionable, 280) : undefined;
}
