/** Reject a promise if it does not settle within `ms`. */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const WALLET_REQUEST_TIMEOUT_MS = 45_000;
export const GITHUB_STATUS_TIMEOUT_MS = 30_000;
export const WORKFLOW_REQUEST_TIMEOUT_MS = 60_000;
