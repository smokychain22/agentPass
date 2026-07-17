/**
 * Mark legacy always-on-worker queued jobs as superseded.
 *   REPODIET_API_BASE_URL=... WORKER_API_KEY=... npx tsx scripts/actions-worker/supersede-legacy-jobs.ts
 */
const DEFAULT_JOBS = ["deep_scan_3oZqxEfDfwGB", "deep_scan_g3VekwLryXBW"];

async function main(): Promise<void> {
  const apiBase = (process.env.REPODIET_API_BASE_URL || "https://skillswap-virid-kappa.vercel.app").replace(
    /\/$/,
    ""
  );
  const apiKey = process.env.WORKER_API_KEY?.trim() || process.env.REPODIET_WORKER_API_KEY?.trim();
  if (!apiKey) {
    console.error("WORKER_API_KEY required (do not print the value)");
    process.exit(1);
  }
  const jobs = (process.env.LEGACY_JOB_IDS?.split(",") ?? DEFAULT_JOBS)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const jobId of jobs) {
    const res = await fetch(`${apiBase}/api/internal/actions/deep-scans/${jobId}/supersede`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ reason: "SUPERSEDED_LEGACY_WORKER" }),
    });
    const text = await res.text().catch(() => "");
    console.log(JSON.stringify({ jobId, httpStatus: res.status, body: text.slice(0, 400) }));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
