import prisma from "../db.server";

export async function markPaid(
  shopDomain: string,
  orderId: string,
  amount: number,
  accessToken: string,
  paymentId: string,
  tingeeTransactionCode: string,
): Promise<void> {
  const apiUrl = `https://${shopDomain}/admin/api/2024-10/orders/${orderId}/transactions.json`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      transaction: {
        kind: "capture",
        status: "success",
        amount: amount.toFixed(0),
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify transactions API error ${response.status}: ${text}`);
  }

  await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: "paid",
      paidAt: new Date(),
      tingeeTransactionCode,
    },
  });
}
