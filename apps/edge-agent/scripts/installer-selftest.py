#!/usr/bin/env python3
import argparse
import json
import re
import sys
import zipfile
from pathlib import Path


def require(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def read_required(path: Path, errors: list[str]) -> str:
    if not path.is_file():
        errors.append(f"missing required file: {path}")
        return ""
    return path.read_text(encoding="utf-8")


def source_checks(edge_root: Path, errors: list[str]) -> None:
    repo_root = edge_root.parents[1]
    iss = edge_root / "installer" / "windows" / "iPresenterPlux.iss"
    package_script = edge_root / "scripts" / "package-update.ps1"
    workflow = repo_root / ".github" / "workflows" / "edge-agent-ci.yml"
    iss_text = read_required(iss, errors)
    package_text = read_required(package_script, errors)
    workflow_text = read_required(workflow, errors)

    if iss_text:
        normalized = iss_text.replace("/", "\\")
        require("OutputBaseFilename=iPresenterPlux-Setup" in iss_text,
                "installer must output iPresenterPlux-Setup.exe", errors)
        require("DefaultDirName={localappdata}\\Programs\\Lightworld Technologies\\iPresenterPlux" in normalized,
                "installer must use the per-user Lightworld iPresenterPlux root", errors)
        require("PrivilegesRequired=lowest" in iss_text,
                "installer must be per-user and not require elevation", errors)
        require(re.search(r'DestDir:\s*"\{app\}\\current"', normalized, re.I) is not None,
                "installer must stage the app payload under {app}\\current", errors)
        require(re.search(r'DestDir:\s*"\{app\}"', normalized, re.I) is not None and "Lightworld.Update.Helper" in iss_text,
                "installer must place Lightworld.Update.Helper at the install root", errors)
        require("{app}\\current\\iPresenterPlux.Edge.Desktop.exe" in normalized,
                "Start Menu/app launch target must point at current\\iPresenterPlux.Edge.Desktop.exe", errors)
        require("{localappdata}\\iPresenterPlux" not in normalized,
                "uninstall script must not target user settings/enrollment under LocalAppData\\iPresenterPlux", errors)

    if package_text:
        for token, message in [
            ("Compress-Archive", "package script must create the full update ZIP"),
            ("Get-FileHash", "package script must calculate SHA-256"),
            ("manifest-template.json", "package script must emit manifest template metadata"),
            ("windows-release", "package script must build the installer release layout"),
            ("current", "package script must stage a current directory"),
            ("Lightworld.Update.Helper", "package script must stage the helper outside current"),
        ]:
            require(token in package_text, message, errors)

    if workflow_text:
        require("name: ipresenterplux-windows-installer" in workflow_text,
                "Windows CI must expose a separate installer-only artifact for low-bandwidth UAT", errors)
        require("iPresenterPlux-Setup.exe.sha256" in workflow_text,
                "installer-only artifact must include an independent SHA-256 sidecar", errors)
        require(re.search(r'path:\s*\|\s*\n\s*apps/edge-agent/publish/windows-release/iPresenterPlux-Setup\.exe\s*\n\s*apps/edge-agent/publish/windows-release/iPresenterPlux-Setup\.exe\.sha256', workflow_text) is not None,
                "installer-only artifact must contain only Setup.exe and its checksum", errors)

    combined = f"{iss_text}\n{package_text}\n{workflow_text}".lower()
    for forbidden in ["begin private key", "update_hub_admin_token=", "update_hub_signing_private", "productkey=", "bearer "]:
        require(forbidden not in combined, f"packaging source contains forbidden secret material marker: {forbidden}", errors)


def artifact_checks(release_dir: Path, version: str, errors: list[str]) -> None:
    current = release_dir / "current"
    helper = release_dir / "Lightworld.Update.Helper.exe"
    installer = release_dir / "iPresenterPlux-Setup.exe"
    package = release_dir / f"iPresenterPlux-{version}-windows-x64.zip"
    sha_file = release_dir / f"iPresenterPlux-{version}-windows-x64.zip.sha256"
    manifest = release_dir / "manifest-template.json"

    require((current / "iPresenterPlux.Edge.Desktop.exe").is_file(), "release current/ desktop executable is missing", errors)
    require(helper.is_file(), "release root updater helper is missing", errors)
    require(installer.is_file(), "iPresenterPlux-Setup.exe is missing", errors)
    require(package.is_file(), "full update ZIP is missing", errors)
    require(sha_file.is_file(), "SHA-256 sidecar is missing", errors)
    require(manifest.is_file(), "manifest template metadata is missing", errors)

    if package.is_file():
        with zipfile.ZipFile(package) as archive:
            names = {name.replace("\\", "/") for name in archive.namelist()}
            require("iPresenterPlux.Edge.Desktop.exe" in names,
                    "update ZIP must contain the desktop executable at package root", errors)
            require(any(name.startswith("runtime/") for name in names),
                    "update ZIP must contain the bundled runtime directory", errors)
            require(not any(name.startswith("current/") for name in names),
                    "update ZIP must be the candidate payload itself, not a nested current directory", errors)
            require(not any(name.endswith("Lightworld.Update.Helper.exe") for name in names),
                    "update ZIP must not replace the root update helper", errors)

    if manifest.is_file():
        try:
            data = json.loads(manifest.read_text(encoding="utf-8-sig"))
        except Exception as exc:
            errors.append(f"manifest template is invalid JSON: {exc}")
        else:
            require(data.get("product") == "ipresenterplux", "manifest product must be ipresenterplux", errors)
            require(data.get("version") == version, "manifest version does not match package version", errors)
            require(data.get("platform") == "windows", "manifest platform must be windows", errors)
            require(data.get("architecture") == "x64", "manifest architecture must be x64", errors)
            full = data.get("fullPackage") or {}
            require(full.get("sha256"), "manifest full package SHA-256 is missing", errors)
            require(full.get("size", 0) > 0, "manifest full package size is missing", errors)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--release-dir", type=Path)
    parser.add_argument("--version")
    args = parser.parse_args()
    edge_root = Path(__file__).resolve().parents[1]
    errors: list[str] = []
    source_checks(edge_root, errors)
    if args.release_dir:
        require(bool(args.version), "--version is required with --release-dir", errors)
        if args.version:
            artifact_checks(args.release_dir.resolve(), args.version, errors)
    if errors:
        print("installer selftest: FAIL", file=sys.stderr)
        for error in errors:
            print(f" - {error}", file=sys.stderr)
        return 1
    print("installer selftest: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
