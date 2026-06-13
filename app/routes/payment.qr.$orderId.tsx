import { useState, useEffect, useRef } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  return { orderId: params.orderId ?? "" };
};

const MOCK_PAYMENT = {
  bankName: "Vietcombank",
  accountNumber: "1234567890",
  accountName: "NGUYEN VAN A",
  amount: 500000,
  reconcileCode: "TGABC1234",
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

export default function PaymentQrPage() {
  const { orderId } = useLoaderData<typeof loader>();
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS);
  const [expired, setExpired] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
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
  }, []);

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

        {/* QR placeholder */}
        <div style={s.qrWrap}>
          <div style={s.qrPlaceholder}>
            <QrIcon />
            <span style={s.qrHint}>Ảnh QR sẽ hiển thị ở đây</span>
          </div>
        </div>

        {/* Payment info */}
        <div style={s.infoCard}>
          <InfoRow label="Ngân hàng" value={MOCK_PAYMENT.bankName} />
          <InfoRow
            label="Số tài khoản"
            value={MOCK_PAYMENT.accountNumber}
            bold
          />
          <InfoRow label="Chủ tài khoản" value={MOCK_PAYMENT.accountName} />
          <InfoRow
            label="Số tiền"
            value={formatVnd(MOCK_PAYMENT.amount)}
            bold
            valueColor="#dc2626"
          />
          <div style={s.reconcileRow}>
            <span style={s.label}>Nội dung chuyển khoản</span>
            <span style={s.reconcileCode}>{MOCK_PAYMENT.reconcileCode}</span>
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

function QrIcon() {
  return (
    <svg
      width="120"
      height="120"
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ opacity: 0.25 }}
    >
      {/* Top-left finder pattern */}
      <rect x="8" y="8" width="36" height="36" rx="4" fill="#111827" />
      <rect x="16" y="16" width="20" height="20" rx="2" fill="white" />
      <rect x="22" y="22" width="8" height="8" rx="1" fill="#111827" />
      {/* Top-right finder pattern */}
      <rect x="76" y="8" width="36" height="36" rx="4" fill="#111827" />
      <rect x="84" y="16" width="20" height="20" rx="2" fill="white" />
      <rect x="90" y="22" width="8" height="8" rx="1" fill="#111827" />
      {/* Bottom-left finder pattern */}
      <rect x="8" y="76" width="36" height="36" rx="4" fill="#111827" />
      <rect x="16" y="84" width="20" height="20" rx="2" fill="white" />
      <rect x="22" y="90" width="8" height="8" rx="1" fill="#111827" />
      {/* Data modules (simplified pattern) */}
      <rect x="52" y="8" width="8" height="8" fill="#111827" />
      <rect x="64" y="8" width="8" height="8" fill="#111827" />
      <rect x="52" y="20" width="8" height="8" fill="#111827" />
      <rect x="52" y="52" width="8" height="8" fill="#111827" />
      <rect x="64" y="52" width="8" height="8" fill="#111827" />
      <rect x="52" y="64" width="8" height="8" fill="#111827" />
      <rect x="64" y="64" width="8" height="8" fill="#111827" />
      <rect x="76" y="52" width="8" height="8" fill="#111827" />
      <rect x="88" y="64" width="8" height="8" fill="#111827" />
      <rect x="100" y="52" width="8" height="8" fill="#111827" />
      <rect x="76" y="76" width="8" height="8" fill="#111827" />
      <rect x="92" y="76" width="8" height="8" fill="#111827" />
      <rect x="108" y="76" width="8" height="8" fill="#111827" />
      <rect x="76" y="92" width="8" height="8" fill="#111827" />
      <rect x="100" y="92" width="8" height="8" fill="#111827" />
      <rect x="76" y="108" width="8" height="8" fill="#111827" />
      <rect x="92" y="108" width="8" height="8" fill="#111827" />
      <rect x="108" y="108" width="8" height="8" fill="#111827" />
    </svg>
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
  qrPlaceholder: {
    width: "200px",
    height: "200px",
    border: "2px dashed #d1d5db",
    borderRadius: "12px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    backgroundColor: "#f9fafb",
  },
  qrHint: {
    fontSize: "12px",
    color: "#9ca3af",
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
