import { useState, useEffect, useRef } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import prisma from "../db.server";
import { generateVietQR } from "../services/tingee.server";
import { decrypt } from "../utils/crypto.server";
import { ensureUnique } from "../utils/reconcile.server";
import { getBankShortName } from "@tingee/sdk-node";

type PaymentData = {
  reconcileCode: string;
  qrCodeImage: string;
  amount: number;
  accountNumber: string;
  accountName: string;
  bankName: string;
  status: string;
};

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const orderId = params.orderId ?? "";
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "";

  if (!shop) {
    return { orderId, shop: "", payment: null as PaymentData | null, error: "Thiếu thông tin cửa hàng" };
  }

  try {
    const merchant = await prisma.merchant.findUnique({
      where: { shopifyShopDomain: shop },
      include: {
        tingeeConfigs: {
          where: { status: "active" },
          include: {
            accounts: { where: { isDefault: true }, take: 1 },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!merchant || merchant.tingeeConfigs.length === 0) {
      return { orderId, shop, payment: null as PaymentData | null, error: "Cửa hàng chưa cấu hình Tingee" };
    }

    const config = merchant.tingeeConfigs[0];
    const account = config.accounts[0];

    if (!account) {
      return { orderId, shop, payment: null as PaymentData | null, error: "Cửa hàng chưa có tài khoản VA" };
    }

    const bankName = getBankShortName(account.bankBin) ?? account.bankBin;

    // Reuse existing pending payment for this order (idempotency on page refresh)
    const existing = await prisma.payment.findFirst({
      where: { shopifyOrderId: orderId, merchantId: merchant.id, status: "pending" },
      orderBy: { createdAt: "desc" },
    });

    if (existing?.qrCodeImage) {
      return {
        orderId,
        shop,
        error: null,
        payment: {
          reconcileCode: existing.reconcileCode,
          qrCodeImage: existing.qrCodeImage,
          amount: existing.amount,
          accountNumber: account.accountNumber,
          accountName: account.accountName,
          bankName,
          status: existing.status,
        } satisfies PaymentData,
      };
    }

    // Fetch order amount from Shopify Admin API
    const orderRes = await fetch(
      `https://${shop}/admin/api/2024-10/orders/${orderId}.json`,
      { headers: { "X-Shopify-Access-Token": merchant.shopifyAccessToken } },
    );

    if (!orderRes.ok) {
      return { orderId, shop, payment: null as PaymentData | null, error: "Không tìm thấy đơn hàng" };
    }

    const { order } = (await orderRes.json()) as { order: { total_price: string } };
    const amount = parseFloat(order.total_price);

    // Generate unique reconcile code + QR
    const reconcileCode = await ensureUnique();
    const encryptionKey = process.env.ENCRYPTION_KEY ?? "";
    const plainSecret = decrypt(config.secretToken, encryptionKey);

    const { qrCodeImage } = await generateVietQR(
      account.bankBin,
      account.accountNumber,
      amount,
      reconcileCode,
      config.clientId,
      plainSecret,
    );

    await prisma.payment.create({
      data: {
        merchantId: merchant.id,
        shopifyOrderId: orderId,
        reconcileCode,
        qrCodeImage,
        amount,
        status: "pending",
      },
    });

    return {
      orderId,
      shop,
      error: null,
      payment: {
        reconcileCode,
        qrCodeImage,
        amount,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        bankName,
        status: "pending",
      } satisfies PaymentData,
    };
  } catch (err: any) {
    return { orderId, shop, payment: null as PaymentData | null, error: err.message as string };
  }
};

const COUNTDOWN_SECONDS = 15 * 60;

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatVnd(amount: number) {
  return new Intl.NumberFormat("vi-VN").format(amount) + " ₫";
}

const POLL_INTERVAL_MS = 3000;

export default function PaymentQrPage() {
  const { orderId, shop, payment, error } = useLoaderData<typeof loader>();
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS);
  const [expired, setExpired] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Countdown timer
  useEffect(() => {
    if (!payment) return;
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          setExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [payment]);

  // Payment status polling
  useEffect(() => {
    if (!payment || !shop || expired) return;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/payment-status/${orderId}?shop=${encodeURIComponent(shop)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { status: string };
        if (data.status === "paid") {
          if (pollRef.current) clearInterval(pollRef.current);
          window.location.href = `/orders/${orderId}/confirmation`;
        }
      } catch {
        // network error — keep polling
      }
    };

    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [payment, shop, orderId, expired]);

  if (error || !payment) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <h1 style={s.heading}>Không thể hiển thị QR</h1>
          <div style={s.expiredBox}>{error ?? "Có lỗi xảy ra. Vui lòng liên hệ shop."}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.heading}>Thanh toán chuyển khoản</h1>
        <p style={s.sub}>Đơn hàng #{orderId}</p>

        {/* Warning banner */}
        <div style={s.warning}>
          <span style={s.warningIcon}>⚠️</span>
          <span>
            <strong>Không thay đổi nội dung chuyển khoản</strong> — một số ứng
            dụng ngân hàng cho phép sửa, nhưng thay đổi sẽ khiến đơn hàng
            không được xác nhận tự động
          </span>
        </div>

        {/* QR image */}
        <div style={s.qrWrap}>
          <img
            src={`data:image/png;base64,${payment.qrCodeImage}`}
            alt="QR thanh toán"
            width={200}
            height={200}
            style={{ borderRadius: "12px", display: "block" }}
          />
        </div>

        {/* Payment info */}
        <div style={s.infoCard}>
          <InfoRow label="Ngân hàng" value={payment.bankName} />
          <InfoRow label="Số tài khoản" value={payment.accountNumber} bold />
          <InfoRow label="Chủ tài khoản" value={payment.accountName} />
          <InfoRow
            label="Số tiền"
            value={formatVnd(payment.amount)}
            bold
            valueColor="#dc2626"
          />
          <div style={s.reconcileRow}>
            <span style={s.label}>Nội dung chuyển khoản</span>
            <span style={s.reconcileCode}>{payment.reconcileCode}</span>
          </div>
        </div>

        {/* Countdown / status */}
        {!expired ? (
          <>
            <div style={s.countdown}>
              <span>⏱</span>
              <span>
                Còn lại:{" "}
                <strong style={{ color: remaining < 120 ? "#dc2626" : "#111827" }}>
                  {formatTime(remaining)}
                </strong>
              </span>
            </div>
            <div style={s.status}>
              <PulsingDot />
              <span>Đang chờ xác nhận thanh toán...</span>
            </div>
          </>
        ) : (
          <div style={s.expiredBox}>
            Đã hết thời gian. Nếu bạn đã chuyển tiền, vui lòng liên hệ shop.
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  bold,
  valueColor,
}: {
  label: string;
  value: string;
  bold?: boolean;
  valueColor?: string;
}) {
  return (
    <div style={s.infoRow}>
      <span style={s.label}>{label}</span>
      <span
        style={{
          ...s.value,
          fontWeight: bold ? 600 : 400,
          color: valueColor ?? "#111827",
          letterSpacing: bold ? "0.3px" : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function PulsingDot() {
  return (
    <span
      style={{
        display: "inline-block",
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        backgroundColor: "#22c55e",
        animation: "pulse 1.5s ease-in-out infinite",
        flexShrink: 0,
      }}
    />
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    backgroundColor: "#f3f4f6",
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
    padding: "24px 16px 40px",
    fontFamily:
      "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  card: {
    width: "100%",
    maxWidth: "460px",
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    padding: "28px 24px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
  },
  heading: {
    margin: "0 0 4px",
    fontSize: "20px",
    fontWeight: 700,
    color: "#111827",
    textAlign: "center",
  },
  sub: {
    margin: "0 0 20px",
    fontSize: "13px",
    color: "#9ca3af",
    textAlign: "center",
  },
  warning: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
    backgroundColor: "#fff7ed",
    border: "1.5px solid #fb923c",
    borderRadius: "10px",
    padding: "12px 14px",
    marginBottom: "20px",
    fontSize: "13px",
    color: "#9a3412",
    lineHeight: "1.55",
  },
  warningIcon: {
    fontSize: "16px",
    flexShrink: 0,
    marginTop: "1px",
  },
  qrWrap: {
    display: "flex",
    justifyContent: "center",
    marginBottom: "20px",
  },
  infoCard: {
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    overflow: "hidden",
    marginBottom: "20px",
  },
  infoRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "11px 14px",
    borderBottom: "1px solid #f3f4f6",
    fontSize: "14px",
  },
  label: {
    color: "#6b7280",
    fontSize: "13px",
  },
  value: {
    fontSize: "14px",
  },
  reconcileRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "11px 14px",
    backgroundColor: "#f0fdf4",
    fontSize: "14px",
  },
  reconcileCode: {
    fontFamily: "'Courier New', Courier, monospace",
    fontWeight: 700,
    fontSize: "17px",
    color: "#15803d",
    letterSpacing: "2px",
  },
  countdown: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    fontSize: "15px",
    color: "#374151",
    marginBottom: "10px",
  },
  status: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    fontSize: "13px",
    color: "#6b7280",
    fontStyle: "italic",
  },
  expiredBox: {
    backgroundColor: "#fef2f2",
    border: "1px solid #fca5a5",
    borderRadius: "10px",
    padding: "14px",
    color: "#7f1d1d",
    fontSize: "13px",
    textAlign: "center",
    lineHeight: "1.5",
  },
};
