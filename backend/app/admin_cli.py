"""Grant or remove moderator (admin) access, and give or take away RunStride Plus.

    docker compose exec api python -m app.admin_cli grant 0821234567
    docker compose exec api python -m app.admin_cli revoke 0821234567
    docker compose exec api python -m app.admin_cli list
    docker compose exec api python -m app.admin_cli plus 0821234567 --days 90   (beta testers)
    docker compose exec api python -m app.admin_cli plus 0821234567             (until removed)
    docker compose exec api python -m app.admin_cli unplus 0821234567
"""

import argparse
from datetime import timedelta

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.membership import end_plus, grant_plus, plus_status
from app.models import User
from app.phone import InvalidPhoneNumber, normalize_phone


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["grant", "revoke", "list", "plus", "unplus"])
    parser.add_argument("phone", nargs="?", help="the account's phone number")
    parser.add_argument("--days", type=int, help="plus: how many days (default: until removed)")
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
        if args.command in ("plus", "unplus"):
            if args.command == "plus":
                grant_plus(db, user, source="admin", duration=timedelta(days=args.days) if args.days else None)
            else:
                end_plus(db, user, source="admin")
            db.commit()
            active, until, _ = plus_status(db, user)
            if not active:
                print(f"{phone} doesn't have Plus.")
            else:
                print(f"{phone} has Plus {'until ' + until.strftime('%d %b %Y') if until else 'until removed'}.")
            return

        user.is_admin = args.command == "grant"
        db.commit()
        print(f"{phone} is {'now' if user.is_admin else 'no longer'} an admin.")


if __name__ == "__main__":
    main()
