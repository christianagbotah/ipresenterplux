# Online Subscription and Product-Key Activation Design

Date: 2026-10-07
Status: Proposed for implementation review
Parent: `2026-10-07-product-readiness-program-design.md`

## Purpose

Make iPresenterPlux a subscription product that can be activated online with a product key while remaining operational during temporary Internet outages.

## Design principles

- Product keys are server-issued random secrets, not locally derivable serial numbers.
- The server is authoritative for subscription status, plan, expiry, seats/devices and revocation.
- Desktop clients receive a signed entitlement lease after successful activation/renewal.
- The entitlement is cached securely on the local machine so a church service is not disabled by a short Internet outage.
- Expiry or revocation disables premium operation gracefully; it never deletes church data.
- No master key, entitlement signing private key or recoverable product-key algorithm ships inside the desktop app.

## Data model

Add organization-scoped commercial records without duplicating existing organization/device identities.

### `subscription_plans`

Fields include stable plan code/name, enabled state, billing interval metadata, default device-seat limit, feature entitlement JSON, optional numeric limits and timestamps.

### `organization_subscriptions`

Fields include organization, plan, status (`trial`, `active`, `past_due`, `suspended`, `expired`, `cancelled`), starts/renews/expires timestamps, grace timestamp, provider-neutral billing references and timestamps.

### `product_keys`

Store only a normalized key identifier/prefix plus a cryptographic hash of the full key. Fields include subscription/organization linkage, status, activation limit, activation timestamps, audit actor and optional note/batch reference. The full key is shown only at issuance/reset and is never recoverable from the database.

### `product_activations`

Bind an activation to the existing `edge_devices` record after secure device pairing succeeds. Fields include organization/subscription/product-key IDs, nullable Edge device ID, installation identifier, platform/app version, validation/deactivation timestamps, state/reason and last entitlement ID.

### `entitlement_leases`

Record signed leases for audit/revocation: organization/subscription/activation, entitlement ID/key ID, issued-at, online-valid-until, offline-grace-until, feature/limit snapshot and revocation fields.

## Product key format

Use a human-enterable grouped format such as `IPLX-XXXX-XXXX-XXXX-XXXX-XXXX` backed by cryptographically secure randomness. Normalization removes spaces/hyphens and uppercases before verification. Product keys are bootstrap credentials only; they do not become long-lived bearer credentials.

## Activation flow

1. User enters Control Plane URL and product key.
2. Desktop creates/loads a stable installation identity and sends activation request over HTTPS.
3. Server validates the product key, subscription, plan and remaining device seats.
4. Server creates/refreshes a commercial activation record against the installation identity; this does **not** create device credentials or replace Edge pairing.
5. Server returns a signed entitlement lease plus the normal device-pairing next step.
6. Desktop stores the entitlement in Windows Credential Manager/macOS Keychain through the existing protected credential abstraction; non-secret metadata only goes in settings.
7. Desktop completes the existing secure church/device pairing flow. After pairing, the activation record links to the resulting `edge_devices` identity and Operator opens.

Same-installation reactivation must be idempotent.

## Entitlement format and signing

Use asymmetric signatures. The server signs a canonical payload; desktop clients ship only public verification keys. Payload includes entitlement ID, organization/subscription/plan, activation/device identity, issued-at, online-valid-until, offline-grace-until, feature flags/limits, schema version and signing key ID.

Ed25519 is preferred subject to supported Node/.NET libraries already available in CI. Private signing keys live only in server secret storage; public keys may ship in clients and rotate through key IDs.

## Renewal and offline grace

Initial policy: successful online validation issues normal online validity plus a 7-day signed offline grace period. Clients renew early while online. If the server is unreachable, operation may continue only until signed `offline_grace_until`. Clock rollback/tampering must not extend grace. After grace expires, premium/live operations remain locked until online validation succeeds.

## Expiry and degradation behavior

When entitlement is invalid, church/service/media content remains readable/exportable, activation/settings remain reachable, no new live Program/stream/AI premium operations start, and the product explains expired/suspended/seat-limit/validation state. An already active service is not killed by a transient validation race; entitlement is checked before controlled operations begin.

## Feature gating

Centralize entitlement checks rather than scattering plan-name comparisons. Example features: `core.presentation`, `scripture.local`, `streaming.web`, `streaming.social`, `translations.text`, `translations.audio`, `voice.clone`, `recording.local`, `archive.cloud`, `ai.director`.

RBAC and entitlement remain separate: role answers whether the user may act; entitlement answers whether the organization licensed the capability. Both must pass.

## Admin/backoffice

Provide protected commercial administration for Lightworld admins to manage plans, subscriptions/trials, product keys, suspension/extension, device-seat limits, activations/deactivations and audit history. Church admins see only their own plan/status/devices and permitted self-service deactivation.

## Billing integration

Keep activation payment-provider-neutral. Future Hubtel/Stripe/other webhooks update `organization_subscriptions`. Billing-provider outages do not invalidate already signed leases before their signed validity/grace windows expire.

## Security

- Product keys are rate-limited, redacted from logs and stored only as cryptographic verification material.
- Entitlements are signed, versioned and product-scoped.
- Device revocation is server-side and reflected on next online validation.
- Desktop never trusts unsigned local entitlement JSON.
- Signing keys and activation secrets never enter Git, browser payloads or release manifests.

## Testing

Cover key generation/normalization/verification, revoked/expired key rejection, seat limits, idempotent same-device reactivation, tenant isolation, entitlement signature/tamper validation, key rotation, offline grace boundaries, RBAC+entitlement gating, secret redaction and activation audit trail. Windows/macOS CI tests entitlement verification and protected-storage behavior with platform-safe test doubles where needed.

## Acceptance criteria

A new church can receive a product key, install iPresenterPlux, activate online, securely pair its production computer, see its plan/status, operate through the signed offline grace period, renew automatically after reconnecting, and be cleanly blocked from unlicensed premium operations after expiry/revocation without losing church content.
