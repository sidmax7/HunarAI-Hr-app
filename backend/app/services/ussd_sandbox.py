import re

USSD_PATTERN = re.compile(r"^\*(?P<service_code>\d+)\*(?P<site_code>\w+)\*(?P<pin>\d+)#$")

SANDBOX_SERVICE_CODE = "805"


class InvalidUSSDString(Exception):
    pass


def parse_ussd_string(dialed: str) -> dict:
    """Parse a dial string of the form *805*<site_code>*<pin>#.

    This is a local simulator standing in for a real USSD aggregator's webhook, which
    would forward exactly this kind of parsed (or raw) session payload once a real
    short code is leased. The parsing/validation logic here does not change when that
    swap happens — only the transport (this function call vs. a webhook) does.
    """
    match = USSD_PATTERN.match(dialed.strip())
    if not match:
        raise InvalidUSSDString(
            f"'{dialed}' does not match expected format *{SANDBOX_SERVICE_CODE}*<site_code>*<pin>#"
        )

    groups = match.groupdict()
    if groups["service_code"] != SANDBOX_SERVICE_CODE:
        raise InvalidUSSDString(f"Unknown service code '{groups['service_code']}'")

    return {"site_code": groups["site_code"], "pin": groups["pin"]}
