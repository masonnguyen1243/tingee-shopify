import { randomBytes } from "crypto";
import prisma from "../db.server";

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const SUFFIX_LENGTH = 7;
const MAX_RETRIES = 5;

export function generateReconcileCode(): string {
  const bytes = randomBytes(SUFFIX_LENGTH);
  const suffix = Array.from(bytes)
    .map((b) => CHARSET[b % CHARSET.length])
    .join("");
  return `TG${suffix}`;
}

export async function ensureUnique(): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const code = generateReconcileCode();
    const existing = await prisma.payment.findUnique({
      where: { reconcileCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  throw new Error("Failed to generate a unique reconcile code after max retries");
}
