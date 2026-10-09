# Licensing key management

The iPresenterPlux subscription system uses two separate credential families. Edge pairing credentials identify a paired church device. Subscription activation credentials prove commercial entitlement. They must never replace or reuse each other.

## Server signing material

The Control Plane signs entitlement leases with Ed25519. Production requires these server-only environment values:

- `IPRESENTERPLUX_ENTITLEMENT_SIGNING_KEY_ID` — stable identifier for the active signing key.
- `IPRESENTERPLUX_ENTITLEMENT_PRIVATE_KEY_PEM` — Ed25519 private key in PEM form. This value is a server secret and must never be committed, copied into browser-visible configuration, embedded in desktop packages, or written to logs.

Provision the private key through the production secret store/environment used by the Control Plane. The repository and deployment artifacts contain only the environment-variable name, never private key material.

## Desktop verification keys

Windows and macOS Edge packages verify leases with public Ed25519 keys only. The desktop reads `IPRESENTERPLUX_ENTITLEMENT_PUBLIC_KEYS_JSON`, a JSON object mapping signing key IDs to base64-encoded 32-byte Ed25519 public keys.

Public verification keys are not secrets. A release may contain the current public key and one or more previous public keys during rotation so already-issued offline leases remain verifiable until their grace period ends.

## Rotation procedure

1. Generate a new Ed25519 key pair outside the repository and production web root.
2. Add the new public key to the desktop verification catalog while retaining the previous public key.
3. Release Windows/macOS packages containing the expanded public-key catalog.
4. Configure the Control Plane with the new `IPRESENTERPLUX_ENTITLEMENT_SIGNING_KEY_ID` and matching `IPRESENTERPLUX_ENTITLEMENT_PRIVATE_KEY_PEM`.
5. Confirm fresh activations/renewals are signed with the new key ID and accepted by current desktop packages.
6. Keep the old public key available for at least the maximum offline-grace lifetime of leases signed by the old key.
7. Remove the retired public key only after no valid offline lease can still reference it.

Never rotate by placing the private key in source control, `.env` files committed to Git, browser `NEXT_PUBLIC_*` variables, CI artifacts, desktop settings, or downloadable packages.

## Product keys and activation tokens

Full product keys are bootstrap credentials. They are displayed only on issue/reset and the server stores only prefix, salt and scrypt hash. They must never be written to logs or desktop settings.

Activation tokens are per-installation long-lived credentials. The server stores only salted hashes. The desktop stores the token together with its signed entitlement cache only in Windows Credential Manager or macOS Keychain through `DesktopEntitlementStore`; `DesktopSettings` remains non-secret configuration only.

## Release gates

Control CI runs the licensing release-security self-test before the production build. Edge CI scans the completed Windows and macOS package directories before upload. The gates reject embedded private signing material, full product-key values, and secret-bearing packaged `settings.json` fields.
