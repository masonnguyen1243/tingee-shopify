# Implementation Plan — Tingee × Shopify App

> Version: 1.2 | Date: 2026-06-12 | Status: Phase 1 complete

---

## Phase 1 — Project Setup

Goal: App Shopify cài được lên dev store, OAuth chạy, DB có schema, deps sẵn sàng.

- [x] Chạy `shopify app init` — chọn template **React Router (Node.js)**
- [x] Chạy `shopify app dev` — xác nhận OAuth flow, Cloudflare tunnel, và Prisma SQLite tạo được
- [x] Khai báo scopes trong `shopify.app.toml`: `write_orders, read_orders`
- [x] Đăng ký 4 webhooks trong `shopify.app.toml`: `customers/data_request`, `customers/redact`, `shop/redact`, `app/uninstalled`
- [x] Cài dependencies: `@tingee/sdk-node`, `@noble/ciphers` (mã hóa at-rest)
- [x] Thêm Prisma schema cho 5 bảng mới (bên cạnh `shopify_sessions` có sẵn):
  - [x] `merchants` — `id`, `shopify_shop_domain`, `shopify_access_token`, `created_at`
  - [x] `tingee_configs` — `id`, `merchant_id`, `client_id`, `secret_token` (encrypted), `status`, `created_at`
  - [x] `tingee_accounts` — `id`, `tingee_config_id`, `va_account_number`, `account_number`, `bank_bin`, `account_name`, `is_default`, `notify_registered`
  - [x] `payments` — `id`, `merchant_id`, `shopify_order_id`, `reconcile_code` (unique), `qr_code_image`, `amount`, `status`, `tingee_transaction_code`, `created_at`, `paid_at`
  - [x] `webhook_events` — `id`, `tingee_transaction_code`, `raw_headers`, `raw_body`, `matched_payment_id`, `received_at`
- [x] Chạy `prisma migrate dev` — xác nhận migration thành công
- [x] Thêm `ENCRYPTION_KEY` vào `.env` (key 32 bytes)

---

## Phase 2 — Core UI

Goal: Tất cả màn hình render được với dữ liệu tĩnh (hardcoded). Chưa gọi API thật.

**Màn cấu hình tài khoản Tingee** (`app/routes/app.settings.tsx`)
- [x] Form 2 trường: `Client ID`, `Secret Token` + nút "Kết nối"
- [x] Sau "kết nối" (mock): hiển thị danh sách VA dạng radio list — mỗi item gồm tên ngân hàng, số TK, tên chủ TK, badge trạng thái
- [x] Nút "Lưu cấu hình" bên dưới danh sách VA
- [x] Thông báo thành công sau khi lưu

**Trang QR thanh toán** (`app/routes/payment.qr.$orderId.tsx`)
- [x] Hiển thị ảnh QR (dùng ảnh placeholder)
- [x] Thông tin bên dưới QR: tên ngân hàng, số tài khoản, tên chủ TK, số tiền (hardcoded), mã đối soát (vd `TGABC1234`)
- [x] Banner cảnh báo nổi bật: "Không thay đổi nội dung chuyển khoản — một số ứng dụng ngân hàng cho phép sửa, nhưng thay đổi sẽ khiến đơn hàng không được xác nhận tự động"
- [x] Đồng hồ đếm ngược 15 phút
- [x] Dòng trạng thái "Đang chờ xác nhận thanh toán..."

---

## Phase 3 — Core Backend & Data Logic

Goal: Tất cả logic nghiệp vụ và tương tác DB hoàn chỉnh — chưa nối với UI.

**Encryption helper** (`app/utils/crypto.server.ts`)
- [x] `encrypt(plaintext: string, key: string): string` — trả ciphertext base64
- [x] `decrypt(ciphertext: string, key: string): string` — trả plaintext
- [x] Key đọc từ env `ENCRYPTION_KEY`; throw nếu thiếu key

**TingeeService** (`app/services/tingee.server.ts`)
- [x] `listVirtualAccounts(clientId, secretToken)` — gọi `POST /v1/get-va-paging`, trả mảng VA
- [x] `registerNotify(vaAccountNumber, bankBin, clientId, secretToken)` — gọi `register-notify` rồi `confirm-register-notify`
- [x] `generateVietQR(bankBin, accountNumber, amount, content, clientId, secretToken)` — gọi `POST /v1/generate-viet-qr`, trả `{ qrCode, qrCodeImage }`
- [x] `getTransactions(clientId, secretToken, ...)` — gọi `POST /v1/transaction/get-paging`
- [x] Mọi lỗi từ Tingee (code != "00") đều throw với message rõ ràng

**OrderReconcile service** (`app/services/order-reconcile.server.ts`)
- [x] `markPaid(shopDomain, orderId, amount, accessToken)` — gọi Shopify Admin API `POST /admin/api/2024-10/orders/{orderId}/transactions.json` với `kind=capture, status=success`
- [x] Cập nhật `payments.status = paid` và `payments.paid_at` trong DB

**IPN handler logic** (`app/services/ipn.server.ts`)
- [x] `verifySignature(timestamp, rawBody, secretToken): boolean`
- [x] `extractReconcileCode(content: string): string | null` — regex `TG[A-Z0-9]{5,10}`
- [x] `processIPN(payload, headers)` — full flow: verify → idempotency check → extract code → match payment → compare amount → markPaid hoặc set mismatch → lưu webhook_event

**Reconcile code generator** (`app/utils/reconcile.server.ts`)
- [x] `generateReconcileCode(): string` — `TG` + 7 ký tự random uppercase alphanumeric
- [x] `ensureUnique(code, db): Promise<string>` — check DB, retry nếu trùng (tối đa 5 lần)

---

## Phase 4 — Connect UI to Data

Goal: Mỗi màn hình dùng dữ liệu thật từ DB và API — xóa hết hardcoded.

**Màn cấu hình** (`app/routes/app.settings.tsx`)
- [ ] `loader`: đọc cấu hình hiện tại từ DB (nếu có) — hiện lại VA đã chọn
- [ ] `action` bước 1 (kết nối): nhận `clientId` + `secretToken` → gọi `TingeeService.listVirtualAccounts` → trả danh sách VA về UI
- [ ] `action` bước 2 (lưu): nhận VA đã chọn → gọi `registerNotify` nếu cần → mã hóa `secretToken` → lưu `tingee_configs` + `tingee_accounts`

**Trang QR** (`app/routes/payment.qr.$orderId.tsx`)
- [ ] `loader`: đọc `shopify_order_id` từ params → kiểm tra đơn trong DB (nếu đã có `payments` thì dùng lại) → gọi `generateVietQR` với `reconcile_code` mới → lưu bản ghi `payments`
- [ ] Polling endpoint `GET /api/payment-status/$orderId` — trả `{ status }` từ DB
- [ ] Khi polling nhận `paid` → redirect về `/orders/$orderId/confirmation`

**IPN endpoint** (`app/routes/webhooks.tingee.ipn.ts`)
- [ ] Nối với `processIPN` từ Phase 3
- [ ] Tìm `secretToken` đúng theo `clientId` trong payload → giải mã từ DB trước khi verify
- [ ] Luôn trả HTTP 200 với `{ "code": "00", "message": "Success" }`

---

## Phase 5 — Validation & Error States

Goal: App xử lý đúng mọi trường hợp lỗi — không crash, không lộ thông tin nhạy cảm.

**Form cấu hình**
- [ ] Validate `clientId` và `secretToken` không được để trống trước khi submit
- [ ] Hiển thị lỗi inline nếu Tingee trả code != "00" (vd "Thông tin đăng nhập không hợp lệ")
- [ ] Hiển thị lỗi nếu danh sách VA rỗng (vd "Tài khoản này chưa có VA nào. Vui lòng kiểm tra trên app.tingee.vn")
- [ ] Disable nút submit khi đang loading

**Trang QR**
- [ ] Nếu `generateVietQR` thất bại: hiện thông báo lỗi + nút thử lại
- [ ] Nếu đơn không tìm thấy trong Shopify: redirect về trang lỗi chung
- [ ] Khi đếm ngược hết 15 phút: ẩn đồng hồ, hiện "Đã hết thời gian. Nếu bạn đã chuyển tiền, vui lòng liên hệ shop."

**IPN webhook**
- [ ] Chữ ký sai: log warning (không log secretToken), bỏ qua, vẫn trả 200
- [ ] `transactionCode` đã xử lý: bỏ qua, trả 200 (idempotency)
- [ ] Không tìm thấy `reconcile_code`: lưu `webhook_events` với `matched_payment_id = null`, trả 200
- [ ] Amount lệch: set `payments.status = mismatch`, không gọi Shopify, trả 200
- [ ] Lỗi nội bộ (DB lỗi, Shopify API lỗi): log lỗi, vẫn trả 200 với `{ "code": "00" }`

**Chung**
- [ ] Không bao giờ log `secretToken`, `shopify_access_token`, hoặc nội dung sau decrypt
- [ ] Error boundary cho toàn bộ app admin (trang lỗi thân thiện thay vì crash trắng)
- [ ] Webhook `app/uninstalled`: set `tingee_configs.status = inactive` cho merchant đó

---

## Phase 6 — Local Run Instructions

Goal: Bất kỳ ai clone repo đều chạy được app trên máy local trong < 10 phút.

**Checklist tạo tài liệu / cấu hình:**
- [ ] Tạo `.env.example` với tất cả biến cần thiết và mô tả ngắn:
  ```
  SHOPIFY_API_KEY=        # Lấy từ Shopify Partner Dashboard
  SHOPIFY_API_SECRET=     # Lấy từ Shopify Partner Dashboard
  ENCRYPTION_KEY=         # 32-byte key (base64), tự sinh: openssl rand -base64 32
  TINGEE_BASE_URL=https://open-api.tingee.vn  # PROD API
  DATABASE_URL=           # SQLite (dev): file:./dev.db
  ```
- [ ] Viết mục "Getting Started" trong README:
  - [ ] Yêu cầu: Node.js 18+, Shopify CLI, tài khoản Shopify Partner, dev store
  - [ ] Bước 1: `cp .env.example .env` → điền giá trị
  - [ ] Bước 2: `npm install`
  - [ ] Bước 3: `npx prisma migrate dev`
  - [ ] Bước 4: `shopify app dev` (tự mở tunnel + OAuth)
  - [ ] Bước 5: Bấm "Install app" trên dev store
- [ ] Ghi rõ cách tạo manual payment method "Chuyển khoản / QR Tingee" trên Shopify Admin
- [ ] Ghi rõ cách khai báo Webhook URL trên `app.tingee.vn → Developers`

---

## Phase 7 — Demo Setup

Goal: Có thể demo đầy đủ luồng end-to-end trên UAT Tingee + Shopify dev store.

**Chuẩn bị môi trường demo:**
- [ ] Dev store có ít nhất 1 sản phẩm với giá cụ thể (vd 50.000đ)
- [ ] Manual payment method "Chuyển khoản / QR Tingee" đã được tạo trên dev store
- [ ] Tài khoản Tingee PROD có ít nhất 1 VA active; Client ID + Secret Token sẵn sàng
- [ ] Webhook URL khai báo trên `app.tingee.vn` trỏ về tunnel URL của `shopify app dev`
- [ ] `TINGEE_BASE_URL` trỏ PROD (`https://open-api.tingee.vn`)

**Checklist demo (chạy theo thứ tự):**
- [ ] **Luồng A — Cấu hình:** Mở app trong Shopify Admin → nhập credentials → chọn VA → lưu thành công
- [ ] **Luồng B — QR checkout:** Tạo đơn → chọn "Chuyển khoản / QR Tingee" → trang QR hiện đúng (ảnh QR, số TK, số tiền, mã đối soát)
- [ ] **Luồng C — Thanh toán thật:** Quét QR bằng app ngân hàng, chuyển khoản giữ nguyên nội dung (dùng số tiền nhỏ khi test, vd 1.000đ) → đơn tự chuyển "đã thanh toán" trong vòng 10 giây
- [ ] **Luồng D — Webhook giả:** Gửi POST thủ công tới `/webhooks/tingee/ipn` với chữ ký sai → xác nhận app không cập nhật đơn

**Deploy lên production (khi demo xong):**
- [ ] Cập nhật Webhook URL trên Tingee sang domain thật (thay tunnel URL)
- [ ] Chạy `shopify app deploy`

---

## Decisions & Blockers

**Quyết định kỹ thuật đã chốt:**

| Quyết định | Lý do |
|---|---|
| Manual payment method (không Payments Extension) | Không cần Shopify Payments Partner approval |
| QR tĩnh (`generate-viet-qr`) | Tingee chưa hỗ trợ QR động đủ ngân hàng |
| Đối soát bằng `reconcile_code` trong `content` | QR tĩnh không có `billId` |
| Mark paid qua Shopify Admin API | Không phụ thuộc Payments App API |
| Prisma + SQLite (dev) → PostgreSQL (prod) | Template CLI mặc định; dễ migrate |

**Blockers cần giải quyết trước Phase 1:**

| Cần có | Ai xử lý |
|---|---|
| Shopify Partner account + dev store | Dev / merchant |
| Tingee PROD Client ID + Secret Token | Merchant |
| Xác nhận `@tingee/sdk-node` có trên npm | Kiểm tra; nếu chưa có thì tự ký HMAC |
