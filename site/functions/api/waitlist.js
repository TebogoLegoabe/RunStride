// Beta sign-ups for runstride.co.za (a Cloudflare Pages Function).
//
// POST /api/waitlist            saves a sign-up (one per email address)
// GET  /api/waitlist?key=...    downloads every sign-up as a CSV file, for you only
//
// Needs, in the Cloudflare Pages project settings:
//   a KV namespace bound as WAITLIST
//   an environment variable (secret) EXPORT_KEY: a long random password for the download link

const CITIES = ["Cape Town", "Johannesburg", "Pretoria", "Durban", "Gqeberha", "Bloemfontein", "Somewhere else"];
const PHONES = ["iphone", "android"];
const DISTANCES = ["", "5-10k", "half", "marathon", "ultra-trail"];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const clean = (value, max) => String(value ?? "").trim().slice(0, max);

export async function onRequestPost({ request, env }) {
  if (!env.WAITLIST) return json({ error: "Sign-ups aren't open just yet. Please try again soon." }, 503);

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "Something went wrong. Please try again." }, 400);
  }

  // Bots fill in the hidden field; people never see it. Pretend it worked.
  if (clean(data.website, 200)) return json({ message: "You're on the list!" });

  const name = clean(data.name, 60);
  const email = clean(data.email, 200).toLowerCase();
  const city = clean(data.city, 40);
  const phone = clean(data.phone, 20);
  const distance = clean(data.distance, 20);
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: "Please give your first name and a valid email address." }, 422);
  }
  if (!CITIES.includes(city) || !PHONES.includes(phone) || !DISTANCES.includes(distance)) {
    return json({ error: "Please choose your city and your phone." }, 422);
  }
  if (data.consent !== "yes") {
    return json({ error: "Please confirm you're 18 or older and happy to hear from us." }, 422);
  }

  const key = `signup:${email}`;
  if (await env.WAITLIST.get(key)) {
    return json({ message: "You're already on the list. We'll email you when the beta opens." });
  }
  const signup = {
    name,
    email,
    city,
    phone,
    distance,
    tester: data.tester === "yes",
    consentedAt: new Date().toISOString(),
  };
  await env.WAITLIST.put(key, JSON.stringify(signup), { metadata: { city, phone, tester: signup.tester } });
  return json({ message: `Thanks ${name}, you're on the list! We'll email you when the beta opens.` });
}

export async function onRequestGet({ request, env }) {
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!env.EXPORT_KEY || !env.WAITLIST || !(await sameSecret(key, env.EXPORT_KEY))) {
    return new Response("Not found", { status: 404 });
  }
  const rows = [["name", "email", "city", "phone", "distance", "tester", "signed_up"]];
  let cursor;
  do {
    const page = await env.WAITLIST.list({ prefix: "signup:", cursor });
    for (const entry of page.keys) {
      const s = JSON.parse((await env.WAITLIST.get(entry.name)) || "{}");
      rows.push([s.name, s.email, s.city, s.phone, s.distance, s.tester ? "yes" : "no", s.consentedAt]);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  // Quoted, and anything a spreadsheet would treat as a formula (=, +, -, @) starts with '
  const cell = (v) => {
    const text = String(v ?? "");
    return `"${(/^[=+\-@]/.test(text) ? "'" + text : text).replace(/"/g, '""')}"`;
  };
  const csv = rows.map((r) => r.map(cell).join(",")).join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="runstride-beta-signups.csv"',
      "Cache-Control": "no-store",
    },
  });
}

// Compares the download key without leaking how much of it matched
async function sameSecret(given, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
