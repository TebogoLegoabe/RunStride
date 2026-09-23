import phonenumbers


class InvalidPhoneNumber(ValueError):
    pass


def normalize_phone(raw: str, default_region: str) -> str:
    """Return the number in E.164 format (+27821234567) or raise InvalidPhoneNumber."""
    try:
        parsed = phonenumbers.parse(raw, default_region)
    except phonenumbers.NumberParseException as exc:
        raise InvalidPhoneNumber(str(exc)) from exc
    if not phonenumbers.is_valid_number(parsed):
        raise InvalidPhoneNumber("not a valid phone number")
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
