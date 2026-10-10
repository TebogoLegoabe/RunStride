// Beta sign-up: sends to /api/waitlist (a Cloudflare Pages Function)
const form = document.getElementById("waitlist");
const status = document.getElementById("status");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const say = (text, kind) => { status.textContent = text; status.className = "status " + (kind || ""); };
  if (!data.name || !data.email || !data.city || !data.phone) return say("Please fill in your name, email, city and phone.", "error");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) return say("That email address doesn't look right.", "error");
  if (!data.consent) return say("Please confirm you're 18 or older and happy to hear from us.", "error");
  const button = form.querySelector("button");
  button.disabled = true;
  say("Joining…");
  try {
    const res = await fetch("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Something went wrong. Please try again.");
    form.reset();
    say(body.message || "You're on the list! We'll email you when the beta opens.", "ok");
  } catch (e) {
    say(e.message || "Couldn't reach RunStride. Please try again.", "error");
  } finally {
    button.disabled = false;
  }
});
