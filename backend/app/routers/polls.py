"""One question at a time for beta testers (for now: should people have to verify their ID?)."""

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import func, select

from app.deps import AdminUser, CurrentUser, DbSession
from app.models import PollAnswer
from app.schemas import PollAnswerBody, PollOption, PollOut, PollResults

router = APIRouter(tags=["polls"])

POLL_ID = "id-verification"
QUESTION = "Should people have to verify their ID on RunStride?"
OPTIONS = [
    PollOption(value="want", label="Yes, I'd want to see verified people"),
    PollOption(value="optional", label="Make it optional, with a badge"),
    PollOption(value="phone", label="A phone number is enough"),
]


@router.get("/me/poll", response_model=PollOut)
def current_poll(user: CurrentUser, db: DbSession) -> PollOut:
    answered = db.get(PollAnswer, (user.id, POLL_ID)) is not None
    return PollOut(id=POLL_ID, question=QUESTION, options=OPTIONS, answered=answered)


@router.post("/me/poll", status_code=status.HTTP_204_NO_CONTENT)
def answer_poll(body: PollAnswerBody, user: CurrentUser, db: DbSession) -> Response:
    if body.answer not in {o.value for o in OPTIONS}:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Please choose one of the options.")
    existing = db.get(PollAnswer, (user.id, POLL_ID))
    if existing is None:
        db.add(PollAnswer(user_id=user.id, poll_id=POLL_ID, answer=body.answer))
    else:
        existing.answer = body.answer
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/admin/poll", response_model=PollResults)
def poll_results(admin: AdminUser, db: DbSession) -> PollResults:
    rows = db.execute(
        select(PollAnswer.answer, func.count()).where(PollAnswer.poll_id == POLL_ID).group_by(PollAnswer.answer)
    ).all()
    counts = {o.value: 0 for o in OPTIONS} | {answer: n for answer, n in rows}
    return PollResults(id=POLL_ID, question=QUESTION, total=sum(counts.values()), counts=counts)
