"""Deleting your own account. App stores require this to be possible from inside the app."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import delete

from app.deps import CurrentUser, DbSession
from app.models import OtpCode
from app.moderation import end_all_matches
from app.storage import PhotoStorage, get_photo_storage

router = APIRouter(tags=["account"])
logger = logging.getLogger("runstride.account")


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    user: CurrentUser,
    db: DbSession,
    storage: Annotated[PhotoStorage, Depends(get_photo_storage)],
) -> Response:
    """Permanently delete the signed-in account.

    Deleted with it: profile, photos, preferences, swipes, matches and their chats, run
    plans, shares, trusted contacts and pending sign-in codes. Kept: reports made about
    this person, including their evidence copy, so deleting can't erase proof of abuse.
    (Suspended and banned accounts can't reach this: they can't authenticate.)
    """
    photo_urls = [p.url for p in user.profile.photos] if user.profile else []
    # Tell matches their chat is closing before the rows disappear
    end_all_matches(db, user, user.id)
    db.execute(delete(OtpCode).where(OtpCode.phone == user.phone))
    db.delete(user)  # everything else cascades (see ondelete rules in models.py)
    db.commit()

    for url in photo_urls:
        try:
            storage.delete(url)
        except Exception:
            # The account is gone either way; a leftover file is harmless and unlinked
            logger.exception("Could not delete photo %s", url)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
