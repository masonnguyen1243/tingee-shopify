import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { listVirtualAccounts, registerNotify } from "../services/tingee.server";
import { encrypt } from "../utils/crypto.server";
import { getBankShortName } from "@tingee/sdk-node";

type VaItem = {
  vaAccountNumber: string;
  accountNumber: string;
  bankBin: string;
  bankName: string;
  accountName: string;
  status: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const merchant = await prisma.merchant.findUnique({
    where: { shopifyShopDomain: session.shop },
    include: {
      tingeeConfigs: {
        where: { status: "active" },
        include: { accounts: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!merchant || merchant.tingeeConfigs.length === 0) {
    return { savedConfig: null };
  }

  const config = merchant.tingeeConfigs[0];
  const defaultAccount =
    config.accounts.find((a) => a.isDefault) ?? config.accounts[0];

  return {
    savedConfig: {
      clientId: config.clientId,
      defaultVaAccountNumber: defaultAccount?.vaAccountNumber ?? null,
      accounts: config.accounts.map((a) => ({
        vaAccountNumber: a.vaAccountNumber,
        accountNumber: a.accountNumber,
        bankBin: a.bankBin,
        bankName: getBankShortName(a.bankBin) ?? a.bankBin,
        accountName: a.accountName,
        isDefault: a.isDefault,
        status: "active",
      })),
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const formData = await request.formData();
  const intent = formData.get("_action") as string;
  const clientId = ((formData.get("clientId") as string) ?? "").trim();
  const secretToken = ((formData.get("secretToken") as string) ?? "").trim();

  if (intent === "connect") {
    try {
      const items = await listVirtualAccounts(clientId, secretToken);
      const vaList: VaItem[] = items.map((v) => ({
        vaAccountNumber: v.vaAccountNumber ?? "",
        accountNumber: v.accountNumber,
        bankBin: v.bankBin ?? "",
        bankName: getBankShortName(v.bankBin ?? "") ?? v.bankName,
        accountName: v.accountName ?? "",
        status: v.status,
      }));
      return { intent: "connect", vaList, error: null };
    } catch (err: any) {
      return { intent: "connect", vaList: [] as VaItem[], error: err.message as string };
    }
  }

  if (intent === "save") {
    const vaAccountNumber = (formData.get("vaAccountNumber") as string) ?? "";
    const bankBin = (formData.get("bankBin") as string) ?? "";
    const accountNumber = (formData.get("accountNumber") as string) ?? "";
    const accountName = (formData.get("accountName") as string) ?? "";

    try {
      const accessToken = session.accessToken ?? "";
      const merchant = await prisma.merchant.upsert({
        where: { shopifyShopDomain: session.shop },
        create: {
          shopifyShopDomain: session.shop,
          shopifyAccessToken: accessToken,
        },
        update: { shopifyAccessToken: accessToken },
      });

      await prisma.tingeeConfig.updateMany({
        where: { merchantId: merchant.id },
        data: { status: "inactive" },
      });

      const encryptionKey = process.env.ENCRYPTION_KEY;
      if (!encryptionKey) throw new Error("ENCRYPTION_KEY not set");
      const encryptedToken = encrypt(secretToken, encryptionKey);

      const config = await prisma.tingeeConfig.create({
        data: {
          merchantId: merchant.id,
          clientId,
          secretToken: encryptedToken,
          status: "active",
        },
      });

      let notifyRegistered = false;
      try {
        await registerNotify(vaAccountNumber, bankBin, clientId, secretToken);
        notifyRegistered = true;
      } catch {
        // registerNotify may fail if already registered — still save the account
      }

      await prisma.tingeeAccount.create({
        data: {
          tingeeConfigId: config.id,
          vaAccountNumber,
          accountNumber,
          bankBin,
          accountName,
          isDefault: true,
          notifyRegistered,
        },
      });

      return { intent: "save", success: true, error: null as string | null };
    } catch (err: any) {
      return { intent: "save", success: false, error: err.message as string };
    }
  }

  return { intent: null, error: "Unknown action" };
};

export default function SettingsPage() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();

  const saved = loaderData.savedConfig;

  const [clientId, setClientId] = useState(saved?.clientId ?? "");
  const [secretToken, setSecretToken] = useState("");
  const [step, setStep] = useState<"form" | "va-list">(
    saved ? "va-list" : "form",
  );
  const [vaList, setVaList] = useState<VaItem[]>(saved?.accounts ?? []);
  const [selectedVa, setSelectedVa] = useState(
    saved?.defaultVaAccountNumber ?? "",
  );
  const [connectError, setConnectError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isConnecting =
    navigation.state === "submitting" &&
    navigation.formData?.get("_action") === "connect";
  const isSaving =
    navigation.state === "submitting" &&
    navigation.formData?.get("_action") === "save";

  useEffect(() => {
    if (!actionData) return;
    if (actionData.intent === "connect") {
      if (actionData.error) {
        setConnectError(actionData.error);
      } else {
        setConnectError(null);
        setVaList(actionData.vaList ?? []);
        setStep("va-list");
        const first = actionData.vaList?.[0];
        if (first) setSelectedVa(first.vaAccountNumber);
      }
    }
    if (actionData.intent === "save") {
      if (actionData.error) {
        setSaveError(actionData.error);
      } else {
        setSaveError(null);
        shopify.toast.show("Cấu hình đã được lưu thành công!");
      }
    }
  }, [actionData]);

  const handleConnect = () => {
    if (!clientId || !secretToken) return;
    setConnectError(null);
    const fd = new FormData();
    fd.append("_action", "connect");
    fd.append("clientId", clientId);
    fd.append("secretToken", secretToken);
    submit(fd, { method: "post" });
  };

  const handleSave = () => {
    const va = vaList.find((v) => v.vaAccountNumber === selectedVa);
    if (!va || !secretToken) return;
    setSaveError(null);
    const fd = new FormData();
    fd.append("_action", "save");
    fd.append("clientId", clientId);
    fd.append("secretToken", secretToken);
    fd.append("vaAccountNumber", va.vaAccountNumber);
    fd.append("bankBin", va.bankBin);
    fd.append("accountNumber", va.accountNumber);
    fd.append("accountName", va.accountName);
    submit(fd, { method: "post" });
  };

  return (
    <s-page heading="Cấu hình Tingee">
      <s-section heading="Thông tin kết nối Tingee">
        <s-stack direction="block" gap="base">
          {connectError && (
            <s-banner tone="critical">
              {connectError}
            </s-banner>
          )}
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
              {step === "va-list" ? "Kết nối lại" : "Kết nối"}
            </s-button>
          </div>
        </s-stack>
      </s-section>

      {step === "va-list" && (
        <s-section heading="Chọn tài khoản nhận thanh toán">
          <s-stack direction="block" gap="base">
            {saveError && (
              <s-banner tone="critical">
                {saveError}
              </s-banner>
            )}
            {vaList.length === 0 ? (
              <s-banner tone="warning">
                Tài khoản này chưa có VA nào. Vui lòng kiểm tra trên app.tingee.vn
              </s-banner>
            ) : (
              <>
                <s-paragraph>
                  Chọn tài khoản VA mặc định để nhận thanh toán từ khách hàng.
                </s-paragraph>

                {vaList.map((va) => (
                  <label
                    key={va.vaAccountNumber}
                    style={{ display: "block", cursor: "pointer" }}
                  >
                    <s-box
                      padding="base"
                      borderWidth="base"
                      borderRadius="base"
                      background={
                        selectedVa === va.vaAccountNumber ? "subdued" : "base"
                      }
                    >
                      <s-stack direction="inline" gap="base">
                        <input
                          type="radio"
                          name="va-account"
                          value={va.vaAccountNumber}
                          checked={selectedVa === va.vaAccountNumber}
                          onChange={() => setSelectedVa(va.vaAccountNumber)}
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
              </>
            )}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
