# Tài liệu phân tích & thiết kế: App tích hợp thanh toán Tingee × Shopify

> Phiên bản: 1.0 — Ngày: 12/06/2026
> Phạm vi: Thiết kế một app (Shopify Public App) cho phép merchant nhận thanh toán chuyển khoản/QR qua Tingee, tự động xác nhận đơn hàng — tương tự cách SePay làm với Shopify, nhưng dùng nền tảng Tingee.
> Stack: khởi tạo bằng **Shopify CLI** với template chính thức **React Router (Node.js + Prisma)** — đây là khung app Shopify khuyến nghị, lo sẵn OAuth/session/webhook (xem §0). Logic tích hợp Tingee (`@tingee/sdk-node`) viết thành service trong cùng app Node.js này.
> Môi trường: **PROD** — base URL `https://open-api.tingee.vn`.
> Loại QR: **QR tĩnh (VietQR)** — vì Tingee của merchant hiện chưa hỗ trợ QR động cho một số ngân hàng. (Khi Tingee bật QR động đầy đủ, có thể nâng cấp — xem §11.)

---

## 0. Khởi tạo dự án bằng Shopify CLI

Đây là điểm khởi đầu thực tế của dự án — **không tự dựng app từ con số 0**, mà dùng **Shopify CLI** để scaffold. CLI lo sẵn rất nhiều thứ mà nếu tự làm sẽ vừa mất công vừa khó qua review: OAuth, lưu session, đăng ký webhook, tunnel HTTPS khi dev, và đẩy cấu hình lên Shopify.

### 0.1. Yêu cầu
- Tài khoản **Shopify Partner** (hoặc tài khoản có quyền phát triển app) + một **development store** để test.
- Node.js + Shopify CLI bản mới nhất.

### 0.2. Scaffold app
```bash
shopify app init        # chọn template "Build a React Router app"
cd my-tingee-app
shopify app dev         # chạy local: tự login, tạo app trên Dev Dashboard,
                        # tạo Prisma SQLite DB, mở tunnel Cloudflare tới dev store
```
Khi server chạy, bấm `p` để mở URL preview → bấm **Install app** để cài lên dev store.

> **Lưu ý về stack:** template chính thức Shopify CLI khuyến nghị là **React Router (Node.js)** kèm **Prisma** để lưu session/dữ liệu. Đây là khác biệt so với giả định "NestJS" ban đầu — phần app giao tiếp với Shopify nên theo template này (đã tích hợp sẵn `@shopify/shopify-app-*`). Logic Tingee (ký HMAC, gọi `generate-viet-qr`, xử lý webhook IPN) viết thành module trong cùng app Node.js đó.

### 0.3. Những gì CLI tạo sẵn (không phải tự code)
- **OAuth flow Shopify** — luồng cài đặt, exchange token, lưu session qua Prisma (vai trò `AuthShopify` ở §4 — phần lớn đã có sẵn trong template).
- **Đăng ký webhook** — khai báo trong `shopify.app.toml`, gồm cả **GDPR mandatory webhooks** (`customers/data_request`, `customers/redact`, `shop/redact`) bắt buộc cho app công khai.
- **Khai báo scopes** — viết trong `shopify.app.toml` (`access_scopes`), vd `write_orders,read_orders`.

### 0.4. Tạo Payments Extension (cổng thanh toán QR)
Phần cốt lõi của app này là một **payments extension** — sinh qua CLI:
```bash
shopify app generate extension   # chọn loại payments (vd Offsite payment)
```
Với mô hình QR Tingee, loại phù hợp là **Offsite payment extension**: tại checkout, Shopify chuyển khách sang trang do app host → app hiển thị QR (từ `generate-viet-qr`) → khi Tingee bắn webhook báo tiền về, app gọi Payments Apps API để báo Shopify hoàn tất → đơn chuyển "đã thanh toán".

> ⚠️ **Ràng buộc quan trọng:** Payments extension **chỉ Partner được Shopify duyệt** mới build được, và phải qua **quy trình review riêng cho Payments Partner** (nghiêm hơn review App Store thường, kèm thỏa thuận chia sẻ doanh thu / revenue share). Một số khả năng custom payments còn giới hạn ở **merchant Shopify Plus**. Cần xác nhận điều kiện với Shopify Plus Support trước khi cam kết đi hướng này. Nếu chưa được duyệt làm Payments Partner, phương án thay thế là **manual payment method + UI hiển thị QR** (giống cách SePay đang làm, xem §3) — đơn giản hơn, không cần duyệt cổng thanh toán.

### 0.5. Deploy & phát hành
```bash
shopify app deploy      # đẩy app config + extensions lên Shopify, tạo version
```
Sau đó qua **Dev Dashboard / Partner Dashboard** để chọn cách phân phối (App Store công khai hoặc custom distribution) và nộp review.

---

## 1. Mục tiêu & phạm vi

Xây dựng một app trung gian (middleware) giữa **Shopify** và **Tingee**, thực hiện hai luồng nghiệp vụ chính:

1. **Luồng cấu hình STK** — merchant nhập `Client ID` + `Secret Token` của Tingee, app gọi Tingee để liệt kê các tài khoản (VA) đã liên kết, merchant chọn tài khoản nhận tiền → cấu hình hoàn tất.
2. **Luồng thanh toán** — khách mua hàng trên website Shopify → đến bước checkout chọn phương thức thanh toán QR Tingee → app sinh QR tĩnh (VietQR) kèm mã đối soát → khách chuyển tiền → Tingee bắn webhook về app → app cập nhật trạng thái đơn (qua Payments Apps API hoặc Admin API) → đơn hiển thị trạng thái "đã thanh toán" trong Shopify Admin.

Tài liệu này mô tả kiến trúc, luồng dữ liệu, đặc tả tích hợp với từng API của Tingee và Shopify, mô hình dữ liệu, và các điểm rủi ro cần xử lý.

---

## 2. Khác biệt cốt lõi: Tingee vs SePay

Đây là phần quan trọng nhất — vì cách "liên kết tài khoản" của hai bên **khác nhau về bản chất**, nên không thể bê nguyên kiến trúc của SePay sang.

| Tiêu chí | SePay (tích hợp Shopify) | Tingee (Open API) |
|---|---|---|
| **Cách merchant cấu hình** | Merchant thao tác **thủ công trên web my.sepay.vn**: thêm tài khoản ngân hàng, tạo "Tích hợp Shopify", chọn ngân hàng, dán Shopify API Token + URL cửa hàng. SePay lo phần còn lại. | App của bạn gọi **API Tingee bằng `Client ID` + `Secret Token`** do merchant cung cấp. App tự liệt kê VA, tự sinh QR, tự nhận webhook. Tingee chỉ là nhà cung cấp API thuần — không có giao diện "tích hợp Shopify" sẵn. |
| **Xác thực request** | API Token của SePay (Bearer token). | **Ký HMAC-SHA512** cho từng request: `x-signature = HMAC_SHA512(timestamp + ":" + JSON.stringify(body), secretToken)`, kèm headers `x-client-id`, `x-request-timestamp` (format `yyyyMMddHHmmssSSS`, UTC+7). |
| **Nguồn QR / thông tin thanh toán** | SePay tự render VietQR dựa trên tài khoản đã chọn + mã đơn (prefix). Đối soát theo **nội dung CK + số tiền**. | App gọi `/v1/generate-viet-qr` để lấy **chuỗi QR + ảnh QR (base64)**. Vì là **QR tĩnh** (không có `billId`), đối soát theo **nội dung CK + số tiền** — giống SePay. App tự nhúng **mã đối soát duy nhất** vào trường `content`. |
| **Webhook** | SePay gọi webhook về hệ thống bạn (hoặc SePay tự cập nhật Shopify nếu dùng tích hợp sẵn). | Tingee gửi webhook (IPN) về URL bạn đăng ký trong trang Developers; payload có `transactionCode`, `amount`, `content`, `vaAccountNumber`. Phải **verify chữ ký** và phản hồi `{"code":"00"}`. |
| **Ai cập nhật đơn Shopify** | SePay (tích hợp sẵn) hoặc bạn. | **App của bạn** phải tự gọi Shopify Admin API để tạo transaction/đánh dấu paid. |
| **Vai trò của bạn (developer)** | Người dùng cuối / cấu hình. | **Người xây dựng cả nền tảng tích hợp** — bạn đóng vai trò "SePay" trong mô hình này. |

**Kết luận:** Với Tingee, bạn không chỉ "cấu hình" mà phải **tự xây toàn bộ phần middleware** mà SePay đã làm sẵn cho người dùng của họ. App của bạn = "SePay-for-Tingee".

---

## 3. Khác biệt về mô hình Shopify: Public App vs Manual Payment (cách SePay)

Bạn đã chọn xây dựng **Shopify Public App**. So với cách SePay dùng (Custom App + Manual Payment Method):

| | SePay (hiện tại) | Public App (lựa chọn của bạn) |
|---|---|---|
| Cài đặt | Merchant tự tạo Custom App, copy Admin API token dán vào SePay | Merchant cài qua **OAuth** từ Shopify App Store / link install |
| Token | Admin API token tĩnh do merchant tạo | **Access token** lấy qua OAuth, app tự quản lý |
| Phương thức thanh toán | "Manual payment method" tên chứa "chuyển khoản"/"VietQR" + chèn script vào trang order-status | Nên dùng **Payments App Extension** (Payments App API) để xuất hiện như cổng thanh toán thật, hoặc vẫn dùng manual + UI extension |
| Phê duyệt | Không cần | Cần qua quy trình review của Shopify nếu phát hành công khai |
| Multi-merchant | Mỗi merchant cấu hình riêng | Một codebase phục vụ nhiều merchant |

> **Khuyến nghị kiến trúc (có điều kiện):** Nếu được Shopify duyệt làm **Payments Partner** (xem ràng buộc ở §0.4), nên dùng **Payments App Extension** (Shopify Payments Apps API) thay cho "manual payment method": app nhận `payment session`, hiển thị QR, rồi gọi `paymentSessionResolve` khi Tingee báo thành công — cho trải nghiệm "đã thanh toán thành công" tức thì giống demo SePay, không cần hack script vào order-status (đã bị Shopify siết từ 10/02/2025).
>
> **Nếu chưa/không được duyệt Payments Partner:** đi theo **manual payment method + hiển thị QR** (Checkout UI extension / trang trung gian) đúng như SePay — vẫn auto xác nhận đơn qua Admin API, chỉ là không hiện như "cổng thanh toán" gốc. Đây là phương án mặc định an toàn để khởi động.

---

## 4. Kiến trúc tổng thể

```
┌────────────────┐        OAuth / Admin API        ┌──────────────────────┐
│    Shopify     │ ◄─────────────────────────────► │                      │
│  (Storefront + │                                  │   APP MIDDLEWARE     │
│   Admin +      │   Payments App / Order update    │ (React Router/Node +  │
│   Checkout)    │ ◄─────────────────────────────► │                      │
└────────────────┘                                  │  - OAuth Shopify     │
                                                     │  - Tingee config     │
         ▲  khách quét QR                            │  - QR generation     │
         │                                           │  - Webhook receiver  │
         │                                           │  - Order reconciler  │
┌────────────────┐    HMAC-signed REST + Webhook     │  - DB (Prisma)       │
│     Tingee     │ ◄─────────────────────────────► │                      │
│   Open API     │  generate-viet-qr / get-va / IPN  └──────────────────────┘
└────────────────┘
```

Các thành phần logic (tên dưới đây là vai trò, ánh xạ thành route/service trong app React Router do CLI tạo; `Auth`/`Webhook` phần lớn đã có sẵn trong template `@shopify/shopify-app-*`):

- **`AuthShopify`** — OAuth install flow + lưu session (CLI/template lo sẵn).
- **`TingeeService`** — wrapper quanh `@tingee/sdk-node`: lưu credentials, gọi `get-va-paging`, `generate-viet-qr`, `register-notify`.
- **`MerchantConfig`** — lưu cấu hình của từng merchant (credentials Tingee, VA đã chọn, mapping shop).
- **`Checkout`** — phần payments extension xử lý khi khách chọn thanh toán; sinh QR, hiển thị cho khách.
- **`Webhook`** — nhận IPN từ Tingee, verify chữ ký, đối soát theo mã đối soát + amount, kích hoạt cập nhật đơn.
- **`OrderReconcile`** — gọi Payments Apps API / Shopify Admin API để đánh dấu đơn paid / resolve payment session.

---

## 5. Luồng 1 — Cấu hình STK (kết nối tài khoản Tingee)

Đây là điểm khác biệt lớn nhất so với SePay. Luồng:

```
Merchant (trong Admin app của bạn)
   │ 1. Nhập Client ID + Secret Token (lấy từ app.tingee.vn → Developers)
   ▼
App backend
   │ 2. Lưu tạm credentials, ký HMAC và gọi Tingee:
   │    POST /v1/get-va-paging  { skipCount:0, maxResultCount:50 }
   ▼
Tingee  →  trả danh sách VA: [{ bankBin, accountName, accountNumber, vaAccountNumber, status, ... }]
   │ 3. App hiển thị danh sách VA cho merchant chọn
   ▼
Merchant chọn 1 (hoặc nhiều) VA để nhận tiền
   │ 4. App (tùy ngân hàng) gọi /v1/register-notify + /v1/confirm-register-notify
   │    để đảm bảo VA này bắn biến động về (đặc biệt ACB)
   ▼
App lưu cấu hình → "Cấu hình thành công"
```

### 5.1. Lấy Client ID & Secret Token (phía merchant)
Theo doc Tingee: merchant đăng nhập `app.tingee.vn` → avatar → **Developers** → thấy `Client ID` và `Secret Token`. Cũng tại đây merchant cấu hình **Webhook URL** (trỏ về endpoint app của bạn).

### 5.2. Sinh chữ ký (bắt buộc cho mọi request)
```
x-signature = HMAC_SHA512( x-request-timestamp + ":" + JSON.stringify(body), secretToken )
```
- `x-request-timestamp`: `yyyyMMddHHmmssSSS`, múi giờ **UTC+7**, không cũ quá 10 phút.
- `requestBody`: chuỗi JSON **minified** (đúng kết quả `JSON.stringify`).
- Headers bắt buộc: `x-client-id`, `x-request-timestamp`, `x-signature`, `Content-Type: application/json`.

> SDK `@tingee/sdk-node` tự lo phần ký này — khuyến nghị dùng SDK thay vì tự ký để tránh lỗi `97` (sai chữ ký).

### 5.3. Liệt kê tài khoản đã liên kết — `POST /v1/get-va-paging`
Request body:
```json
{ "filter": "", "skipCount": 0, "maxResultCount": 50, "bankBin": "", "accountType": "" }
```
Response (rút gọn):
```json
{
  "code": "00",
  "data": {
    "totalCount": 1,
    "items": [{
      "bankBin": "970418",
      "accountName": "LE DUY NGHIEM",
      "accountNumber": "0123456789111",
      "vaAccountNumber": "VQRQAHFVA0551",
      "status": "active",
      "shopId": 1001,
      "accountType": "personal-account",
      "creationTime": "2025-09-04T08:12:32.160Z"
    }]
  }
}
```
→ App map mỗi item thành một lựa chọn tài khoản nhận tiền. Lưu `vaAccountNumber` + `bankBin` (đây là 2 trường cần để sinh QR sau này).

### 5.4. Đăng ký nhận biến động — `POST /v1/register-notify` (tùy ngân hàng)
Một số ngân hàng (vd **ACB**) yêu cầu bước đăng ký webhook riêng cho từng VA. Body:
```json
{ "vaAccountNumber": "V1T199988811", "bankBin": "970416" }
```
Response trả `confirmId` → gọi tiếp `POST /v1/confirm-register-notify` để hoàn tất. Với các ngân hàng không yêu cầu, có thể bỏ qua bước này (đối chiếu bảng hỗ trợ trong "Lưu ý quan trọng" của Tingee).

> Lưu ý vận hành: ngoài register-notify ở mức VA, merchant vẫn cần khai báo **Webhook URL** trong trang Developers (loại áp dụng: Tất cả / Số tài khoản ảo / Cửa hàng) để Tingee biết bắn IPN về đâu.

---

## 6. Luồng 2 — Thanh toán & xác nhận đơn

```
Khách checkout trên Shopify
   │ 1. Chọn phương thức "Thanh toán QR qua Tingee"
   ▼
Shopify → gọi App (Payment session / endpoint checkout)
   │ 2. App tạo bản ghi Payment (lưu orderId, amount, shop)
   │    + sinh MÃ ĐỐI SOÁT duy nhất (vd: "TG7K2P9") để nhúng vào content
   │ 3. App gọi Tingee: POST /v1/generate-viet-qr
   │      { bankBin, accountNumber, amount, content:"<mã đối soát>" }
   ▼
Tingee → trả { qrCode, qrCodeImage(base64) }
   │ 4. App lưu (mã đối soát + amount) ↔ orderId, render QR cho khách (kèm polling/SSE)
   ▼
Khách quét QR & chuyển tiền (giữ nguyên nội dung CK = mã đối soát)
   ▼
Tingee → POST webhook IPN về App
   │ 5. App verify x-signature, đọc content + amount
   │ 6. Tìm mã đối soát trong content → ra orderId, kiểm tra amount khớp
   ▼
App → Shopify Admin API: tạo transaction "sale"/paid (hoặc paymentSessionResolve)
   │ 7. Đơn chuyển trạng thái "Đã thanh toán"
   │ 8. App phản hồi Tingee { "code":"00", "message":"Success" }
   ▼
Storefront hiển thị "Thanh toán thành công" + Shopify gửi email xác nhận
```

### 6.1. Sinh QR tĩnh (VietQR) — `POST /v1/generate-viet-qr`
Body:
```json
{
  "bankBin": "970418",
  "accountNumber": "21510002865945",
  "amount": 500000,
  "content": "TG7K2P9"
}
```
Response:
```json
{
  "code": "00",
  "data": {
    "qrCode": "00020101021238540010A0000007270124000697041801102151000286...",
    "qrCodeImage": "data:image/png;base64,iVBORw0KGgoAAAANSU..."
  }
}
```
- `qrCode` là chuỗi VietQR (render bằng thư viện QR nếu cần); `qrCodeImage` là ảnh PNG base64 dùng trực tiếp ở storefront.
- **Lưu ý quan trọng — QR tĩnh không có `billId`.** Khóa đối soát phải tự tạo: app sinh một **mã đối soát duy nhất** (vd `TG` + chuỗi ngẫu nhiên ngắn, không trùng) cho mỗi đơn, đặt vào trường `content`. Lưu mapping `content (mã đối soát) + amount → shopifyOrderId`.
- `accountNumber` là **số tài khoản thật** của VA đã chọn ở bước cấu hình (không phải `vaAccountNumber`). `amount` là số tiền điền sẵn khi khách quét.
- Vì QR tĩnh dùng được nhiều lần, **không tái sử dụng cùng một mã đối soát** cho 2 đơn khác nhau; mỗi đơn 1 mã riêng để tránh nhầm lẫn khi đối soát.

### 6.2. Nhận webhook (IPN) — `POST {webhookUrl}`
Headers: `x-request-id`, `x-request-timestamp`, `x-signature`.
Body:
```json
{
  "clientId": "...",
  "transactionCode": "FT25...",
  "amount": 500000,
  "content": "Thanh toan don hang #1001",
  "bank": "BIDV",
  "accountNumber": "21510002865945",
  "vaAccountNumber": "",
  "transactionDate": "20260612101122",
  "additionalData": []
}
```
Xử lý:
1. **Verify chữ ký**: `HMAC_SHA512(timestamp + ":" + JSON.stringify(body), secretToken)` so với `x-signature`. Không khớp → bỏ qua.
2. **Idempotency**: dùng `transactionCode` để chống xử lý trùng (Tingee retry tối đa 5 lần, cách nhau 1 phút).
3. **Đối soát theo nội dung** (vì QR tĩnh không có `billId`): trích **mã đối soát** từ trường `content` (vd dò regex `TG[A-Z0-9]+`), tra ra `orderId`. Đây là điểm khác QR động.
4. **Đối chiếu số tiền**: so `amount` thực nhận với số tiền đơn tương ứng mã đối soát. Nếu lệch → đánh dấu cần review (xem §8).
5. Gọi Shopify cập nhật đơn.
6. Phản hồi HTTP 200 với `{ "code": "00", "message": "Success" }`.

### 6.3. Cập nhật đơn Shopify
Hai cách tùy mô hình tích hợp:

- **Payments App (nếu được duyệt Payments Partner — xem §0.4):** gọi mutation `paymentSessionResolve` với `id` của payment session đã tạo ở bước checkout → Shopify tự đánh dấu đơn paid và hiển thị "thành công".
- **Manual payment + Admin API (mặc định, giống SePay):** gọi REST `POST /admin/api/{version}/orders/{order_id}/transactions.json` với `{ "transaction": { "kind": "capture", "status": "success", "amount": "..." } }`. SePay chính là dùng cách này (doc của họ cho phép tùy chỉnh `kind`, `source`).

---

## 7. Mô hình dữ liệu (đề xuất)

> Template CLI dùng **Prisma** (mặc định SQLite cho dev). Production khuyến nghị đổi datasource Prisma sang **PostgreSQL/MySQL**. Phần `shopify_sessions` (lưu OAuth session) đã có sẵn trong schema Prisma của template — các bảng dưới là phần **bổ sung** cho nghiệp vụ Tingee.

**Bảng tối thiểu (MVP):**

```
merchants
  id (pk)
  shopify_shop_domain      -- vd: mystore.myshopify.com
  shopify_access_token     -- lấy từ OAuth
  created_at

tingee_configs
  id (pk)
  merchant_id (fk)
  client_id                -- Tingee Client ID
  secret_token (encrypted) -- Tingee Secret Token, mã hóa at-rest
  webhook_secret           -- = secret_token, dùng verify IPN
  status                   -- active / pending
  created_at

tingee_accounts            -- VA mà merchant chọn nhận tiền
  id (pk)
  tingee_config_id (fk)
  va_account_number
  account_number           -- số TK thật, dùng cho generate-viet-qr (QR tĩnh)
  bank_bin
  account_name
  is_default
  notify_registered (bool)

payments
  id (pk)
  merchant_id (fk)
  shopify_order_id
  shopify_payment_session_id  -- nếu dùng Payments App
  reconcile_code (unique)     -- mã đối soát app tự sinh, nhúng vào content QR
  qr_code (text)              -- chuỗi VietQR
  qr_code_image (text)        -- ảnh QR base64 từ generate-viet-qr
  amount
  status                      -- pending / paid / mismatch / expired / manual_matched
  tingee_transaction_code     -- từ webhook, để idempotency
  created_at, paid_at
```

**Bảng nên thêm khi lên Production / App Store:**

```
webhook_events             -- lưu payload + header thô của mọi IPN (audit + idempotency)
  id (pk)
  tingee_transaction_code
  raw_headers (json), raw_body (json)
  matched_payment_id (fk, nullable)  -- null = giao dịch chưa khớp đơn nào
  received_at

-- refunds        : nếu hỗ trợ hoàn tiền (Tingee có API /v1/refund)
-- audit_logs     : nhật ký thao tác của merchant
-- subscriptions  : nếu thu phí qua Shopify Billing
```

> `webhook_events` quan trọng nhất nên thêm sớm: Tingee khuyến cáo lưu toàn bộ payload+header để tra soát, và đây cũng là nơi chứa giao dịch QR tĩnh **chưa map được đơn** (khách xóa/sửa nội dung) để xử lý tay.

Lưu ý bảo mật: **Secret Token mã hóa at-rest** (KMS / libsodium), không log ra; chỉ giải mã khi ký request.

---

## 8. Rủi ro & xử lý

| Rủi ro | Mô tả | Cách xử lý |
|---|---|---|
| **Khách sửa số tiền / nội dung khi quét QR tĩnh** | QR tĩnh cho phép khách sửa cả số tiền lẫn nội dung trước khi chuyển → dễ sai lệch (rủi ro cao hơn QR động) | Đối chiếu cả **mã đối soát trong content** và **amount**; chỉ auto-paid khi cả hai khớp. Lệch → `mismatch`, thông báo merchant kiểm tra (ảnh CK / sao kê) |
| **Khách xóa/đổi mã đối soát trong nội dung** | Mất mã đối soát → không map được đơn | Hướng dẫn rõ "giữ nguyên nội dung CK" trên màn QR; fallback đối soát phụ theo amount + thời gian + tài khoản nhận; có màn merchant gán tay giao dịch chưa khớp |
| **Trùng số tiền giữa nhiều đơn** | Nhiều đơn cùng amount, khách quên nội dung → khó phân biệt | Mã đối soát duy nhất mỗi đơn là khóa chính; amount chỉ là điều kiện phụ |
| **Webhook trùng (retry)** | Tingee retry tối đa 5 lần | Idempotency theo `transactionCode`; đã xử lý → vẫn trả `code:00` |
| **Sai chữ ký webhook giả mạo** | Request giả | Bắt buộc verify `x-signature`; sai → bỏ |
| **Sai timestamp (code 90/91)** | Lệch giờ server | Đồng bộ NTP, dùng UTC+7, không cũ quá 10 phút |
| **Sai chữ ký request (code 97)** | Lỗi ký thủ công | Dùng SDK chính thức; body phải minified |
| **QR tĩnh không tự hết hạn** | QR tĩnh dùng lại được, không có thời gian hết hạn như QR động | App tự đặt timeout phía mình cho mỗi đơn (vd 15'); khách trả sau timeout vẫn đối soát được theo mã đối soát nhưng cần cảnh báo/đối chiếu thủ công |
| **Shopify siết script (10/02/2025)** | Không nhúng script vào order-status nữa | Dùng Payments App Extension / Checkout UI Extension thay vì script tag |
| **Token Shopify hết hạn / app gỡ** | Merchant uninstall | Lắng nghe webhook `app/uninstalled`, vô hiệu cấu hình |

---

## 9. Danh mục endpoint Tingee dùng trong app

| Mục đích | Endpoint | Khi nào gọi |
|---|---|---|
| Liệt kê VA đã liên kết | `POST /v1/get-va-paging` | Lúc merchant cấu hình STK |
| Danh sách ngân hàng (BIN) | `POST /v1/get-banks` | Hiển thị tên NH, map bankBin |
| Đăng ký nhận biến động | `POST /v1/register-notify` | Khi chọn VA (NH yêu cầu, vd ACB) |
| Xác nhận đăng ký | `POST /v1/confirm-register-notify` | Sau register-notify |
| **Sinh QR tĩnh (VietQR)** | `POST /v1/generate-viet-qr` | Mỗi đơn hàng tại checkout |
| Lịch sử giao dịch | `POST /v1/transaction/get-paging` | Đối soát định kỳ / fallback nếu webhook trễ |
| Webhook nhận IPN | (URL của bạn, đăng ký ở trang Developers) | Khi có biến động |

> Base URL **PROD**: `https://open-api.tingee.vn`. (UAT `https://uat-open-api.tingee.vn` chỉ dùng khi test trước khi go-live.)
>
> Vì dùng QR tĩnh nên app **không gọi** `generate-dynamic-qr` / `get-status-dynamic-qr` — đối soát hoàn toàn dựa vào webhook IPN + (fallback) `transaction/get-paging`.

---

## 10. Các bước triển khai đề xuất (roadmap)

1. **Scaffold bằng Shopify CLI** (xem §0) — `shopify app init` (template React Router), `shopify app dev` cài lên dev store. OAuth/session/webhook đã có sẵn từ template. Khai báo scopes trong `shopify.app.toml`.
2. **Tài khoản & SDK Tingee** — đăng ký đối tác Tingee, lấy Client ID/Secret Token (test UAT trước); cài `@tingee/sdk-node` vào app; (nếu đi hướng cổng thanh toán) đăng ký & chờ duyệt **Payments Partner**.
3. **Màn cấu hình STK** — form nhập Client ID/Secret Token → gọi `get-va-paging` → render danh sách VA → lưu lựa chọn → (tùy NH) register-notify.
4. **Checkout & QR** — `shopify app generate extension` tạo Offsite payment extension; tại trang thanh toán → sinh mã đối soát → `generate-viet-qr` → render QR (ảnh base64) + trạng thái chờ.
5. **Webhook** — endpoint nhận IPN, verify chữ ký, idempotency, đối soát **mã trong content + amount**.
6. **Reconcile đơn** — `paymentSessionResolve` (hoặc tạo transaction Admin API) → đơn "đã thanh toán".
7. **Đối soát & fallback** — cron gọi `transaction/get-paging` cho đơn pending; màn xử lý giao dịch `mismatch` / gán tay.
8. **Test → PROD** — test end-to-end trên UAT, rồi đổi base URL + credentials sang **PROD** (`https://open-api.tingee.vn`).
9. **Deploy & nộp duyệt** — `shopify app deploy`; chuẩn bị listing, GDPR webhooks; nộp review App Store (và review Payments Partner nếu dùng payments extension — xem §0.4).

---

## 11. Lộ trình nâng cấp lên QR động (khi Tingee hỗ trợ đầy đủ)

Hiện dùng QR tĩnh vì Tingee chưa hỗ trợ QR động cho một số ngân hàng. Khi sẵn sàng, nâng cấp gọn nhờ thiết kế đã tách bạch:

- Thay lời gọi `generate-viet-qr` bằng `generate-dynamic-qr` (`{ vaAccountNumber, qrCodeType:"dynamic-one-time-payment", bankBin, amount, purpose, expireInMinute }`), nhận về `billId`.
- Đổi khóa đối soát từ `reconcile_code` (trong content) sang `billId` (trong `additionalData` của webhook) — chính xác tuyệt đối, không lo khách sửa nội dung.
- Bổ sung `expireInMinute` cho QR hết hạn; có thể dùng `get-status-dynamic-qr` để polling fallback.
- Khuyến nghị tách lớp `QrStrategy` (static vs dynamic) trong `TingeeService` ngay từ đầu để switch theo từng ngân hàng/merchant mà không phải sửa luồng checkout.

---

## Nguồn tham khảo

- SePay — Hướng dẫn tích hợp Shopify: https://docs.sepay.vn/tich-hop-shopify.html
- Shopify — Scaffold an app (Shopify CLI, template React Router): https://shopify.dev/docs/apps/build/scaffold-app
- Shopify — Extensions for payments (payments extension, offsite, review): https://shopify.dev/docs/apps/build/payments
- Tingee — Bắt đầu ngay (Client ID, Secret Token, ký HMAC, webhook config): https://developers.tingee.vn/docs/config-info
- Tingee — Tài khoản & Định danh: https://developers.tingee.vn/docs/banking/
- Tingee — Danh sách số tài khoản (`get-va-paging`): https://developers.tingee.vn/docs/banking/get-va-paging
- Tingee — Đăng ký nhận biến động (`register-notify`): https://developers.tingee.vn/docs/banking/register-notify
- Tingee — QR Code tĩnh / VietQR (`generate-viet-qr`): https://developers.tingee.vn/docs/qr/static/generate-viet-qr
- Tingee — QR Code động (`generate-dynamic-qr`, tham khảo cho §11): https://developers.tingee.vn/docs/qr/dynamic/generate-dynamic-qr
- Tingee — Webhook thanh toán (IPN): https://developers.tingee.vn/docs/webhook/webhook-payment-callback
- Tingee — SDK: https://developers.tingee.vn/sdk/
