# Product Spec — Tingee × Shopify App

> Version: 1.2 | Date: 2026-06-12 | Status: Pre-implementation

---

## 1. App Goal

Cho phép merchant Shopify Việt Nam nhận thanh toán chuyển khoản ngân hàng / QR qua Tingee và tự động xác nhận đơn hàng — không cần kiểm tra sao kê hay đánh dấu tay.

App đóng vai trò middleware: kết nối tài khoản Tingee của merchant với Shopify, sinh mã QR cho từng đơn, nhận thông báo biến động từ Tingee, và cập nhật trạng thái đơn "đã thanh toán" tự động.

---

## 2. Target Users

**Merchant (người dùng chính)**
- Chủ shop Shopify tại Việt Nam đang dùng Tingee (có `Client ID` + `Secret Token` từ `app.tingee.vn`)
- Muốn tự động hóa xác nhận đơn CK — hiện đang làm thủ công hoặc dùng SePay nhưng cần chuyển sang Tingee
- Cần giao diện quản lý đơn giản để theo dõi và xử lý giao dịch chưa khớp

**Khách mua hàng (người dùng thứ cấp)**
- Người mua trên store của merchant
- Muốn thanh toán bằng chuyển khoản / QR, không cần tài khoản hay thẻ

**Developer / agency (người triển khai)**
- Cài app thay merchant; cần quy trình cài đặt rõ ràng, ít bước thủ công

---

## 3. Core User Flow

Có 2 luồng chính:

### Luồng A — Merchant cấu hình (1 lần)

```
Merchant mở app trong Shopify Admin
    → Nhập Client ID + Secret Token (lấy từ app.tingee.vn → Developers)
    → App lấy danh sách tài khoản ảo (VA) từ Tingee
    → Merchant chọn 1 VA làm tài khoản nhận tiền
    → App lưu cấu hình; khai báo Webhook URL trên Tingee Developers
    → Cấu hình hoàn tất
```

### Luồng B — Khách thanh toán (mỗi đơn)

```
Khách chọn "Chuyển khoản / QR Tingee" tại checkout
    → App sinh mã đối soát duy nhất + gọi Tingee lấy QR tĩnh
    → Khách thấy: ảnh QR, số TK, tên NH, số tiền, mã đối soát
    → Khách quét QR → chuyển khoản (giữ nguyên nội dung)
    → Tingee phát hiện biến động → gửi webhook về app
    → App verify chữ ký → đối soát mã + số tiền → đánh dấu đơn "đã thanh toán"
    → Khách thấy xác nhận thanh toán; merchant thấy đơn paid trong Admin
```

---

## 4. Features In Scope (MVP)

### F1 — Kết nối tài khoản Tingee

Merchant nhập credentials Tingee, app kiểm tra và lấy danh sách VA để merchant chọn tài khoản nhận tiền.

**Acceptance criteria:**
- [ ] Form nhập `Client ID` và `Secret Token`
- [ ] Sau submit: hiển thị danh sách VA (tên ngân hàng, số TK, tên chủ TK, trạng thái active/inactive)
- [ ] Merchant chọn 1 VA mặc định → app lưu `vaAccountNumber`, `accountNumber`, `bankBin`
- [ ] Với VA ngân hàng yêu cầu đăng ký (vd ACB — bankBin `970416`): app tự gọi `register-notify` + `confirm-register-notify`
- [ ] `secret_token` lưu DB ở dạng mã hóa at-rest (không bao giờ log ra)
- [ ] Nếu credentials sai hoặc API lỗi: hiện thông báo lỗi cụ thể, không lưu DB
- [ ] Merchant có thể cập nhật cấu hình (overwrite, không duplicate)

---

### F2 — Hiển thị QR tại checkout

Khách chọn phương thức thanh toán Tingee, thấy mã QR kèm thông tin chuyển khoản.

**Acceptance criteria:**
- [ ] Phương thức "Chuyển khoản / QR Tingee" xuất hiện tại checkout của store
- [ ] Sau khi chọn: trang hiển thị ảnh QR (base64 từ `generate-viet-qr`), tên NH, số TK, tên chủ TK, số tiền, mã đối soát
- [ ] Mỗi đơn có 1 mã đối soát duy nhất format `TG` + 7 ký tự random (A-Z0-9); không tái sử dụng
- [ ] Banner cảnh báo nổi bật: **"Không thay đổi nội dung chuyển khoản — một số ứng dụng ngân hàng cho phép sửa, nhưng thay đổi sẽ khiến đơn hàng không được xác nhận tự động"**
- [ ] Trang polling trạng thái mỗi 5 giây; khi đơn `paid` → tự redirect về trang xác nhận đơn
- [ ] Hiển thị đếm ngược 15 phút; sau timeout: thông báo liên hệ merchant, đơn vẫn `pending`

---

### F3 — Nhận webhook và tự động xác nhận đơn

Khi Tingee báo tiền về VA, app xác thực, đối soát và đánh dấu đơn Shopify là "đã thanh toán".

**Acceptance criteria:**
- [ ] Endpoint `POST /webhooks/tingee/ipn` nhận IPN từ Tingee
- [ ] Verify `x-signature`: `HMAC_SHA512(x-request-timestamp + ":" + rawBody, secretToken)`; sai → bỏ qua (vẫn trả HTTP 200)
- [ ] Idempotency: nếu `transactionCode` đã xử lý → bỏ qua, trả `{ "code": "00" }`
- [ ] Trích mã đối soát từ `content` bằng regex `TG[A-Z0-9]{5,10}`; không tìm thấy → lưu unmatched
- [ ] So sánh `amount` IPN với `amount` đơn: khớp → `payments.status = paid`; lệch → `status = mismatch`
- [ ] Khi `paid`: gọi Shopify Admin API `POST /orders/{id}/transactions.json` với `kind=capture, status=success`
- [ ] Luôn phản hồi Tingee `{ "code": "00", "message": "Success" }` (kể cả khi lỗi nội bộ)
- [ ] Mọi IPN đều được lưu vào bảng `webhook_events` (payload + headers)

---


## 5. Features Out of Scope (MVP)

| Tính năng | Lý do loại |
|---|---|
| QR động (`generate-dynamic-qr`) | Tingee chưa hỗ trợ đủ ngân hàng |
| Shopify Payments Extension (cổng thanh toán gốc) | Cần Shopify Payments Partner approval riêng |
| Chọn nhiều VA / đa tài khoản | Tăng độ phức tạp; 1 VA đủ cho MVP |
| Hoàn tiền tự động | Cần thêm logic nghiệp vụ + Tingee refund API |
| Màn quản lý giao dịch / gán thủ công | QR tĩnh đã có sẵn số tiền + nội dung; cảnh báo không sửa nội dung đủ cho MVP |
| Export CSV / báo cáo doanh thu | Không phải luồng cốt lõi |
| Đa ngôn ngữ | Tiếng Việt đủ cho thị trường mục tiêu |
| Email thông báo tự động | Shopify đã gửi email xác nhận đơn |
| Cron fallback đối soát định kỳ | Nice-to-have; merchant có thể gán tay |

---

## 6. Non-Functional Requirements

| Yêu cầu | Ngưỡng |
|---|---|
| Webhook IPN phản hồi | < 3 giây |
| Trang QR load | < 2 giây |
| `secret_token` | Mã hóa at-rest, không bao giờ log |
| GDPR webhooks | Đăng ký đủ 3 webhook bắt buộc Shopify |
| Idempotency IPN | Không xử lý cùng `transactionCode` 2 lần |
