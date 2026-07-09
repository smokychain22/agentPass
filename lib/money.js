/** Amount helpers: store everything as integer micro-units (6 decimals, USDT/USDG style). */

export function toMicro(amount) {
  if (typeof amount === "bigint") return amount;
  if (typeof amount === "number") return BigInt(Math.round(amount * 1e6));
  const s = String(amount).trim();
  if (!s) return 0n;
  if (s.includes(".")) {
    const [w, f = ""] = s.split(".");
    const frac = (f + "000000").slice(0, 6);
    return BigInt(w || "0") * 1_000_000n + BigInt(frac);
  }
  return BigInt(s);
}

export function fromMicro(micro) {
  const n = BigInt(micro);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  const body = frac ? `${whole}.${frac}` : `${whole}`;
  return neg ? `-${body}` : body;
}

export function formatUsd(micro) {
  return `$${fromMicro(micro)}`;
}

export function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function startOfUtcWeek(d = new Date()) {
  const day = startOfUtcDay(d);
  const dow = day.getUTCDay(); // 0 Sun
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  day.setUTCDate(day.getUTCDate() + mondayOffset);
  return day;
}

export function startOfUtcMonth(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
