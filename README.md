# PURE — Storefront and operations

## Current checkout status (November 2026)

The production storefront is [getpurelabs.com](https://getpurelabs.com/). Current checkout exposes hosted card checkout in the U.S. and Canada, native USDC on Polygon where eligible, and Interac e-Transfer in CAD for Canadian customers. The public payment and delivery configuration is available at `/api/customer-config?checkout=public`. Paid memberships use prepaid terms.

The legacy Stripe checkout creation route remains closed. Its signed webhook at `/api/stripe-webhook` remains in service for historical Stripe transactions and outstanding reconciliation, refund, dispute and settlement obligations.

Payment activation requires a provider and acquiring-bank approval for the *actual catalog*, plus approved product/destination shipping lanes, signed webhooks, idempotent order handling, and sandbox checkout tests. See [payment provider underwriting](compliance/payment-provider-underwriting-matrix.md) and [commerce integration plan](docs/commerce-eligibility-integration-plan.md).

## What exists in the repository

- Catalog and product strength variants: `products.js`, `product-images.js`
- Currency display and English/French/Spanish controls: `locale.js` (the catalog uses USD base list prices, and checkout quotes the payment currency)
- Customer accounts and Google OAuth: `account.html`, `account.js`
- Admin orders, suppliers, batches, notifications, and inventory tools: `admin-*.html`, `api/admin-*.js`
- Testing library and lot-specific report review: `coas.html`, `data/supplier-coas.json`, `lib/coa-*.js`
- Default-deny shipping and payment decision prototypes: `lib/commerce-eligibility.js`. **Not integrated into live checkout.**
- Country, product, origin, service and underwriting diligence templates under `compliance/`

These components do not establish legal product authorization, customer payment approval, COA authenticity or international shipping eligibility.

## Build and test

```sh
npm install
npm run build
node --test tests/*.test.cjs
```

The `build-test.yml` GitHub Actions workflow additionally runs disposable PostgreSQL tests and a Python exporter integration suite. Do not run fixture scripts against production databases.

## Deployment and security

`vercel.json` has automatic Git deployments disabled. Check the commit currently assigned to `getpurelabs.com` in the Vercel `pure` project before preparing a release. Check the exact candidate commit in CI and in an isolated browser session before assigning production traffic.

See [PURE admin and payments](docs/pure-admin-payments.md) for current operations, [order management](docs/pure-order-management.md) for fulfillment workflows, and the [Stripe retirement handoff](docs/stripe-retirement-handoff.md) for legacy reconciliation.
