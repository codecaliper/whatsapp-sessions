// Builds dist/whatsapp-sessions-<version>.zip for "Load unpacked", a GitHub release or the Chrome Web Store.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_FILES } from "./runtime-files.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const dist = path.join(root, "dist");
const stage = path.join(dist, "whatsapp-sessions");
const zip = path.join(dist, `whatsapp-sessions-${version}.zip`);

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const entry of RUNTIME_FILES) {
  fs.cpSync(path.join(root, entry), path.join(stage, entry), { recursive: true });
}
for (const file of fs.readdirSync(stage, { recursive: true })) {
  if (path.basename(file) === ".DS_Store") fs.rmSync(path.join(stage, file));
}
// Zip the folder itself, so unzipping gives one "whatsapp-sessions" folder to pick in "Load unpacked".
execFileSync("zip", ["-qrX", zip, "whatsapp-sessions"], { cwd: dist });
console.log(`${path.relative(root, zip)} (${Math.round(fs.statSync(zip).size / 1024)} KB)`);
