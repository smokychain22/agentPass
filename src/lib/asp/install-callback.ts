export function parseAspJobIdFromReturnPath(returnPath?: string): string | undefined {
  if (!returnPath) return undefined;
  try {
    const url = returnPath.startsWith("http")
      ? new URL(returnPath)
      : new URL(returnPath, "https://repodiet.local");
    const jobId = url.searchParams.get("jobId")?.trim();
    return jobId && jobId.startsWith("job_") ? jobId : undefined;
  } catch {
    const match = /[?&]jobId=(job_[^&]+)/.exec(returnPath);
    return match?.[1];
  }
}
