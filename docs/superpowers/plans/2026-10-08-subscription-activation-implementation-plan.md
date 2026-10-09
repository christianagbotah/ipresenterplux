# Subscription Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure online product-key activation, signed subscription entitlements, device-seat enforcement, offline grace, and desktop activation UX without replacing the existing Edge pairing identity.

**Architecture:** Add commercial tables alongside organizations/devices, use high-entropy server-issued keys hashed with Node's built-in scrypt, and issue compact Ed25519-signed entitlement envelopes. The desktop shell stores a per-installation activation token and signed lease in the OS credential vault, verifies leases locally, then continues through the existing Edge pairing flow; paired Edge identity is linked to the commercial activation after enrollment.

**Tech Stack:** PostgreSQL, Next.js/TypeScript, Node `crypto` (`randomBytes`, `scrypt`, `timingSafeEqual`, Ed25519), Zod, Avalonia/.NET 10, Windows Credential Manager, macOS Keychain.

**Spec:** `docs/superpowers/specs/2026-10-07-online-subscription-activation-design.md`

## Global Constraints

- Full product keys are shown only at issuance/reset and never stored recoverably.
- Product keys are activation/bootstrap credentials only, not long-lived bearer credentials.
- Server is authoritative for status, plan, expiry, seats and revocation.
- Signed leases use a 7-day initial offline grace period; private signing keys never ship in desktop binaries.
- Activation does not create or replace Edge device credentials; pairing remains the security boundary for Edge identity.
- RBAC and entitlement are independent gates and both must pass for controlled premium actions.
- Expiry/revocation never deletes church/service/media data and must not abruptly kill an already-running service because of a transient validation race.

## Review Focus

- Product-key case/hyphen/space normalization must not weaken entropy or permit malformed lengths; covered in Task 2 tests.
- Same-installation reactivation must be idempotent while a different installation respects seat limits; covered in Task 4 tests.
- A copied/tampered lease or lease signed by an unknown key ID must be rejected offline; covered in Task 3 and Task 6 tests.
- Clock rollback must not extend the signed offline-grace timestamp; covered in Task 6 tests.
- Subscription failure must leave Settings/Activation and read/export paths available while blocking only new gated operations; covered in Task 7 tests.

---

### Task 1: Commercial subscription schema

**Files:**
- Create: `apps/control/db/037_subscription_entitlements.sql`
- Test: `apps/control/scripts/subscription-schema-selftest.mjs`
- Modify: `apps/control/package.json`

**Interfaces:**
- Create tables: `subscription_plans`, `organization_subscriptions`, `product_keys`, `product_activations`, `entitlement_leases`, `product_activation_attempts`.
- `product_activations.edge_device_id` is nullable and later links to existing `edge_devices`; it never stores a replacement device credential.
- `product_keys` stores prefix, salt, hash, status, activation limit and audit metadata only.

- [ ] **Step 1: Write failing schema assertions** for constraints/status enums, organization foreign keys, unique active subscription/activation identities, nullable Edge link, lease revocation fields, and absence of plaintext key columns.
- [ ] **Step 2: Run** `pnpm --dir apps/control test:subscription-schema`; expected FAIL because migration 037 is absent.
- [ ] **Step 3: Implement migration 037** with indexes for organization/status, key prefix, installation identity, active leases, and activation-attempt rate-limit lookups.
- [ ] **Step 4: Run schema self-test on the designated test database** plus `test:db-selftest-safety`; expected PASS.
- [ ] **Step 5: Commit** `feat(licensing): add subscription entitlement schema`.

### Task 2: Product-key generation and verification

**Files:**
- Create: `apps/control/src/lib/licensing/product-keys.ts`
- Test: `apps/control/scripts/product-key-selftest.mjs`

**Interfaces:**
- Produce: `generateProductKey() -> { displayKey, normalized, prefix, salt, hash }`.
- Produce: `normalizeProductKey(input: string) -> string`, `deriveProductKeyHash(normalized: string, salt: Buffer) -> Promise<Buffer>`, `verifyProductKey(input, salt, expectedHash) -> Promise<boolean>`.
- Format: `IPLX-XXXX-XXXX-XXXX-XXXX-XXXX`, using a restricted uppercase base32 alphabet and cryptographically secure randomness.
- Hash parameters: scrypt N=32768, r=8, p=1, output 32 bytes, per-key 16-byte random salt, constant-time comparison.

- [ ] **Step 1: Write failing tests** for format, entropy source mocking, normalization, malformed prefix/group rejection, same-key verification, wrong-key rejection, and timing-safe equal-length compare path.
- [ ] **Step 2: Run** `node apps/control/scripts/product-key-selftest.mjs`; expected FAIL.
- [ ] **Step 3: Implement product-key functions** with no logging of normalized/full key.
- [ ] **Step 4: Run** product-key self-test; expected PASS.
- [ ] **Step 5: Commit** `feat(licensing): add secure product keys`.

### Task 3: Signed entitlement envelope service

**Files:**
- Create: `apps/control/src/lib/licensing/entitlement.ts`
- Create: `apps/control/src/lib/licensing/entitlement-policy.ts`
- Test: `apps/control/scripts/entitlement-signing-selftest.mjs`

**Interfaces:**
- `EntitlementPayload` includes schemaVersion, product, entitlementId, organizationId, subscriptionId, planCode, activationId, installationId, issuedAt, onlineValidUntil, offlineGraceUntil, features, limits, signingKeyId.
- Produce: `signEntitlement(payload) -> string` and `verifyEntitlementEnvelope(envelope, publicKeys) -> EntitlementPayload` for server tests/admin tooling.
- Compact format is `base64url(raw UTF-8 JSON).base64url(Ed25519 signature)`; signature covers the raw payload bytes.
- Produce `hasEntitlementFeature(payload, featureId)` and numeric-limit lookup helpers; never compare plan names in feature code.

- [ ] **Step 1: Write failing tests** for signature success, payload tampering, signature tampering, wrong product/audience, unknown signing key ID, key rotation, feature/limit lookup, and exact 7-day offline-grace issuance policy.
- [ ] **Step 2: Run** entitlement signing self-test; expected FAIL.
- [ ] **Step 3: Implement signing/verification** using PEM keys from server-only environment configuration and public-key map by key ID.
- [ ] **Step 4: Implement centralized entitlement policy helpers** using feature IDs from the spec.
- [ ] **Step 5: Run** signing tests; expected PASS.
- [ ] **Step 6: Commit** `feat(licensing): sign subscription entitlements`.

### Task 4: Activation and renewal APIs

**Files:**
- Create: `apps/control/src/lib/licensing/activation-service.ts`
- Create: `apps/control/src/app/api/v1/licensing/activate/route.ts`
- Create: `apps/control/src/app/api/v1/licensing/renew/route.ts`
- Create: `apps/control/src/app/api/v1/licensing/link-device/route.ts`
- Test: `apps/control/scripts/activation-api-selftest.mjs`

**Interfaces:**
- Activate request: `{ productKey, installationId, platform, appVersion, deviceName }`.
- Activate response: `{ activationId, activationToken, entitlement, organization: { id, name }, pairingRequired: true }`; activation token is random per installation and stored only hashed server-side after issuance.
- Renew request: `{ activationId, installationId, activationToken, currentEntitlementId }`; returns fresh signed entitlement when subscription/activation remain valid.
- `link-device` uses existing authenticated Edge/device identity to associate `product_activations.edge_device_id` after pairing.

- [ ] **Step 1: Write failing API/service tests** for valid activation, invalid/revoked/expired key, suspended subscription, seat limit, same-installation idempotency, cross-org isolation, rate limit, renewal, deactivated device, and activation audit rows.
- [ ] **Step 2: Run** activation API self-test against test DB; expected FAIL.
- [ ] **Step 3: Implement `activation-service.ts`** with row locks around key/subscription/seat checks and token hash storage; redact keys/tokens from all errors/logs.
- [ ] **Step 4: Implement activate/renew routes** over HTTPS-only production assumptions with no-store responses and generic invalid-key errors.
- [ ] **Step 5: Implement paired-device linking endpoint** using existing Edge authentication; reject organization mismatch.
- [ ] **Step 6: Run** activation API tests + DB safety guard; expected PASS.
- [ ] **Step 7: Commit** `feat(licensing): add activation and renewal APIs`.

### Task 5: Commercial admin and church subscription status surfaces

**Files:**
- Create: `apps/control/src/app/settings/subscription/page.tsx`
- Create: `apps/control/src/components/licensing/SubscriptionStatus.tsx`
- Create: `apps/control/src/app/admin/licensing/page.tsx`
- Create: `apps/control/src/components/licensing/LicensingAdmin.tsx`
- Create: `apps/control/src/app/api/v1/admin/licensing/keys/route.ts`
- Create: `apps/control/src/app/api/v1/admin/licensing/subscriptions/route.ts`
- Test: `apps/control/scripts/licensing-admin-selftest.mjs`

**Interfaces:**
- Church settings expose own plan/status/expiry/grace/seat usage and allowed device deactivation only.
- Lightworld product-admin routes issue/revoke/reset keys, create/extend/suspend subscriptions, configure plans/features/seats, and show activation/lease audit history.
- Full product key is returned/displayed exactly once when issued/reset.

- [ ] **Step 1: Write failing tests** for admin authorization, one-time plaintext key display, church tenant isolation, seat counts, revoke/deactivate actions, and audit visibility.
- [ ] **Step 2: Run** licensing admin self-test; expected FAIL.
- [ ] **Step 3: Implement server-side admin APIs** with explicit product-admin authorization and audit events.
- [ ] **Step 4: Implement church subscription settings and Lightworld licensing admin pages** with no secrets in HTML after one-time issue response.
- [ ] **Step 5: Run** admin tests + lint/build; expected PASS.
- [ ] **Step 6: Commit** `feat(licensing): add subscription administration`.

### Task 6: Cross-platform desktop entitlement client and secure cache

**Files:**
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Contracts/EntitlementContracts.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Abstractions/IEntitlementStore.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Core/Security/EntitlementVerifier.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/EntitlementClient.cs`
- Create: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/DesktopEntitlementStore.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Core.Tests/EntitlementVerifierTests.cs`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/DesktopEntitlementStoreTests.cs`

**Interfaces:**
- `EntitlementVerifier.Verify(string envelope, IReadOnlyDictionary<string, byte[]> publicKeys, DateTimeOffset now, DateTimeOffset? lastTrustedNow) -> EntitlementValidation`.
- `IEntitlementStore` saves/reads `DesktopEntitlementCache { ActivationId, InstallationId, ActivationToken, Envelope, LastTrustedNow }` using OS-protected storage; test doubles may use memory/temp storage only in tests.
- `EntitlementClient.ActivateAsync`, `RenewAsync` mirror Task 4 contracts and never persist/log product key.

- [ ] **Step 1: Write failing .NET tests** for valid/tampered/unknown-key leases, offline grace before/after deadline, non-decreasing trusted clock, secure cache round-trip, and cache corruption refusal.
- [ ] **Step 2: Run** targeted Core/Desktop tests; expected FAIL.
- [ ] **Step 3: Implement contracts and Ed25519 envelope verification** using only shipped public verification keys.
- [ ] **Step 4: Implement desktop entitlement client and OS credential-vault-backed cache** with platform-safe test doubles for CI.
- [ ] **Step 5: Run** targeted .NET tests on Windows/macOS CI-compatible paths; expected PASS.
- [ ] **Step 6: Commit** `feat(edge): verify and cache signed entitlements`.

### Task 7: First-launch activation UX and operation gates

**Files:**
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/MainWindow.cs`
- Modify: `apps/edge-agent/src/iPresenterPlux.Edge.Desktop/DesktopSettings.cs`
- Create: `apps/control/src/lib/licensing/entitlement-access.ts`
- Modify: `apps/control/src/app/api/v1/services/[id]/stream/route.ts`
- Modify: `apps/control/src/app/api/v1/outputs/[id]/state/route.ts`
- Modify: `apps/control/src/lib/translation-jobs.ts`
- Modify: `apps/control/src/lib/speech-synthesis-jobs.ts`
- Test: `apps/edge-agent/tests/iPresenterPlux.Edge.Desktop.Tests/MainWindowActivationTests.cs`
- Test: `apps/control/scripts/entitlement-gating-selftest.mjs`

**Interfaces:**
- Startup sequence: valid cached entitlement -> Operator; missing/invalid entitlement -> Activation tab; successful activation -> existing Setup/Pairing -> Operator.
- Web helper: `requireEntitlementFeature(organizationId, featureId, options?)` returns effective entitlement or throws a typed 403 condition; server routes remain tenant scoped separately.
- `POST /services/[id]/stream` requires `streaming.web` when Web audience is eligible and `streaming.social` when any social destination is eligible; `PATCH /outputs/[id]/state` requires the matching feature before enabling a destination.
- New translation job creation requires `translations.text`; new speech-synthesis job creation requires `translations.audio`. Read-only job/history access remains available after expiry.

- [ ] **Step 1: Write failing UI/gating tests** for first launch, successful activation then pairing, expired/grace banners, settings always reachable, read-only content preserved, and premium start-operation denial after grace expiry.
- [ ] **Step 2: Run** targeted Desktop + control entitlement tests; expected FAIL.
- [ ] **Step 3: Add Activation UI** for Control Plane URL + product key, subscription status/expiry/last validation/device identity, retry and deactivate guidance.
- [ ] **Step 4: Gate desktop start/live actions by verified lease state** without terminating an already-running service solely on transient validation failure.
- [ ] **Step 5: Implement server entitlement-access helper and apply it to new premium-operation starts** while preserving RBAC as a separate check.
- [ ] **Step 6: Run** Desktop/Core tests + control lint/build; expected PASS.
- [ ] **Step 7: Commit** `feat(product): enforce subscription activation`.

### Task 8: CI, key-material and release-security gates

**Files:**
- Modify: `.github/workflows/control-ci.yml`
- Modify relevant Windows/macOS Edge workflows
- Verify deployment docs/secrets contract without committing private keys

- [ ] **Step 1: Add licensing tests to Control and Edge CI** including Windows/macOS entitlement verification/storage tests.
- [ ] **Step 2: Add secret scan assertions** proving signing private key/product keys/activation tokens are absent from repository, browser payloads and packaged desktop settings.
- [ ] **Step 3: Run full relevant CI suites**; expected PASS with test signing keys generated only in test process.
- [ ] **Step 4: Commit** `ci(licensing): gate activation and entitlement security`.
