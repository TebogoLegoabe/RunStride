// Runs the app on a phone anywhere (Wi-Fi or mobile data) by tunnelling both halves:
//   - the API, through a Cloudflare quick tunnel (the docker compose "tunnel" service)
//   - the app bundle, through Expo's own tunnel (expo start --tunnel)
// Use `npm run phone` instead when the phone is on the same Wi-Fi: it's faster.

const { execSync, spawn } = require("child_process");

const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const WAIT_SECONDS = 45;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiTunnelUrl() {
  execSync("docker compose --profile tunnel up -d tunnel", { stdio: "ignore" });
  for (let i = 0; i < WAIT_SECONDS; i++) {
    const logs = execSync("docker compose logs tunnel", { encoding: "utf8" });
    // Newest URL wins: the tunnel gets a new one each time it restarts
    const urls = logs.match(new RegExp(TUNNEL_URL, "g"));
    if (urls) return urls[urls.length - 1];
    await sleep(1000);
  }
  return null;
}

async function reachable(url) {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return true;
    } catch {
      // DNS for a brand-new tunnel can take a few seconds
    }
    await sleep(1500);
  }
  return false;
}

(async () => {
  console.log("Starting the API tunnel...");
  const apiUrl = await apiTunnelUrl();
  if (!apiUrl) {
    console.error("Couldn't get a tunnel URL. Is Docker running? Check: docker compose logs tunnel");
    process.exit(1);
  }
  process.stdout.write(`API tunnel: ${apiUrl} ... `);
  console.log((await reachable(apiUrl)) ? "reachable" : "not answering yet (the app will retry)");
  console.log("\nStarting Expo with its tunnel. Scan the QR code with Expo Go (Android) or the Camera (iPhone).\n");

  const child = spawn("npx", ["expo", "start", "--tunnel", ...process.argv.slice(2)], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, EXPO_PUBLIC_API_URL: apiUrl },
  });
  child.on("exit", (code) => process.exit(code ?? 0));
})();
