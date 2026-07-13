export function microToUsdtLabel(amountMicro: string): string {
  const micro = Number(amountMicro);
  if (!Number.isFinite(micro) || micro < 0) return "0 USDT";
  const amount = micro / 1_000_000;
  const formatted =
    amount >= 0.01
      ? amount.toFixed(2).replace(/\.?0+$/, "")
      : amount.toFixed(6).replace(/\.?0+$/, "");
  return `${formatted} USDT`;
}
