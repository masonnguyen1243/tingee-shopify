import {
  TingeeClient,
  isSuccessResponse,
  getBankCode,
} from "@tingee/sdk-node";
import type {
  TingeeApiResponse,
  OpenApiGetVAPagedOuputDto,
  OpenApiTransactionPagedOuputDto,
  PagedResultDto,
} from "@tingee/sdk-node";

function makeClient(clientId: string, secretToken: string): TingeeClient {
  return new TingeeClient({
    clientId,
    secretKey: secretToken,
    ...(process.env.TINGEE_BASE_URL ? { baseUrl: process.env.TINGEE_BASE_URL } : {}),
  });
}

function assertOk<T>(result: TingeeApiResponse<T>, context: string): T {
  if (!isSuccessResponse(result)) {
    throw new Error(`Tingee ${context}: [${result.code}] ${result.message}`);
  }
  return result.data as T;
}

export async function listVirtualAccounts(
  clientId: string,
  secretToken: string,
): Promise<OpenApiGetVAPagedOuputDto[]> {
  const client = makeClient(clientId, secretToken);
  // SDK type requires merchantId/dataAccess but the raw API only needs skipCount+maxResultCount
  const result = await client.bank.getVaPaging(
    { skipCount: 0, maxResultCount: 50 } as Parameters<typeof client.bank.getVaPaging>[0],
  );
  return assertOk<PagedResultDto<OpenApiGetVAPagedOuputDto>>(result, "get-va-paging").items;
}

export async function registerNotify(
  vaAccountNumber: string,
  bankBin: string,
  clientId: string,
  secretToken: string,
): Promise<void> {
  const bankName = getBankCode(bankBin);
  if (!bankName) throw new Error(`Unknown bankBin for registerNotify: ${bankBin}`);

  const client = makeClient(clientId, secretToken);

  const regResult = await client.bank.registerNotify({ vaAccountNumber, bankBin });
  const { confirmId } = assertOk<{ confirmId: string }>(regResult, "register-notify");

  const confirmResult = await client.bank.confirmRegisterNotify({
    confirmId,
    otpNumber: "",
    bankName,
    bankBin,
  });
  assertOk(confirmResult, "confirm-register-notify");
}

export async function generateVietQR(
  bankBin: string,
  accountNumber: string,
  amount: number,
  content: string,
  clientId: string,
  secretToken: string,
): Promise<{ qrCode: string; qrCodeImage: string }> {
  const client = makeClient(clientId, secretToken);
  const result = await client.bank.generateVietQr({ bankBin, accountNumber, amount, content });
  const data = assertOk<{ qrCode: string; qrCodeImage: string }>(result, "generate-viet-qr");
  return { qrCode: data.qrCode, qrCodeImage: data.qrCodeImage };
}

export async function getTransactions(
  clientId: string,
  secretToken: string,
  vaAccountNumbers?: string[],
  startTime?: string,
  endTime?: string,
): Promise<OpenApiTransactionPagedOuputDto[]> {
  const client = makeClient(clientId, secretToken);
  const result = await client.transaction.getPaging({
    skipCount: 0,
    maxResultCount: 50,
    vaAccountNumbers,
    startTime,
    endTime,
  });
  return assertOk<PagedResultDto<OpenApiTransactionPagedOuputDto>>(result, "transaction-get-paging").items;
}
