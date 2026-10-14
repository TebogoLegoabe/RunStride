// Builds the web app into dist/, ready for Cloudflare Pages.
//
// Cloudflare Pages silently skips any folder named node_modules when it uploads, and Expo puts the
// icon and font files under assets/node_modules/... So the page loads but every icon and font is missing.
// This renames that folder (and every reference to it) to assets/vendor/ after the export.
//
//   node scripts/build-web.js

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const DIST = path.join(__dirname, "..", "dist");

fs.rmSync(DIST, { recursive: true, force: true });
execSync("npx expo export --platform web --output-dir dist", {
  stdio: "inherit",
  env: { ...process.env, EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL || "https://api.runstride.co.za" },
});

const from = path.join(DIST, "assets", "node_modules");
const to = path.join(DIST, "assets", "vendor");
if (fs.existsSync(from)) fs.renameSync(from, to);

const TEXT = new Set([".js", ".html", ".json", ".css", ".txt", ".map"]);
let changed = 0;
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (TEXT.has(path.extname(entry.name))) {
      const before = fs.readFileSync(file, "utf8");
      const after = before.split("assets/node_modules/").join("assets/vendor/");
      if (after !== before) {
        fs.writeFileSync(file, after);
        changed++;
      }
    }
  }
})(DIST);

console.log(`Renamed assets/node_modules to assets/vendor (${changed} files updated).`);
