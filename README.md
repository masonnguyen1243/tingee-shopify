# Tingee × Shopify — Payment Integration App

Shopify Public App cho phép merchant nhận thanh toán chuyển khoản/QR qua Tingee và tự động xác nhận đơn hàng.

## Tổng quan

App đóng vai trò middleware giữa Shopify và Tingee Open API:
- Merchant cấu hình tài khoản Tingee (Client ID + Secret Token) và chọn VA nhận tiền
- Khách checkout chọn phương thức "Thanh toán QR" → app sinh mã QR tĩnh (VietQR) + mã đối soát
- Tingee bắn webhook khi tiền về → app verify → cập nhật đơn Shopify "đã thanh toán"

## Stack

- **Shopify CLI** — scaffold, OAuth, session, webhook, tunnel
- **React Router (Node.js)** — template chính thức Shopify
- **Prisma** — SQLite (dev) / PostgreSQL (prod)
- **@tingee/sdk-node** — ký HMAC, gọi Tingee Open API
- **PROD base URL**: `https://open-api.tingee.vn`

## Khởi động nhanh

```bash
# Yêu cầu: Node.js, Shopify CLI, tài khoản Shopify Partner + dev store
shopify app init    # chọn template "Build a React Router app"
cd <app-dir>
shopify app dev     # tự login, tạo tunnel, mở dev store
```

## Tài liệu

- [Thiết kế chi tiết](Tingee-Shopify-Thiet-ke.md)
- [Product Spec](specs/product-spec.md)
- [Implementation Plan](specs/implementation-plan.md)
- [Test Plan](specs/test-plan.md)
- [Change Log](specs/change-log.md)

## Tham khảo

- Tingee Developers: https://developers.tingee.vn
- Shopify Payments Extensions: https://shopify.dev/docs/apps/build/payments
- SePay Shopify integration (tham khảo): https://docs.sepay.vn/tich-hop-shopify.html
