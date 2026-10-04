"""Membership: what you have, Taken mode, buying Plus and race passes.

Real purchases happen in the app stores. RevenueCat tells us about them through its webhook
(/webhooks/revenuecat), and that's the only way store purchases are recorded. In development,
/billing/test-purchase grants the same things without a store, so every flow can be tried.
"""

import hmac
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.deps import AppSettings, CurrentUser, DbSession
from app.membership import (
    FREE_CHAT_REQUESTS_PER_RACE,
    FREE_DAILY_LIKES,
    FREE_RUNNERS_VISIBLE,
    PLUS_PRODUCTS,
    PRODUCTS,
    RACE_PASS_PRODUCT,
    grant_plus,
    likes_used_today,
    plus_status,
    spend_race_pass,
    unspent_race_passes,
)
from app.models import BillingEvent, Entitlement, Race, User
from app.races import get_race
from app.schemas import (
    DatingModeBody,
    MembershipLimits,
    MembershipOut,
    PlusOut,
    RacePassOut,
    TestPurchaseBody,
)
from app.security import utcnow

log = logging.getLogger(__name__)
router = APIRouter(tags=["membership"])


def membership(db, user: User, settings) -> MembershipOut:
    active, until, source = plus_status(db, user)
    passes = db.execute(
        select(Entitlement.race_id, Race.name, Entitlement.expires_at)
        .join(Race, Race.id == Entitlement.race_id)
        .where(
            Entitlement.user_id == user.id,
            Entitlement.kind == "race_pass",
            Entitlement.expires_at > utcnow(),
        )
        .order_by(Race.starts_on)
    ).all()
    return MembershipOut(
        plus=PlusOut(active=active, expires_at=until, source=source),
        dating_mode=user.dating_mode,
        race_pass_credits=len(unspent_race_passes(db, user)),
        race_passes=[RacePassOut(race_id=r, race_name=n, expires_at=e) for r, n, e in passes],
        limits=MembershipLimits(
            daily_likes=FREE_DAILY_LIKES,
            likes_used_today=likes_used_today(db, user),
            runners_visible_per_race=FREE_RUNNERS_VISIBLE,
            chat_requests_per_race=FREE_CHAT_REQUESTS_PER_RACE,
        ),
        test_purchases=settings.test_purchases,
    )


@router.get("/me/membership", response_model=MembershipOut)
def get_membership(user: CurrentUser, db: DbSession, settings: AppSettings) -> MembershipOut:
    return membership(db, user, settings)


@router.put("/me/dating-mode", response_model=MembershipOut)
def set_dating_mode(body: DatingModeBody, user: CurrentUser, db: DbSession, settings: AppSettings) -> MembershipOut:
    """Taken: hidden from Discover and race runner lists; races, chats and swaps carry on."""
    user.dating_mode = body.mode
    db.commit()
    return membership(db, user, settings)


@router.post("/billing/test-purchase", response_model=MembershipOut)
def test_purchase(body: TestPurchaseBody, user: CurrentUser, db: DbSession, settings: AppSettings) -> MembershipOut:
    """Development only: what a store purchase would grant, without a store or a charge."""
    if not settings.test_purchases:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found.")
    if body.product_id in PLUS_PRODUCTS:
        grant_plus(db, user, source="dev", duration=PLUS_PRODUCTS[body.product_id], product_id=body.product_id)
    else:
        db.add(Entitlement(user_id=user.id, kind="race_pass", source="dev", product_id=RACE_PASS_PRODUCT))
        db.flush()
        if body.race_id is not None:
            spend_race_pass(db, user, get_race(db, body.race_id, user))
    db.commit()
    return membership(db, user, settings)


@router.post("/races/{race_id}/race-pass", response_model=MembershipOut)
def use_race_pass(race_id: uuid.UUID, user: CurrentUser, db: DbSession, settings: AppSettings) -> MembershipOut:
    """Spend a bought race pass on this race."""
    spend_race_pass(db, user, get_race(db, race_id, user))
    db.commit()
    return membership(db, user, settings)


# --- App store purchases, via RevenueCat ---

# Events that set how long a subscription runs; the event carries the new expiry
SUBSCRIPTION_EVENTS = {
    "INITIAL_PURCHASE",
    "RENEWAL",
    "UNCANCELLATION",
    "PRODUCT_CHANGE",
    "SUBSCRIPTION_EXTENDED",
    "CANCELLATION",  # still runs until the paid period ends (a refund moves the expiry to now)
    "EXPIRATION",
}


def _ms(value) -> datetime | None:
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc) if value else None


@router.post("/webhooks/revenuecat", status_code=status.HTTP_200_OK)
async def revenuecat_webhook(request: Request, db: DbSession, settings: AppSettings) -> Response:
    """RevenueCat calls this for every purchase, renewal, cancellation and expiry.

    It sends the Authorization header value set in its dashboard; we compare it to
    REVENUECAT_WEBHOOK_AUTH. The app sets each customer's RevenueCat ID to their RunStride user ID.
    """
    if not settings.revenuecat_webhook_auth:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="Store purchases aren't set up.")
    given = request.headers.get("authorization", "")
    if not hmac.compare_digest(given.encode(), settings.revenuecat_webhook_auth.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Not authorised.")

    payload = await request.json()
    event = payload.get("event") or {}
    event_id, event_type = event.get("id"), event.get("type", "")
    if not event_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Missing event ID.")

    try:
        user_id = uuid.UUID(str(event.get("app_user_id")))
    except ValueError:
        user_id = None  # e.g. an anonymous RevenueCat ID from before sign-in
    user = db.get(User, user_id) if user_id else None

    # Each event is handled once, however many times it's delivered
    inserted = db.execute(
        pg_insert(BillingEvent)
        .values(id=event_id, type=event_type[:50], user_id=user.id if user else None, payload=payload)
        .on_conflict_do_nothing()
        .returning(BillingEvent.id)
    ).first()
    if inserted is None:
        return Response(status_code=status.HTTP_200_OK)

    product = event.get("product_id")
    if user is None:
        log.warning("RevenueCat %s event %s for unknown user %r", event_type, event_id, event.get("app_user_id"))
    elif product in PLUS_PRODUCTS and event_type in SUBSCRIPTION_EVENTS:
        # One row per subscription; renewals move its expiry on
        ref = event.get("original_transaction_id") or event.get("transaction_id") or event_id
        entitlement = db.scalar(select(Entitlement).where(Entitlement.store_ref == ref))
        if entitlement is None:
            entitlement = Entitlement(user_id=user.id, kind="plus", source="store", store_ref=ref)
            db.add(entitlement)
        entitlement.product_id = product
        expires = _ms(event.get("expiration_at_ms"))
        if event_type == "EXPIRATION":
            expires = min(expires or utcnow(), utcnow())
        entitlement.expires_at = expires
    elif product == RACE_PASS_PRODUCT and event_type in ("NON_RENEWING_PURCHASE", "INITIAL_PURCHASE"):
        ref = event.get("transaction_id") or event_id
        if db.scalar(select(Entitlement).where(Entitlement.store_ref == ref)) is None:
            db.add(Entitlement(user_id=user.id, kind="race_pass", source="store", product_id=product, store_ref=ref))
    elif product == RACE_PASS_PRODUCT and event_type == "CANCELLATION":
        # A refunded race pass: take it back
        ref = event.get("transaction_id") or event_id
        refunded = db.scalar(select(Entitlement).where(Entitlement.store_ref == ref))
        if refunded is not None:
            refunded.expires_at = utcnow()
    elif product not in PRODUCTS and event_type != "TEST":
        log.warning("RevenueCat event %s for unknown product %r", event_id, product)
    db.commit()
    return Response(status_code=status.HTTP_200_OK)
