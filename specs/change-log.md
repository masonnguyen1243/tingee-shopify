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
