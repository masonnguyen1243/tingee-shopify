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
