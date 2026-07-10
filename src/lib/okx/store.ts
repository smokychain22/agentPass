import { nanoid } from "nanoid";
import { durableNow, getDurableRecord, setDurableRecord } from "@/lib/store/durable-store";
import type { MarketplaceDeliveryRecord, OkxOrderRecord } from "./types";
import type { PaymentReceipt } from "./types";

export async function saveOkxOrder(order: OkxOrderRecord): Promise<void> {
  await setDurableRecord("okx_orders", order.orderId, order);
  if (order.a2aTaskId) {
    await setDurableRecord("okx_orders", `a2a_${order.a2aTaskId}`, order);
  }
}

export async function getOkxOrder(orderId: string): Promise<OkxOrderRecord | undefined> {
  return getDurableRecord<OkxOrderRecord>("okx_orders", orderId);
}

export async function getOkxOrderByA2aTask(
  a2aTaskId: string
): Promise<OkxOrderRecord | undefined> {
  return getDurableRecord<OkxOrderRecord>("okx_orders", `a2a_${a2aTaskId}`);
}

export async function updateOkxOrder(
  orderId: string,
  patch: Partial<OkxOrderRecord>
): Promise<OkxOrderRecord | undefined> {
  const existing = await getOkxOrder(orderId);
  if (!existing) return undefined;
  const updated = { ...existing, ...patch, updatedAt: durableNow() };
  await saveOkxOrder(updated);
  return updated;
}

export async function saveMarketplaceDelivery(
  delivery: MarketplaceDeliveryRecord
): Promise<void> {
  await setDurableRecord(
    "marketplace_deliveries",
    `${delivery.taskId}_v${delivery.deliveryVersion}`,
    delivery
  );
  await setDurableRecord("marketplace_deliveries", delivery.deliveryId, delivery);
}

export async function getMarketplaceDelivery(
  deliveryId: string
): Promise<MarketplaceDeliveryRecord | undefined> {
  return getDurableRecord<MarketplaceDeliveryRecord>("marketplace_deliveries", deliveryId);
}

export async function saveOkxReceipt(receipt: PaymentReceipt): Promise<void> {
  await setDurableRecord("execution_receipts", receipt.receiptId, receipt);
}

export async function getOkxReceipt(receiptId: string): Promise<PaymentReceipt | undefined> {
  return getDurableRecord<PaymentReceipt>("execution_receipts", receiptId);
}

export async function claimIdempotencyLock(
  serviceId: string,
  requestHash: string,
  idempotencyKey: string,
  taskId: string
): Promise<{ claimed: boolean; existingTaskId?: string }> {
  const lockKey = `lock_${serviceId}_${requestHash}_${idempotencyKey}`;
  const existing = await getDurableRecord<{ taskId: string }>("payment_entitlements", lockKey);
  if (existing) {
    return { claimed: false, existingTaskId: existing.taskId };
  }
  await setDurableRecord("payment_entitlements", lockKey, { taskId, claimedAt: durableNow() });
  return { claimed: true };
}

export function newOkxOrderId(): string {
  return `okx_order_${nanoid(12)}`;
}

export function newDeliveryId(): string {
  return `delivery_${nanoid(12)}`;
}

export function newReceiptId(): string {
  return `receipt_${nanoid(12)}`;
}
