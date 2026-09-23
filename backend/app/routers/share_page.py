"""The page a trusted contact opens from a run-sharing link. No login: the secret token is the key.

Everything user-provided is inserted with textContent in the browser, never into the HTML,
so names and places can't inject markup.
"""

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy import select

from app.deps import DbSession
from app.models import Match, RunDate, RunShare
from app.routers.run_safety import display_name, share_status
from app.security import utcnow

router = APIRouter(include_in_schema=False)

PRIVATE_HEADERS = {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
}


@router.get("/s/{token}/data")
def share_data(token: str, db: DbSession) -> JSONResponse:
    share = db.scalar(select(RunShare).where(RunShare.token == token))
    if share is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="This link isn't valid.")
    run = db.get(RunDate, share.run_date_id)
    match = db.get(Match, run.match_id)
    current = share_status(share, utcnow())
    # After an alert the last position stays visible even once the link expires
    show_location = current in ("active", "alert") or (current == "expired" and share.alert_at is not None)
    location = None
    if show_location and share.latitude is not None:
        location = {
            "latitude": share.latitude,
            "longitude": share.longitude,
            "accuracyM": share.accuracy_m,
            "updatedAt": share.location_at.isoformat() if share.location_at else None,
        }
    body = {
        "runnerName": display_name(db, share.user_id),
        "meetingName": display_name(db, match.other_user_id(share.user_id)),
        "place": run.place,
        "startsAt": run.starts_at.isoformat(),
        "status": current,
        "alertAt": share.alert_at.isoformat() if share.alert_at else None,
        "expiresAt": share.expires_at.isoformat(),
        "location": location,
    }
    return JSONResponse(body, headers=PRIVATE_HEADERS)


@router.get("/s/{token}", response_class=HTMLResponse)
def share_page(token: str) -> HTMLResponse:
    # The page itself is static; it loads its data from /s/<token>/data
    return HTMLResponse(PAGE, headers=PRIVATE_HEADERS)


PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>RunStride run sharing</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         background: #0f172a; color: #e2e8f0; }
  main { max-width: 520px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 22px; margin: 0 0 4px; color: #fff; }
  .brand { color: #4ecdc4; font-weight: 700; font-size: 14px; margin-bottom: 20px; }
  .banner { border-radius: 14px; padding: 16px; margin: 16px 0; line-height: 1.45; }
  .ok { background: rgba(78,205,196,.12); border: 1px solid #4ecdc4; }
  .alert { background: rgba(239,68,68,.18); border: 2px solid #ef4444; color: #fecaca; }
  .alert strong { color: #fff; font-size: 18px; display: block; margin-bottom: 6px; }
  .muted { background: #1e293b; border: 1px solid #334155; color: #94a3b8; }
  .card { background: #1e293b; border-radius: 14px; padding: 16px; margin: 16px 0; }
  .label { color: #94a3b8; font-size: 13px; }
  .value { color: #fff; font-size: 16px; margin: 2px 0 12px; }
  a.button { display: block; text-align: center; background: #4ecdc4; color: #0f172a; font-weight: 700;
             text-decoration: none; padding: 14px; border-radius: 999px; margin-top: 8px; }
  a.call { background: #ef4444; color: #fff; }
  .small { color: #64748b; font-size: 12px; margin-top: 24px; line-height: 1.5; }
</style>
</head>
<body>
<main>
  <div class="brand">RunStride · run sharing</div>
  <h1 id="title">Loading…</h1>
  <div id="status"></div>
  <div class="card" id="details" hidden>
    <div class="label">Meeting</div><div class="value" id="meeting"></div>
    <div class="label">Where</div><div class="value" id="place"></div>
    <div class="label">When</div><div class="value" id="when"></div>
  </div>
  <div class="card" id="locationCard" hidden>
    <div class="label">Last known location</div>
    <div class="value" id="updated"></div>
    <a class="button" id="mapLink" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
  </div>
  <div id="emergency" hidden>
    <a class="button call" href="tel:10111">Call police: 10111</a>
    <a class="button call" href="tel:112">Emergency from a mobile: 112</a>
  </div>
  <p class="small">This page updates on its own every 15 seconds. The link stops working a few
  hours after the run. RunStride only shares a location while the runner chooses to.</p>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  const dataUrl = location.pathname.replace(/\\/$/, "") + "/data";

  function ago(iso) {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins === 1) return "1 minute ago";
    if (mins < 60) return mins + " minutes ago";
    return new Date(iso).toLocaleString();
  }

  function banner(kind, heading, text) {
    const box = $("status");
    box.className = "banner " + kind;
    box.textContent = "";
    if (heading) {
      const strong = document.createElement("strong");
      strong.textContent = heading;
      box.appendChild(strong);
    }
    box.appendChild(document.createTextNode(text));
  }

  async function refresh() {
    let data;
    try {
      const res = await fetch(dataUrl, { cache: "no-store" });
      if (res.status === 404) {
        $("title").textContent = "Link not found";
        banner("muted", "", "This run-sharing link isn't valid.");
        return;
      }
      data = await res.json();
    } catch (e) {
      banner("muted", "", "Can't reach RunStride right now. Retrying…");
      return;
    }

    $("title").textContent = data.runnerName + " is sharing their run";
    $("meeting").textContent = data.meetingName;
    $("place").textContent = data.place;
    $("when").textContent = new Date(data.startsAt).toLocaleString([], {
      weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    $("details").hidden = false;

    const alert = data.status === "alert" || (data.status === "expired" && data.alertAt);
    if (alert) {
      banner("alert", data.runnerName + " pressed their emergency button",
        "Try calling them now. If you can't reach them, call the police and share the location below.");
    } else if (data.status === "active") {
      banner("ok", "", data.runnerName + " is sharing their live location with you for this run.");
    } else if (data.status === "ended") {
      banner("muted", "", data.runnerName + " has stopped sharing and marked themselves safe.");
    } else {
      banner("muted", "", "This run has finished and sharing has ended.");
    }
    $("emergency").hidden = !alert;

    if (data.location) {
      const { latitude, longitude, accuracyM, updatedAt } = data.location;
      $("mapLink").href = "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent(latitude + "," + longitude);
      $("updated").textContent = (updatedAt ? "Updated " + ago(updatedAt) : "") +
        (accuracyM ? " · accurate to about " + Math.round(accuracyM) + " m" : "");
      $("locationCard").hidden = false;
    } else {
      $("locationCard").hidden = true;
    }
  }

  refresh();
  setInterval(refresh, 15000);
</script>
</body>
</html>
"""
