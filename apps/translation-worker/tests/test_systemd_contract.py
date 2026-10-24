from pathlib import Path


def test_translation_worker_has_hardened_systemd_service():
    repo = Path(__file__).resolve().parents[3]
    service = repo / "deploy" / "systemd" / "ipresenterplux-translation.service"
    assert service.exists(), "translation worker systemd service is required"
    text = service.read_text(encoding="utf-8")
    assert "User=lightworld" in text
    assert "IPRESENTERPLUX_TRANSLATION_CONTROL_URL=http://127.0.0.1:3011" in text
    assert "IPRESENTERPLUX_TRANSLATION_WORKER_TOKEN_FILE=/home/lightworld/webapps/ipresenterplux/.secrets/translation-worker-token.txt" in text
    assert "IPRESENTERPLUX_TRANSLATION_PROVIDER=disabled" in text
    assert "EnvironmentFile=-/home/lightworld/webapps/ipresenterplux/.secrets/translation-provider.env" in text
    assert "ExecStart=/home/lightworld/webapps/ipresenterplux/apps/translation-worker/.venv/bin/ipresenterplux-translation" in text
    assert "NoNewPrivileges=true" in text
    assert "ProtectSystem=strict" in text
    assert "ReadOnlyPaths=/home/lightworld/webapps/ipresenterplux/.secrets" in text


def test_translation_worker_has_dedicated_ci():
    repo = Path(__file__).resolve().parents[3]
    workflow = repo / ".github" / "workflows" / "translation-worker-ci.yml"
    assert workflow.exists(), "translation worker CI workflow is required"
    text = workflow.read_text(encoding="utf-8")
    assert 'name: Translation Worker CI' in text
    assert 'apps/translation-worker/**' in text
    assert 'deploy/systemd/ipresenterplux-translation.service' in text
    assert 'python -m pip install ".[dev]"' in text
    assert 'python -m pytest' in text
