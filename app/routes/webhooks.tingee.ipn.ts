import type { ActionFunctionArgs } from "react-router";
import { processIPN, type IpnHeaders, type IpnPayload } from "../services/ipn.server";

// Must be a function — Response body is a ReadableStream consumed once per instance
const ok = () => Response.json({ code: "00", message: "Success" }, { status: 200 });

export const action = async ({ request }: ActionFunctionArgs) => {
  // Read raw body as text — must happen before any JSON.parse
  // so the exact bytes are available for HMAC verification inside processIPN
  const rawBody = await request.text();

  const headers: IpnHeaders = {
    "x-request-id": request.headers.get("x-request-id") ?? undefined,
    "x-request-timestamp": request.headers.get("x-request-timestamp") ?? "",
    "x-signature": request.headers.get("x-signature") ?? "",
  };

  let payload: IpnPayload;
  try {
    payload = JSON.parse(rawBody) as IpnPayload;
  } catch {
    // malformed JSON — nothing to process, still return 200
    return ok();
  }

  try {
    await processIPN(payload, headers, rawBody);
  } catch (err) {
    // internal error — log but always return 200 so Tingee does not retry indefinitely
    console.error("[IPN] processIPN error:", (err as Error).message);
  }

  return ok();
};
