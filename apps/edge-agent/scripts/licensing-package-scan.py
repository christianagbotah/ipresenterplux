#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit("usage: licensing-package-scan.py <package-directory>")

root = Path(sys.argv[1]).resolve()
if not root.is_dir():
    raise SystemExit(f"package directory not found: {root}")

private_pem = b"-----BEGIN PRIVATE KEY-----"
private_env = b"IPRESENTERPLUX_ENTITLEMENT_PRIVATE_KEY_PEM"
product_key = re.compile(rb"IPLX-(?:[A-HJ-NP-Z2-9]{4}-){4}[A-HJ-NP-Z2-9]{4}")
placeholder = b"IPLX-XXXX-XXXX-XXXX-XXXX-XXXX"
scanned = 0

for file in root.rglob("*"):
    if not file.is_file():
        continue
    scanned += 1
    data = file.read_bytes()
    if private_pem in data:
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
