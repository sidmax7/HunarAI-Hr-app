import base64
import hashlib
import hmac
import time
from collections.abc import Iterable

WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300


def compute_hunar_signature(*, api_key: str, request_body: bytes, timestamp: str) -> str:
    message = f"{timestamp.strip()}.".encode("utf-8") + request_body
    digest = hmac.new(api_key.encode("utf-8"), message, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def verify_hunar_webhook_signature(
    *,
    signature_header: str | None,
    timestamp_header: str | None,
    request_body: bytes,
    trusted_api_keys: Iterable[str],
) -> bool:
    if not signature_header or not timestamp_header:
        return False

    timestamp = timestamp_header.strip()

    try:
        ts = int(timestamp)
        if abs(time.time() - ts) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS:
            return False
    except ValueError:
        return False

    signatures = [s.strip() for s in signature_header.split(",") if s.strip()]

    for api_key in trusted_api_keys:
        computed = compute_hunar_signature(api_key=api_key, request_body=request_body, timestamp=timestamp)
        for sig in signatures:
            if hmac.compare_digest(sig, computed):
                return True

    return False
