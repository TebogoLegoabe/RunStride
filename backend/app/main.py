import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.config import get_settings
from app.deps import DbSession
from app.persona import PersonaError, PersonaNotConfigured
from app.routers import auth, discover, matches, preferences, profile, users, verification
from app.storage import MEDIA_URL_PREFIX

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

app = FastAPI(title="RunStride API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    # The app shows `detail` to the user, so make it one readable sentence.
    # The full error list stays under `errors` for debugging.
    errors = exc.errors()
    message = errors[0]["msg"].removeprefix("Value error, ") if errors else "Invalid request."
    return JSONResponse(
        status_code=422,
        content={"detail": message, "errors": jsonable_errors(errors)},
    )


def jsonable_errors(errors) -> list[dict]:
    return [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in errors]


@app.exception_handler(PersonaNotConfigured)
def persona_not_configured(request: Request, exc: PersonaNotConfigured) -> JSONResponse:
    logging.getLogger("runstride.persona").error("Persona is not configured: %s", exc)
    return JSONResponse(status_code=503, content={"detail": "ID verification isn't set up yet."})


@app.exception_handler(PersonaError)
def persona_error(request: Request, exc: PersonaError) -> JSONResponse:
    # 502 also tells Persona to retry a webhook delivery later
    logging.getLogger("runstride.persona").error("Persona request failed: %s", exc)
    return JSONResponse(
        status_code=502,
        content={"detail": "ID verification is temporarily unavailable. Please try again shortly."},
    )


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(profile.router)
app.include_router(preferences.router)
app.include_router(discover.router)
app.include_router(matches.router)
app.include_router(verification.router)

media_dir = Path(get_settings().media_dir)
media_dir.mkdir(parents=True, exist_ok=True)
app.mount(MEDIA_URL_PREFIX, StaticFiles(directory=media_dir), name="media")


@app.get("/health", tags=["meta"])
def health(db: DbSession) -> dict[str, str]:
    db.execute(text("SELECT 1"))
    return {"status": "ok"}
