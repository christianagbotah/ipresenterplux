from __future__ import annotations

from pathlib import Path


def _unit() -> str:
    path = Path(__file__).resolve().parents[3] / "deploy" / "systemd" / "ipresenterplux-tts.service"
    return path.read_text(encoding="utf-8")


def test_service_keeps_provider_disabled_by_default() -> None:
    unit = _unit()
    assert "Environment=IPRESENTERPLUX_TTS_PROVIDER=disabled" in unit


def test_service_supports_private_provider_environment_file() -> None:
    unit = _unit()
    assert "EnvironmentFile=-/home/lightworld/webapps/ipresenterplux/.secrets/tts-provider.env" in unit
    assert "ReadOnlyPaths=/home/lightworld/webapps/ipresenterplux/.secrets" in unit


def test_service_never_embeds_provider_credentials() -> None:
    unit = _unit()
    assert "IPRESENTERPLUX_TTS_GHANANLP_TOKEN=" not in unit
    assert "IPRESENTERPLUX_TTS_KHAYA_TOKEN=" not in unit
    assert "GOOGLE_APPLICATION_CREDENTIALS=" not in unit
