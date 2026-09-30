// Sets the release version in manifest.json and package.json: node tools/set-version.mjs 1.2.3
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = String(process.argv[2] || "").replace(/^v/, "");
// Chrome only accepts one to four dot-separated integers, so no pre-release suffixes.
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Usage: node tools/set-version.mjs <major.minor.patch> (got "${process.argv[2] ?? ""}")`);
  process.exit(1);
}
for (const file of ["manifest.json", "package.json"]) {
  const full = path.join(root, file);
  const text = fs.readFileSync(full, "utf8");
  const updated = text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
  if (updated === text && !text.includes(`"version": "${version}"`)) throw new Error(`No version field in ${file}`);
  fs.writeFileSync(full, updated);
}
console.log(`version ${version}`);
