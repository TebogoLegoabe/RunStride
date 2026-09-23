// Starts Expo so a physical phone on the same Wi-Fi can load the app and reach the API.
//
// Expo finds the computer's LAN IP with `wmic`, which newer Windows 11 builds removed,
// so it silently falls back to 127.0.0.1 and phones can't connect. We detect the IP
// ourselves and pass it to both Metro (the QR code) and the app (API URL).

const { execSync, spawn } = require("child_process");
const os = require("os");

function windowsLanIp() {
  try {
    const cmd =
      "(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' }" +
      " | Select-Object -First 1).IPv4Address.IPAddress";
    return execSync(`powershell -NoProfile -Command "${cmd}"`, { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function anyPrivateIp() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) {
        return a.address;
      }
    }
  }
  return null;
}

const ip = (process.platform === "win32" && windowsLanIp()) || anyPrivateIp();
if (!ip) {
  console.error("Couldn't find this computer's Wi-Fi IP address. Are you connected to Wi-Fi?");
  process.exit(1);
}

const apiUrl = `http://${ip}:8000`;
console.log(`\nPhone should be on the same Wi-Fi as this computer.`);
console.log(`  App (QR code): exp://${ip}:8081`);
console.log(`  API:           ${apiUrl}\n`);

const child = spawn("npx", ["expo", "start", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, REACT_NATIVE_PACKAGER_HOSTNAME: ip, EXPO_PUBLIC_API_URL: apiUrl },
});
child.on("exit", (code) => process.exit(code ?? 0));
