import time

from app.services.webhook_security import compute_hunar_signature, verify_hunar_webhook_signature

API_KEY = "test-hunar-key"
BODY = b'{"event_type": "call_status_updated", "call_id": "abc123"}'


def _signed(timestamp: str, api_key: str = API_KEY, body: bytes = BODY) -> str:
    return compute_hunar_signature(api_key=api_key, request_body=body, timestamp=timestamp)


def test_valid_signature_and_fresh_timestamp_passes():
    ts = str(int(time.time()))
    sig = _signed(ts)
    assert verify_hunar_webhook_signature(
        signature_header=sig, timestamp_header=ts, request_body=BODY, trusted_api_keys=[API_KEY]
    )


def test_wrong_key_fails():
    ts = str(int(time.time()))
    sig = _signed(ts, api_key="a-different-key")
    assert not verify_hunar_webhook_signature(
        signature_header=sig, timestamp_header=ts, request_body=BODY, trusted_api_keys=[API_KEY]
    )


def test_tampered_body_fails():
    ts = str(int(time.time()))
    sig = _signed(ts)
    assert not verify_hunar_webhook_signature(
        signature_header=sig, timestamp_header=ts, request_body=BODY + b"tampered", trusted_api_keys=[API_KEY]
    )


def test_stale_timestamp_fails():
    ts = str(int(time.time()) - 3600)
    sig = _signed(ts)
    assert not verify_hunar_webhook_signature(
        signature_header=sig, timestamp_header=ts, request_body=BODY, trusted_api_keys=[API_KEY]
    )


def test_future_timestamp_beyond_tolerance_fails():
    ts = str(int(time.time()) + 3600)
    sig = _signed(ts)
    assert not verify_hunar_webhook_signature(
        signature_header=sig, timestamp_header=ts, request_body=BODY, trusted_api_keys=[API_KEY]
    )


def test_non_numeric_timestamp_fails():
    sig = _signed("not-a-number")
    assert not verify_hunar_webhook_signature(
        signature_header=sig, timestamp_header="not-a-number", request_body=BODY, trusted_api_keys=[API_KEY]
    )


def test_missing_signature_header_fails():
    ts = str(int(time.time()))
    assert not verify_hunar_webhook_signature(
        signature_header=None, timestamp_header=ts, request_body=BODY, trusted_api_keys=[API_KEY]
    )


def test_missing_timestamp_header_fails():
    sig = _signed(str(int(time.time())))
    assert not verify_hunar_webhook_signature(
        signature_header=sig, timestamp_header=None, request_body=BODY, trusted_api_keys=[API_KEY]
    )


def test_matches_any_of_multiple_trusted_keys():
    ts = str(int(time.time()))
    sig = _signed(ts, api_key="second-key")
    assert verify_hunar_webhook_signature(
        signature_header=sig,
        timestamp_header=ts,
        request_body=BODY,
        trusted_api_keys=["first-key", "second-key"],
    )


def test_comma_separated_signatures_checks_each():
    ts = str(int(time.time()))
    real_sig = _signed(ts)
    combined = f"garbage-sig, {real_sig}"
    assert verify_hunar_webhook_signature(
        signature_header=combined, timestamp_header=ts, request_body=BODY, trusted_api_keys=[API_KEY]
    )
