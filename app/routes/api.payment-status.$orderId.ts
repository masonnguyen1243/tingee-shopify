import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const orderId = params.orderId ?? "";
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "";

  if (!orderId || !shop) {
    return Response.json({ status: "unknown" }, { status: 400 });
  }

  const merchant = await prisma.merchant.findUnique({
    where: { shopifyShopDomain: shop },
    select: { id: true },
  });

  if (!merchant) {
    return Response.json({ status: "unknown" }, { status: 404 });
  }

  const payment = await prisma.payment.findFirst({
    where: { shopifyOrderId: orderId, merchantId: merchant.id },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });

  return Response.json({ status: payment?.status ?? "unknown" });
};
