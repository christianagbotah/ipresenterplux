#!/usr/bin/env python3
import base64
import json
import re
import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit("usage: licensing-package-scan.py <package-directory>")

root = Path(sys.argv[1]).resolve()
if not root.is_dir():
    raise SystemExit(f"package directory not found: {root}")

private_pem = re.compile(rb"-----BEGIN (?P<label>(?:[A-Z0-9]+ )?PRIVATE KEY)-----[\r\n]+[A-Za-z0-9+/=\r\n]{40,}-----END (?P=label)-----")
private_env = b"IPRESENTERPLUX_ENTITLEMENT_PRIVATE_KEY_PEM"
product_key = re.compile(rb"IPLX-(?:[A-HJ-NP-Z2-9]{4}-){4}[A-HJ-NP-Z2-9]{4}")
placeholder = b"IPLX-XXXX-XXXX-XXXX-XXXX-XXXX"
scanned = 0

catalog_file = root / "entitlement-public-keys.json"
if not catalog_file.is_file():
    raise SystemExit("entitlement verification public-key catalog is missing from package")
try:
    catalog = json.loads(catalog_file.read_text(encoding="utf-8"))
except Exception as error:
    raise SystemExit(f"unable to parse entitlement public-key catalog: {error}")
if not isinstance(catalog, dict) or not catalog:
    raise SystemExit("entitlement verification public-key catalog must contain at least one key")
for key_id, encoded in catalog.items():
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception as error:
        raise SystemExit(f"invalid entitlement public key '{key_id}': {error}")
    if not isinstance(key_id, str) or not key_id or len(key_id) > 80 or len(raw) != 32:
        raise SystemExit(f"invalid entitlement public key entry: {key_id}")

for file in root.rglob("*"):
    if not file.is_file():
        continue
    scanned += 1
    data = file.read_bytes()
    if private_pem.search(data):
        raise SystemExit(f"private signing key material found in package: {file.relative_to(root)}")
    if private_env in data:
        raise SystemExit(f"server-only signing-key environment name found in package: {file.relative_to(root)}")
    for match in product_key.findall(data):
        if match != placeholder:
            raise SystemExit(f"full product-key value found in package: {file.relative_to(root)}")

    if file.name.lower() == "settings.json":
        try:
            parsed = json.loads(data.decode("utf-8"))
        except Exception as error:
            raise SystemExit(f"unable to validate packaged settings.json: {file.relative_to(root)}: {error}")
        lowered = json.dumps(parsed, sort_keys=True).lower()
        for forbidden in ("activationtoken", "productkey", "entitlementenvelope", "privatekey"):
            if forbidden in lowered:
                raise SystemExit(f"secret-bearing field '{forbidden}' found in packaged settings.json")

print(json.dumps({
    "ok": True,
    "package": str(root),
    "filesScanned": scanned,
    "privateSigningMaterialEmbedded": False,
    "fullProductKeysEmbedded": False,
    "settingsSecretsEmbedded": False,
}))
