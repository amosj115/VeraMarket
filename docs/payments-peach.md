# Payments (Peach Payments) — Vera Market

Peach Payments handles Vera Market's **own** paid features only: listing boosts (one-time) and the Virtual Store monthly subscription (recurring). Ordinary buyer-to-seller purchases never go through it. Vera Pro still uses the legacy Paystack code and is untouched.

**Status: built and tested against stubs only. Nothing has been run against the real Peach sandbox yet, and no live mode is enabled.**

## Architecture

```
routes / UI  ->  src/lib/payments/service.ts   (provider-neutral business rules)
                        |
                 src/lib/payments/provider.ts  (PaymentProvider interface)
                        |
                 src/lib/payments/registry.ts  (PAYMENT_PROVIDER switch)
                        |
                 src/lib/payments/peach/       (ALL Peach-specific code)
```

- **Boosts:** `POST /api/boosts` stores a PENDING `Payment` + `Boost` using server-side prices, then creates a hosted Peach checkout (one-time, no tokenisation). The boost activates only when `applyVerifiedPayment` receives a SUCCEEDED result that came from Peach's server-to-server status API. Expiry is computed on the server. Nothing ever renews a boost.
- **Virtual Store:** `POST /api/shops/[id]/subscription` (`subscribe` / `cancel`). The initial checkout asks Peach to tokenise the card (`createRegistration` + standing instruction). Peach has no managed subscription product: Vera's own daily cron (`/api/payments/renewals`) charges the stored token (merchant-initiated transaction) 24h before expiry, with up to 3 attempts (retry +2d, +4d). Cancellation clears `autoRenew` first (so Vera never charges again), then deletes the Peach token. Access stays until the paid period ends.
- **Verification:** the webhook signature only authenticates the sender; the payload is never trusted. Vera takes the checkout id and re-queries Peach, then checks amount, currency, checkout id and reference against the stored payment. The browser return URL (`/api/payments/return`) also only triggers that same server-side lookup.
- **Idempotency:** `PaymentWebhookEvent (provider, eventId)` is unique and written in the same DB transaction as the state change; payment status changes are compare-and-set; renewals are claimed by compare-and-set on `renewsAt`.

## Peach-specific items (what to touch to replace the provider)

| Kind | Item |
|---|---|
| Code | `src/lib/payments/peach/index.ts` |
| Route | `src/app/api/payments/peach/webhook/route.ts` |
| Registry entry | `src/lib/payments/registry.ts` |
| Env vars | `PEACH_ENV`, `PEACH_ALLOW_LIVE`, `PEACH_CLIENT_ID`, `PEACH_CLIENT_SECRET`, `PEACH_MERCHANT_ID`, `PEACH_ENTITY_ID`, `PEACH_WEBHOOK_SECRET`, `PEACH_RECURRING_ENTITY_ID`, `PEACH_RECURRING_ACCESS_TOKEN`, `PEACH_CARD_API_URL` |
| DB fields (generic names, only values are Peach's) | `Payment.provider`, `providerRef`, `providerCheckoutId`, `providerPaymentId`; `ShopSubscription.provider`, `providerToken`, `providerInitialTxId` |
| Tests | `tests/unit/payments-peach.test.ts` |

Provider-neutral (keep when swapping): `provider.ts`, `service.ts`, `/api/payments/return`, `/api/payments/renewals`, `/payments/status`, `/admin/payments`, the boost and subscription routes, and the schema.

To switch to Payfast or another provider: implement `PaymentProvider`, register it in `registry.ts`, add its webhook route at `/api/payments/<id>/webhook` (it calls `applyVerifiedPayment`), set `PAYMENT_PROVIDER`. Nothing in boost or subscription logic changes. Do not delete Peach code just because configuration is missing; unconfigured providers return 503 and take no payment.

## Environment variables (names only; never commit values)

Get them from the Peach Dashboard (use sandbox first): API credentials (client ID / secret / merchant ID), the entity ID of your Checkout channel, the webhook signing secret, and — for Virtual Store — the *Recurring payments* entity ID and access token.

`PEACH_ENV` defaults to `sandbox`. Live mode is refused unless `PEACH_ALLOW_LIVE=true` is set explicitly.

## Peach account steps still required

1. Confirm the account can use **Checkout V2** (`/v2/checkout`), which Peach's docs currently label "recommended". Peach's separate *Orchestration* product has not been checked against this adapter.
2. Enable **recurring payments / card tokenisation** (separate Dashboard credentials; may need Peach support to activate). Without it, Virtual Store subscribe returns 503 and boosts still work.
3. Allowlist the app domain for hosted checkout (the `Referer` header must be allowlisted).
4. In the Dashboard, create a webhook pointing to `https://<app-domain>/api/payments/peach/webhook`, enable **webhook signing**, and copy the secret to `PEACH_WEBHOOK_SECRET`. The URL must match exactly because it is part of the signed string.
5. Set `CRON_SECRET` (already used by the other cron routes) so `/api/payments/renewals` (daily 03:00, `vercel.json`) can run.

## Known uncertainties (verify in the sandbox)

- Whether the checkout status response includes the token (`registrationId`). Peach's tokenisation page says V2 status returns it, but the status API schema does not list the field (the signed webhook body sample does). The adapter reads it, accepts only a well-formed id (16-64 chars `A-Za-z0-9_-`) and, if it is absent or malformed, activates the subscription for one period **without** auto-renew (it never guesses a token, and the UI shows "Cancelled/ends" rather than "renews").
- Merchant-initiated charges send no initial-transaction id: Peach's documented request (`POST /v1/registrations/{id}/payments` with `standingInstruction.mode=REPEATED`, `.source=MIT`, `.type=RECURRING`) has no such parameter; `initialTransactionId` only appears in responses (where it equals `cardholderInitiatedTransactionId`). `providerInitialTxId` is stored for reference only.
- The `signature` field on status and redirect responses is **not verified**: Peach documents no algorithm for it. Integrity relies on the TLS-authenticated, Bearer-authorised status call made from our server.
- Subscribing requires an explicit `autoRenewConsent: true` (checkbox in the UI) because Peach requires customer permission before tokenising.
- Peach documents no status lookup for merchant-initiated charges. If a renewal charge request errors, the payment stays PENDING and is not re-charged for 24h, then marked failed (`unconfirmed_renewal`) for admin review in `/admin/payments`.
- Refunds are made in the Peach Dashboard; Vera does not yet sync refunds automatically (a `REFUNDED` status exists for manual recording).
- The amount is sent as a JSON number in rands per the docs' examples.

## Database

Migration `prisma/migrations/20261022170000_add_provider_payments` is additive only. Apply it with `npx prisma migrate deploy` (or `migrate dev` locally). It has not been applied to any production database.

## Tests

- `node --import tsx --loader ./tests/loader.mjs --test tests/unit/payments-peach.test.ts`
- `node --import tsx --loader ./tests/loader.mjs --test tests/integration/payments.db.test.ts` (needs `TEST_DATABASE_URL` pointing at a migrated `*_test` database; it refuses to run otherwise)
- `node --experimental-test-module-mocks --import tsx --loader ./tests/loader.mjs --test tests/integration/payment-routes.db.test.ts` (route-level auth, ownership and pricing; stubs `auth()` and Peach HTTP; same database requirement)

## Sandbox walkthrough

1. Put sandbox credentials in `.env.local` (`PEACH_ENV=sandbox`), run `npx prisma migrate deploy`, start the app. Use a public HTTPS tunnel and register it as the webhook + allowlisted domain.
2. **Boost:** `/profile/boosts` -> pick a listing and package -> pay with a Peach sandbox test card -> you land on `/payments/status?ref=...`; it shows *pending* until the webhook / return lookup verifies the payment, then *confirmed* with the expiry. Check `/admin/payments`.
3. **Virtual Store:** `/profile/shops` -> Subscribe -> pay with a sandbox card (consents to recurring) -> store becomes active with the next billing date. Test renewal by setting `renewsAt` of the subscription to the past and calling `GET /api/payments/renewals` with `Authorization: Bearer $CRON_SECRET`. Test *Cancel subscription* and confirm no further charge and access until the period end.
