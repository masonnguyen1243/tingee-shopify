# CLAUDE.md — Tingee × Shopify App

## What this app does

Shopify Public App connecting Tingee Open API to Shopify. Merchants accept bank transfer / QR payments and orders are confirmed automatically. Think "SePay, but built on Tingee."

## Stack

- **Shopify CLI** — React Router template (Node.js + Prisma). Do not scaffold manually.
- **Prisma** — SQLite for dev, PostgreSQL for prod.
- **`@tingee/sdk-node`** — handles HMAC signing. Do not write HMAC by hand.
- **`shopify.app.toml`** — declares scopes and webhooks. Do not hardcode these in code.

## Rules for every task

1. **Read specs first.** Before writing any code, read `specs/product-spec.md` and `specs/implementation-plan.md`.
2. **One phase at a time.** Implement only the phase or checklist item asked for. Stop and confirm before moving to the next.
3. **Keep it simple.** No extra libraries, no extra abstractions. If three places share logic, only then extract a helper.
4. **Do not change architecture** unless `specs/product-spec.md` or `specs/implementation-plan.md` has been updated first.
5. **After each implementation:** update `specs/change-log.md` and explain how to manually test the change.

## Conventions

- File names: `kebab-case`. Functions and classes: `camelCase`.
- Each service does one thing: `TingeeService` calls Tingee API only. `OrderReconcile` calls Shopify only.
- Never log `secretToken` or `shopify_access_token` anywhere.
- `secret_token` must be encrypted at rest in DB. Decrypt only when signing a request.

## Security rules (non-negotiable)

- Verify `x-signature` on every IPN webhook from Tingee. Invalid → ignore, still return 200.
- Check `transactionCode` idempotency before processing any webhook.
- Never reuse a `reconcile_code` across two orders.
- GDPR webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) must be registered in `shopify.app.toml`.

## MVP boundaries

| Not in MVP | Reason |
|---|---|
| Dynamic QR (`generate-dynamic-qr`) | Tingee doesn't support all banks yet |
| Shopify Payments Extension | Requires Payments Partner approval |
| Refunds | Out of scope |
| Multi-VA management | 1 default VA per merchant is enough |

## Key files

| File | Purpose |
|---|---|
| `specs/product-spec.md` | Features, user flows, acceptance criteria |
| `specs/implementation-plan.md` | Phases and checklist |
| `specs/test-plan.md` | Test scenarios |
| `specs/change-log.md` | What was built and when |
| `Tingee-Shopify-Thiet-ke.md` | Full original design reference |
