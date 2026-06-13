import { createHmac, timingSafeEqual } from "crypto";
import prisma from "../db.server";
import { decrypt } from "../utils/crypto.server";
import { markPaid } from "./order-reconcile.server";

export interface IpnPayload {
  clientId: string;
  transactionCode: string;
  amount: number;
  content: string;
  bank?: string;
  accountNumber?: string;
  vaAccountNumber?: string;
  transactionDate?: string;
  additionalData?: unknown[];
}

export interface IpnHeaders {
  "x-request-id"?: string;
  "x-request-timestamp": string;
  "x-signature": string;
}

export function verifySignature(
  timestamp: string,
  rawBody: string,
  secretToken: string,
  incomingSignature: string,
): boolean {
  const expected = createHmac("sha512", secretToken)
    .update(`${timestamp}:${rawBody}`)
    .digest("hex");
  try {
    return timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(incomingSignature, "hex"),
    );
  } catch {
    return false;
  }
}

export function extractReconcileCode(content: string): string | null {
  const match = content.match(/TG[A-Z0-9]{5,10}/);
  return match ? match[0] : null;
}

async function saveEvent(
  transactionCode: string,
  headers: IpnHeaders,
  rawBody: string,
  matchedPaymentId: string | null,
): Promise<void> {
  await prisma.webhookEvent.create({
    data: {
      transactionCode,
      rawHeaders: JSON.stringify(headers),
      rawBody,
      matchedPaymentId,
    },
  });
}

export async function processIPN(
  payload: IpnPayload,
  headers: IpnHeaders,
  rawBody: string,
): Promise<void> {
  const { clientId, transactionCode, amount, content } = payload;

  // idempotency: skip if already processed
  const existing = await prisma.webhookEvent.findUnique({
    where: { transactionCode },
  });
  if (existing) return;

  // find merchant config by clientId
  const config = await prisma.tingeeConfig.findFirst({
    where: { clientId, status: "active" },
    include: { merchant: true },
  });
  if (!config) {
    await saveEvent(transactionCode, headers, rawBody, null);
    return;
  }

  // verify signature — decrypt only here, never log secret
  const decryptedSecret = decrypt(
    config.secretToken,
    process.env.ENCRYPTION_KEY ?? "",
  );
  if (
    !verifySignature(
      headers["x-request-timestamp"],
      rawBody,
      decryptedSecret,
      headers["x-signature"],
    )
  ) {
    console.warn(`[IPN] Invalid signature transactionCode=${transactionCode}`);
    await saveEvent(transactionCode, headers, rawBody, null);
    return;
  }

  // extract reconcile code from transfer content
  const reconcileCode = extractReconcileCode(content);
  if (!reconcileCode) {
    await saveEvent(transactionCode, headers, rawBody, null);
    return;
  }

  // match payment by reconcile code
  const payment = await prisma.payment.findUnique({
    where: { reconcileCode },
  });
  if (!payment) {
    await saveEvent(transactionCode, headers, rawBody, null);
    return;
  }

  // compare amounts (VND whole numbers)
  if (Math.round(amount) !== Math.round(payment.amount)) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "mismatch" },
    });
    await saveEvent(transactionCode, headers, rawBody, payment.id);
    return;
  }

  // amounts match — mark order paid
  // skip if already paid to avoid duplicate Shopify transaction on retry
  if (payment.status !== "paid") {
    await markPaid(
      config.merchant.shopifyShopDomain,
      payment.shopifyOrderId,
      amount,
      config.merchant.shopifyAccessToken,
      payment.id,
      transactionCode,
    );
  }
  // save event last so Tingee can retry if markPaid failed
  await saveEvent(transactionCode, headers, rawBody, payment.id);
}
