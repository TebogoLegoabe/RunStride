"""Grant or remove moderator (admin) access.

    docker compose exec api python -m app.admin_cli grant 0821234567
    docker compose exec api python -m app.admin_cli revoke 0821234567
    docker compose exec api python -m app.admin_cli list
"""

import argparse

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models import User
from app.phone import InvalidPhoneNumber, normalize_phone


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["grant", "revoke", "list"])
    parser.add_argument("phone", nargs="?", help="the account's phone number")
    args = parser.parse_args()

    with SessionLocal() as db:
        if args.command == "list":
            for phone in db.scalars(select(User.phone).where(User.is_admin)).all():
                print(phone)
            return

        if not args.phone:
            parser.error("a phone number is required")
        try:
            phone = normalize_phone(args.phone, get_settings().default_phone_region)
        except InvalidPhoneNumber:
            raise SystemExit(f"'{args.phone}' isn't a valid phone number.")
        user = db.scalar(select(User).where(User.phone == phone))
        if user is None:
            raise SystemExit(f"No account with phone {phone}. Sign up in the app first.")
        user.is_admin = args.command == "grant"
        db.commit()
        print(f"{phone} is {'now' if user.is_admin else 'no longer'} an admin.")


if __name__ == "__main__":
    main()
