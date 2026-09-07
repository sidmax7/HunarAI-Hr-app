from app.config import settings
from app.services.hunar_client import has_public_webhook_url, webhook_callback_config


def test_no_callback_config_when_webhook_base_url_is_the_local_default(monkeypatch):
    monkeypatch.setattr(settings, "WEBHOOK_BASE_URL", "http://localhost:8000")
    assert has_public_webhook_url() is False
    assert webhook_callback_config() is None


def test_no_callback_config_for_the_placeholder_public_ip_value(monkeypatch):
    monkeypatch.setattr(settings, "WEBHOOK_BASE_URL", "https://your-public-ip.example.com")
    assert has_public_webhook_url() is False
    assert webhook_callback_config() is None


def test_callback_config_points_at_the_hunar_webhook_route_for_a_real_https_host(monkeypatch):
    monkeypatch.setattr(settings, "WEBHOOK_BASE_URL", "https://hunar.example.com")
    assert has_public_webhook_url() is True
    assert webhook_callback_config() == {
        "call_summary_callback_url": "https://hunar.example.com/api/webhooks/hunar"
    }
