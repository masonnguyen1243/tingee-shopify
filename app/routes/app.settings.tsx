import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const MOCK_VA_LIST = [
  {
    id: "va-1",
    bankName: "Vietcombank",
    accountNumber: "1234567890",
    accountName: "NGUYEN VAN A",
    status: "active" as const,
  },
  {
    id: "va-2",
    bankName: "Techcombank",
    accountNumber: "0987654321",
    accountName: "NGUYEN VAN A",
    status: "active" as const,
  },
  {
    id: "va-3",
    bankName: "MB Bank",
    accountNumber: "1111222233",
    accountName: "NGUYEN VAN A",
    status: "inactive" as const,
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function SettingsPage() {
  const shopify = useAppBridge();
  const [clientId, setClientId] = useState("");
  const [secretToken, setSecretToken] = useState("");
  const [step, setStep] = useState<"form" | "va-list">("form");
  const [selectedVa, setSelectedVa] = useState("va-1");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleConnect = () => {
    setIsConnecting(true);
    setSaved(false);
    setTimeout(() => {
      setIsConnecting(false);
      setStep("va-list");
    }, 800);
  };

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => {
      setIsSaving(false);
      setSaved(true);
      shopify.toast.show("Cấu hình đã được lưu thành công!");
    }, 600);
  };

  return (
    <s-page heading="Cấu hình Tingee">
      {saved && (
        <s-banner tone="success" dismissible onDismiss={() => setSaved(false)}>
          Cấu hình đã được lưu thành công.
        </s-banner>
      )}

      <s-section heading="Thông tin kết nối Tingee">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="Client ID"
            value={clientId}
            onInput={(e: any) => setClientId(e.target.value)}
            placeholder="Nhập Client ID từ app.tingee.vn"
          />
          <s-password-field
            label="Secret Token"
            value={secretToken}
            onInput={(e: any) => setSecretToken(e.target.value)}
            placeholder="Nhập Secret Token từ app.tingee.vn"
          />
          <div>
            <s-button
              onClick={handleConnect}
              {...(isConnecting ? { loading: true } : {})}
            >
              Kết nối
            </s-button>
          </div>
        </s-stack>
      </s-section>

      {step === "va-list" && (
        <s-section heading="Chọn tài khoản nhận thanh toán">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Chọn tài khoản VA mặc định để nhận thanh toán từ khách hàng.
            </s-paragraph>

            {MOCK_VA_LIST.map((va) => (
              <label
                key={va.id}
                style={{ display: "block", cursor: "pointer" }}
              >
                <s-box
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background={selectedVa === va.id ? "subdued" : "base"}
                >
                  <s-stack direction="inline" gap="base">
                    <input
                      type="radio"
                      name="va-account"
                      value={va.id}
                      checked={selectedVa === va.id}
                      onChange={() => setSelectedVa(va.id)}
                      style={{
                        marginTop: "4px",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    />
                    <s-stack direction="block" gap="small">
                      <s-stack direction="inline" gap="small">
                        <s-text type="strong">{va.bankName}</s-text>
                        <s-badge
                          tone={
                            va.status === "active" ? "success" : "critical"
                          }
                        >
                          {va.status === "active"
                            ? "Hoạt động"
                            : "Không hoạt động"}
                        </s-badge>
                      </s-stack>
                      <s-text>Số TK: {va.accountNumber}</s-text>
                      <s-text>Chủ TK: {va.accountName}</s-text>
                    </s-stack>
                  </s-stack>
                </s-box>
              </label>
            ))}

            <div>
              <s-button
                variant="primary"
                onClick={handleSave}
                {...(isSaving ? { loading: true } : {})}
              >
                Lưu cấu hình
              </s-button>
            </div>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
