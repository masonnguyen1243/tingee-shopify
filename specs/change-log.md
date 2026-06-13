# Change Log — Tingee × Shopify App

> Format: `[version] date — description`

---

## [0.1.2] 2026-06-12 — Bỏ F4 màn quản lý giao dịch

### Removed
- F4 (màn quản lý giao dịch / gán thủ công) khỏi product-spec và implementation-plan
- Luồng D (mismatch demo) khỏi Phase 7
- `app/routes/app.payments.tsx` khỏi danh sách cần implement

### Changed
- F2: Banner cảnh báo nội dung CK nay nêu rõ "một số ứng dụng ngân hàng cho phép sửa nội dung"
- Lý do: QR tĩnh đã có sẵn số tiền + nội dung, cảnh báo trên UI đủ cho MVP; Shopify Orders sẵn có đủ cho merchant theo dõi đơn bình thường

---

## [0.1.1] 2026-06-12 — Chuyển sang Tingee PROD API

### Changed
- `TINGEE_BASE_URL` mặc định trong `.env.example` đổi thành `https://open-api.tingee.vn` (PROD)
- Phase 7 demo: bỏ bước "chuyển sang PROD", chỉ còn bước deploy; Luồng C ghi chú dùng số tiền nhỏ khi test
- Blocker: đổi "Tingee UAT" → "Tingee PROD" credentials
- Lý do: dùng PROD ngay từ đầu, tránh divergence giữa UAT và PROD

---

## [2.0.0] 2026-06-13 — Phase 4a: Màn cấu hình nối với DB và Tingee API

### Changed
- `app/routes/app.settings.tsx` — xóa toàn bộ mock data, nối với dữ liệu thật:

**Loader:**
- Authenticate admin → tìm `Merchant` theo `shopDomain`
- Nếu merchant có `TingeeConfig` active, trả về `savedConfig` (clientId, VA mặc định, danh sách accounts)
- Dùng `getBankShortName(bankBin)` để hiển thị tên ngân hàng từ DB

**Action `_action=connect`:**
- Nhận `clientId` + `secretToken` từ form
- Gọi `TingeeService.listVirtualAccounts` với credentials thật
- Trả danh sách VA về UI; lỗi Tingee hiển thị inline banner

**Action `_action=save`:**
- Upsert `Merchant` (tạo hoặc update accessToken)
- Deactivate TingeeConfig cũ → tạo TingeeConfig mới (secretToken đã encrypt bằng AES-256-GCM)
- Gọi `registerNotify(vaAccountNumber, bankBin, ...)` — nếu lỗi thì vẫn lưu account với `notifyRegistered=false`
- Tạo `TingeeAccount` với `isDefault=true`

**UI:**
- Trang load có savedConfig → tự chuyển step="va-list", pre-fill clientId, hiển thị VA đã lưu
- Nút "Kết nối / Kết nối lại" → gửi submit `_action=connect`
- Nút "Lưu cấu hình" → gửi submit `_action=save` kèm VA được chọn
- Loading state dựa trên `useNavigation` (không dùng mock setTimeout)
- Lỗi connect/save hiển thị inline banner (không crash app)

### Design decisions
- `secretToken` không được pre-fill (encrypted ở DB, không decrypt để hiển thị) — user phải nhập lại khi muốn reconnect hoặc đổi VA
- `registerNotify` có thể fail nếu VA đã đăng ký trước → catch silently, lưu `notifyRegistered=false`

---

## [1.7.0] 2026-06-13 — Phase 3e: Reconcile code generator

### Added
- `app/utils/reconcile.server.ts`:
  - `generateReconcileCode(): string` — sinh `TG` + 7 ký tự random từ charset `A-Z0-9` dùng `crypto.randomBytes` (CSPRNG, không dùng `Math.random`)
  - `ensureUnique(): Promise<string>` — gọi `generateReconcileCode()`, kiểm tra DB xem code đã tồn tại chưa, retry tối đa 5 lần; throw nếu vẫn trùng sau 5 lần (xác suất xảy ra cực thấp)

### Design decisions
- Dùng `randomBytes` thay `Math.random` để đảm bảo entropy đủ mạnh (không đoán được)
- `b % CHARSET.length` (36 chars): modulo bias không đáng kể ở đây vì 256/36 ≈ 7.1 — entropy vẫn đủ cho 7 ký tự
- `ensureUnique` tự gọi `generateReconcileCode` bên trong (không nhận code từ ngoài vào) — đơn giản hơn spec gốc, không thay đổi behavior
- Xác suất trùng: charset 36^7 ≈ 78 tỷ tổ hợp → cực thấp kể cả khi có hàng triệu đơn

### Manual test
```
node -e "
import('./app/utils/reconcile.server.js').then(m => {
  // test generateReconcileCode
  for (let i = 0; i < 5; i++) console.log(m.generateReconcileCode());
});
" --input-type=module
# Kỳ vọng: 5 mã dạng 'TG' + 7 ký tự A-Z0-9, mỗi lần khác nhau
```

Compile check: `npm run typecheck` → pass.

---

## [1.6.0] 2026-06-13 — Phase 3d: IPN handler logic

### Added
- `app/services/ipn.server.ts`:
  - `verifySignature(timestamp, rawBody, secretToken, incomingSignature)`: tính `HMAC_SHA512(timestamp + ":" + rawBody, secretToken)` và so sánh timing-safe với `x-signature` header; trả `false` nếu độ dài buffer khác nhau (chữ ký không hợp lệ)
  - `extractReconcileCode(content)`: regex `TG[A-Z0-9]{5,10}`, trả `null` nếu không tìm thấy
  - `processIPN(payload, headers, rawBody)` — full flow:
    1. Idempotency: kiểm tra `WebhookEvent` theo `transactionCode` — nếu đã xử lý thì return
    2. Tìm `TingeeConfig` theo `clientId` (status = active)
    3. Giải mã `secretToken`, verify chữ ký — nếu sai thì lưu event với `matchedPaymentId = null` và return (không log secret)
    4. Trích `reconcileCode` từ `content` — nếu không tìm thấy thì lưu event unmatched
    5. Tìm `Payment` theo `reconcileCode` — nếu không thấy thì lưu event unmatched
    6. So sánh `amount` (làm tròn số nguyên VND): lệch → set `status = mismatch`; khớp → gọi `markPaid`
    7. Lưu `WebhookEvent` sau cùng để Tingee có thể retry nếu `markPaid` bị lỗi
    8. Nếu payment đã `paid` (retry sau khi markPaid thành công nhưng saveEvent thất bại): bỏ qua `markPaid`, chỉ lưu event

### Design decisions
- `verifySignature` nhận 4 params (thêm `incomingSignature`); spec ghi 3 params nhưng cần giá trị để so sánh
- `timingSafeEqual` dùng để chống timing attack; try-catch bắt buffer length mismatch (trả false)
- `WebhookEvent` lưu sau `markPaid` (không trước) để Tingee retry có thể re-process nếu Shopify API fail
- Chỉ log `transactionCode` trong warning, không bao giờ log `secretToken`

### Manual test
Dùng `curl` để gọi endpoint IPN (Phase 4), hoặc unit test riêng từng hàm:

```
# Test extractReconcileCode:
node -e "import('./app/services/ipn.server.js').then(m => { console.log(m.extractReconcileCode('TG7K2P9 chuyen khoan')); console.log(m.extractReconcileCode('no code here')); });" --input-type=module
# Kỳ vọng: 'TG7K2P9', null

# Test verifySignature (giả lập):
node -e "
import('./app/services/ipn.server.js').then(m => {
  const key = 'my-secret';
  const ts = '20260613120000000';
  const body = JSON.stringify({ amount: 1000 });
  const { createHmac } = await import('crypto');
  const sig = createHmac('sha512', key).update(ts + ':' + body).digest('hex');
  console.log('valid:', m.verifySignature(ts, body, key, sig));
  console.log('invalid:', m.verifySignature(ts, body, key, 'wrong'));
});
" --input-type=module
# Kỳ vọng: true, false
```

Compile check: `npm run typecheck` → pass.

---

## [1.5.0] 2026-06-13 — Phase 3c: OrderReconcile service

### Added
- `app/services/order-reconcile.server.ts`:
  - `markPaid(shopDomain, orderId, amount, accessToken, paymentId, tingeeTransactionCode)`:
    1. Gọi `POST https://{shopDomain}/admin/api/2024-10/orders/{orderId}/transactions.json` với `{ kind: "capture", status: "success", amount }`
    2. Nếu Shopify trả lỗi HTTP → throw Error với status code + body
    3. Cập nhật `payments.status = "paid"`, `payments.paidAt = now()`, `payments.tingeeTransactionCode` trong DB

### Manual test
Cần token thật để gọi Shopify Admin API. Test sẽ thực hiện trong Phase 7 khi demo end-to-end.

Compile check: `npm run typecheck` → pass.

---

## [1.4.0] 2026-06-13 — Phase 3b: TingeeService

### Added
- `app/services/tingee.server.ts` — 4 hàm gọi Tingee Open API qua `@tingee/sdk-node`:
  - `listVirtualAccounts(clientId, secretToken)` → danh sách VA của merchant (gọi `get-va-paging`)
  - `registerNotify(vaAccountNumber, bankBin, clientId, secretToken)` → đăng ký IPN cho VA (gọi `register-notify` + `confirm-register-notify` tự động)
  - `generateVietQR(bankBin, accountNumber, amount, content, clientId, secretToken)` → trả `{ qrCode, qrCodeImage }` (gọi `generate-viet-qr`)
  - `getTransactions(clientId, secretToken, vaAccountNumbers?, startTime?, endTime?)` → danh sách giao dịch (gọi `transaction/get-paging`)
- Hàm `assertOk<T>()` — throw `Error` có message rõ ràng khi Tingee trả `code != "00"`
- `makeClient()` — tạo `TingeeClient` per-merchant, đọc `TINGEE_BASE_URL` từ env (override nếu có)

### Manual test
Chưa thể test trực tiếp với Tingee API — cần `clientId` + `secretToken` thật. Test logic sẽ được thực hiện trong Phase 4 khi nối UI.

Có thể kiểm tra TypeScript compile clean bằng `npm run typecheck`.

---

## [1.3.0] 2026-06-13 — Phase 3a: Encryption helper

### Added
- `app/utils/crypto.server.ts` — AES-256-GCM encrypt/decrypt:
  - `encrypt(plaintext, key): string` — mã hóa AES-GCM, nonce 12 byte tự sinh (prepend vào ciphertext), trả base64
  - `decrypt(ciphertext, key): string` — giải mã, trả plaintext UTF-8
  - `key` là chuỗi base64 32 bytes (từ `ENCRYPTION_KEY` env); throw `Error` nếu rỗng
  - Dùng `managedNonce(gcm)` từ `@noble/ciphers` — nonce tự động, không cần quản lý thủ công

### Manual test
1. Chạy đoạn script nhỏ trong Node để kiểm tra:
   ```
   node -e "
   process.env.ENCRYPTION_KEY = require('child_process').execSync('openssl rand -base64 32').toString().trim();
   const key = process.env.ENCRYPTION_KEY;
   const { encrypt, decrypt } = await import('./app/utils/crypto.server.js');
   const ct = encrypt('hello', key);
   console.log('ciphertext:', ct);
   console.log('decrypted:', decrypt(ct, key));
   " --input-type=module
   ```
2. Hoặc: thêm test case trong route loader tạm thời để gọi `encrypt` rồi `decrypt` và xem kết quả.
3. Kỳ vọng: `decrypted` = `'hello'`; mỗi lần `encrypt` cùng text sẽ ra ciphertext khác nhau (do nonce ngẫu nhiên).

---

## [1.2.0] 2026-06-13 — Phase 2b: Trang QR thanh toán (UI tĩnh)

### Added
- `app/routes/payment.qr.$orderId.tsx` — trang customer-facing tại `/payment/qr/:orderId`:
  - QR placeholder dạng SVG (sẽ thay bằng ảnh thật ở Phase 4)
  - Thông tin thanh toán hardcoded: Vietcombank, số TK, chủ TK, số tiền 500.000đ, mã đối soát `TGABC1234` (nổi bật màu xanh)
  - Banner cảnh báo cam nổi bật: không thay đổi nội dung chuyển khoản
  - Đồng hồ đếm ngược 15 phút (đổi màu đỏ khi còn dưới 2 phút)
  - Dòng trạng thái "Đang chờ xác nhận thanh toán..." với dot xanh nhấp nháy
  - Khi hết giờ: hiện thông báo liên hệ shop thay vì timer

### Manual test
1. Chạy `shopify app dev`
2. Mở URL: `https://<tunnel-url>/payment/qr/12345` (thay orderId bất kỳ)
3. Thấy trang: heading + "Đơn hàng #12345", banner cam cảnh báo, QR placeholder, bảng thông tin, đếm ngược 15:00
4. Chờ ~30 giây: thấy đồng hồ đếm lùi
5. Để thời gian chạy hết (hoặc đổi `COUNTDOWN_SECONDS = 5` để test nhanh): thấy thông báo "Đã hết thời gian..."

---

## [1.1.0] 2026-06-13 — Phase 2a: Màn cấu hình Tingee (UI tĩnh)

### Added
- `app/routes/app.settings.tsx` — màn cấu hình với dữ liệu hardcoded:
  - Form 2 trường `Client ID` + `Secret Token` + nút "Kết nối" (mock delay 800ms)
  - Sau khi kết nối: danh sách VA radio list (3 mock items — Vietcombank, Techcombank, MB Bank)
  - Mỗi VA item hiển thị: tên ngân hàng (bold), số TK, chủ TK, badge trạng thái (Hoạt động / Không hoạt động)
  - Nút "Lưu cấu hình" bên dưới danh sách
  - Thông báo thành công qua Shopify Toast + dismissable Banner

### Changed
- `app/routes/app.tsx` — cập nhật nav: thay "Additional page" bằng "Cấu hình Tingee" (`/app/settings`)

### Manual test
1. Chạy `shopify app dev`, mở app trong Shopify Admin
2. Click "Cấu hình Tingee" trong nav → thấy form Client ID + Secret Token
3. Nhập bất kỳ giá trị → click "Kết nối" → sau ~0.8s hiện danh sách 3 VA
4. Mỗi VA có badge "Hoạt động" (xanh) hoặc "Không hoạt động" (đỏ); click để chọn
5. Click "Lưu cấu hình" → toast "Cấu hình đã được lưu thành công!" + banner xanh xuất hiện
6. Click X trên banner → banner biến mất

---

## [1.0.0] 2026-06-12 — Phase 1: Project setup

### Added
- Shopify React Router (TypeScript) template scaffolded from `https://github.com/Shopify/shopify-app-template-react-router` branch `main-cli`
- `shopify.app.toml`: scopes `write_orders,read_orders`; 4 webhook subscriptions (`app/uninstalled`, `customers/data_request`, `customers/redact`, `shop/redact`)
- Dependencies: `@tingee/sdk-node@0.2.3`, `@noble/ciphers@2.2.0`
- Prisma schema: 5 new models — `Merchant`, `TingeeConfig`, `TingeeAccount`, `Payment`, `WebhookEvent`
- Migration `20260612102441_phase1_setup` applied to SQLite dev DB
- `.env` with generated `ENCRYPTION_KEY` (32-byte base64); `.env.example` for onboarding

### Manual test
1. `npm install` → succeeds
2. `npx prisma migrate dev` → shows "Your database is now in sync with your schema"
3. `shopify app dev` (after filling `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` in `.env`) → OAuth flow opens, Cloudflare tunnel starts, app installs on dev store

---

## [0.1.0] 2026-06-12 — Spec-driven setup

- Khởi tạo tài liệu dự án: README, CLAUDE.md, product-spec, implementation-plan, test-plan
- Chưa có code — giai đoạn thiết kế và spec

---

<!-- Template cho entry tiếp theo:

## [x.y.z] YYYY-MM-DD — Tiêu đề ngắn

### Added
- ...

### Changed
- ...

### Fixed
- ...

### Removed
- ...

-->
