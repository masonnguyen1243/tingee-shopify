# Test Plan — Tingee × Shopify App

> Version: 1.0 | Date: 2026-06-12 | Status: Pre-implementation

## Môi trường test

| Môi trường | Shopify | Tingee | Ghi chú |
|---|---|---|---|
| **Local dev** | Dev store + Cloudflare tunnel | UAT (`https://uat-open-api.tingee.vn`) | Dùng cho dev hàng ngày |
| **Staging** | Dev store | UAT | Test trước khi release |
| **PROD** | Production store | PROD (`https://open-api.tingee.vn`) | Sau khi Shopify review xong |

---

## T1 — Cấu hình tài khoản Tingee (F1)

### T1.1 — Happy path: kết nối thành công
**Bước:**
1. Mở màn Settings trong app
2. Nhập Client ID + Secret Token hợp lệ
3. Submit

**Expect:**
- Hiện danh sách VA (ít nhất 1 item: bankBin, accountName, accountNumber, vaAccountNumber)
- Không có lỗi

### T1.2 — Credentials sai
**Bước:** Nhập Secret Token sai → Submit

**Expect:** Thông báo lỗi "Thông tin đăng nhập không hợp lệ" (code != "00"), không lưu DB

### T1.3 — Chọn VA và lưu
**Bước:** Sau T1.1, chọn 1 VA → Submit

**Expect:**
- DB có bản ghi `tingee_configs` + `tingee_accounts`
- `secret_token` trong DB không phải plaintext
- Màn hình hiện "Cấu hình thành công"

### T1.4 — VA thuộc ngân hàng yêu cầu register-notify (ACB)
**Bước:** Chọn VA bankBin = `970416` (ACB) → Submit

**Expect:**
- App gọi `register-notify` + `confirm-register-notify`
- `notify_registered = true` trong DB
- Không lỗi

### T1.5 — Cấu hình lại (overwrite)
**Bước:** Đã có cấu hình, nhập credentials mới + chọn VA mới

**Expect:** Cấu hình cũ bị cập nhật, không duplicate

---

## T2 — Sinh QR và trang chờ (F2)

### T2.1 — Happy path: sinh QR thành công
**Bước:**
1. Tạo đơn Shopify với payment method "Chuyển khoản / QR Tingee"
2. Mở trang QR của đơn

**Expect:**
- Ảnh QR hiển thị (không vỡ)
- Hiện: tên NH, số TK, tên chủ TK, số tiền đúng, mã đối soát (`TG` + 7 ký tự)
- DB có bản ghi `payments` với `status=pending`, `reconcile_code` duy nhất
- Đồng hồ đếm ngược 15 phút hiển thị

### T2.2 — QR load với số tiền decimal
**Bước:** Đơn có amount = 99.000 VNĐ (số có phần thập phân sau quy đổi)

**Expect:** `generate-viet-qr` nhận đúng amount là số nguyên (làm tròn hoặc quy đổi đúng)

### T2.3 — Reconcile code duy nhất
**Bước:** Tạo 10 đơn cùng lúc

**Expect:** 10 `reconcile_code` khác nhau, không trùng

### T2.4 — Timeout 15 phút
**Bước:** Mở trang QR, đợi 15 phút (hoặc mock timeout)

**Expect:** Hiện thông báo hết hạn, đơn vẫn `pending` (không tự đóng/hủy)

### T2.5 — Polling: đơn paid tự redirect
**Bước:** Đơn đang pending, webhook đến và mark paid

**Expect:** Trong vòng 10 giây, trang chờ tự redirect về order confirmation

---

## T3 — Webhook IPN (F3)

### T3.1 — Happy path: IPN khớp đơn + amount
**Bước:** Gửi POST tới `/webhooks/tingee/ipn` với:
- `x-signature` đúng
- `content` chứa reconcile_code của đơn pending
- `amount` khớp đúng

**Expect:**
- HTTP 200 với `{ "code": "00", "message": "Success" }`
- `payments.status = paid`, `paid_at` được set
- Shopify order có transaction `capture/success`
- `webhook_events` có bản ghi với `matched_payment_id`

### T3.2 — Chữ ký sai
**Bước:** Gửi IPN với `x-signature` sai

**Expect:**
- HTTP 200 (vẫn phải trả 200)
- Không cập nhật đơn
- `webhook_events` lưu payload nhưng không match

### T3.3 — Idempotency: gửi lại cùng transactionCode
**Bước:** Gửi IPN với `transactionCode` đã xử lý thành công (simulate retry Tingee)

**Expect:**
- HTTP 200 với `{ "code": "00" }`
- Không tạo duplicate transaction trong Shopify
- `payments` không bị update lần 2

### T3.4 — Amount lệch (mismatch)
**Bước:** Gửi IPN với content đúng reconcile_code nhưng `amount` nhỏ hơn đơn

**Expect:**
- `payments.status = mismatch`
- Không mark paid trong Shopify
- `webhook_events` lưu, `matched_payment_id` trỏ về payment nhưng status vẫn mismatch

### T3.5 — Content không có reconcile_code
**Bước:** Gửi IPN với `content` = "chuyen khoan random" (không có TG prefix)

**Expect:**
- HTTP 200
- `webhook_events` lưu với `matched_payment_id = null`
- Không lỗi 500

### T3.6 — Tingee gửi webhook trước khi trang QR load xong
**Bước:** IPN đến trước khi `payments` bản ghi được tạo (race condition)

**Expect:** IPN lưu vào `webhook_events` với `matched_payment_id = null`; cron fallback sẽ match sau (hoặc merchant gán tay)

---

## T4 — Merchant dashboard (F4)

### T4.1 — Danh sách hiển thị đúng
**Bước:** Có data mix: pending, paid, mismatch → mở tab tương ứng

**Expect:** Mỗi tab chỉ hiện đúng status, số liệu đúng

### T4.2 — Gán thủ công
**Bước:**
1. Có 1 đơn `mismatch` và 1 `webhook_events` chưa match
2. Chọn "Gán thủ công", chọn event, confirm

**Expect:**
- `payments.status = manual_matched`
- `webhook_events.matched_payment_id` được cập nhật
- Shopify order mark paid

### T4.3 — Unmatched events tab
**Bước:** Có webhook_events với `matched_payment_id = null`

**Expect:** Hiện đúng trong tab "Chưa khớp đơn"; sau khi gán tay biến mất khỏi tab này

---

## T5 — Bảo mật & edge cases

### T5.1 — Secret Token không bị log
**Bước:** Kích hoạt đủ luồng, xem logs

**Expect:** Không có `secretToken`, `secret_token` nào trong log output

### T5.2 — GDPR webhooks phản hồi 200
**Bước:** Shopify gửi `customers/data_request`, `customers/redact`, `shop/redact`

**Expect:** HTTP 200; không lỗi

### T5.3 — App uninstall cleanup
**Bước:** Merchant gỡ app khỏi Shopify

**Expect:** Webhook `app/uninstalled` nhận được; `tingee_configs.status = inactive`

### T5.4 — Timestamp cũ quá 10 phút
**Bước:** Gửi IPN với `x-request-timestamp` cũ hơn 10 phút

**Expect:** Bỏ qua (không xử lý), vẫn trả 200

---

## Kiểm tra thủ công end-to-end (pre-release checklist)

- [ ] Cài app lên dev store mới (OAuth flow hoàn chỉnh)
- [ ] Cấu hình VA trên UAT Tingee
- [ ] Tạo đơn → chọn payment method → trang QR hiện đúng
- [ ] Scan QR thật bằng app ngân hàng (UAT amount nhỏ, vd 1.000đ)
- [ ] Webhook IPN đến → đơn tự paid
- [ ] Mở merchant dashboard → thấy đơn paid
- [ ] Test mismatch: chuyển sai số tiền → đơn mismatch → gán tay → paid
- [ ] Uninstall app → reinstall → flow hoạt động lại

---

## Không test ở MVP

- Load test / stress test (sau Phase 5)
- Multi-tenant race conditions (sau có nhiều merchant thật)
- QR động (sau khi Tingee hỗ trợ đủ)
- Payments Extension flow (sau khi được Shopify Payments Partner approval)
