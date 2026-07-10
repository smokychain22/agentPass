"use client";

import { useEffect, useState } from "react";

function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0s";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

export function useRateLimitCooldown(resetAt?: string, retryAfterSeconds?: number) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const resetMs = resetAt
    ? Date.parse(resetAt)
    : now + Math.max(0, retryAfterSeconds ?? 0) * 1000;
  const remainingSeconds = Number.isNaN(resetMs)
    ? 0
    : Math.max(0, Math.ceil((resetMs - now) / 1000));
  const canRetry = remainingSeconds <= 0;

  return {
    remainingSeconds,
    canRetry,
    formatted: formatCountdown(remainingSeconds),
  };
}
