"""Production installs only requirements.txt, not the dev extras, so a package that tests pull in
transitively can be missing there. Google sign-in needs RS256, which needs `cryptography`."""
from pathlib import Path


def test_production_requirements_include_what_google_sign_in_needs():
    text = (Path(__file__).resolve().parent.parent / "requirements.txt").read_text().lower()
    assert "pyjwt[crypto]" in text or "cryptography" in text
