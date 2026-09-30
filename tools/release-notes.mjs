// Markdown release notes from the Conventional Commits in a range:
//   node tools/release-notes.mjs <tag> [<from>..<to> | <to>]
import { execFileSync } from "node:child_process";

const [tag, range = "HEAD"] = process.argv.slice(2);
if (!tag) {
  console.error("Usage: node tools/release-notes.mjs <tag> [range]");
  process.exit(1);
}

const SECTIONS = [
  ["breaking", "⚠️ Breaking changes"],
  ["feat", "✨ Features"],
  ["fix", "🐛 Fixes"],
  ["perf", "⚡ Performance"],
  ["other", "🧹 Maintenance"],
];
const HIDDEN = /^chore\(release\)/i;

const log = execFileSync("git", ["log", "--no-merges", "--format=%h%x1f%s%x1f%b%x1e", range], { encoding: "utf8" });
const grouped = Object.fromEntries(SECTIONS.map(([key]) => [key, []]));
for (const entry of log.split("\x1e")) {
  const [sha, subject, body = ""] = entry.trim().split("\x1f");
  if (!sha || HIDDEN.test(subject)) continue;
  const match = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject);
  const type = match?.[1].toLowerCase();
  const text = match ? `${match[2] ? `**${match[2]}:** ` : ""}${match[4]}` : subject;
  const breaking = Boolean(match?.[3]) || /^BREAKING[ -]CHANGE:/m.test(body) || /^BREAKING[ -]CHANGE:/.test(subject);
  const key = breaking ? "breaking" : ["feat", "fix", "perf"].includes(type) ? type : "other";
  grouped[key].push(`- ${text} (${sha})`);
}

const version = tag.replace(/^v/, "");
const out = [];
for (const [key, title] of SECTIONS) {
  if (grouped[key].length) out.push(`## ${title}`, "", ...grouped[key], "");
}
if (!out.length) out.push("No user-facing changes.", "");
out.push(
  "## Install",
  "",
  `1. Download **whatsapp-sessions-${version}.zip** below and unzip it.`,
  "2. Open `chrome://extensions` and turn on **Developer mode**.",
  "3. Click **Load unpacked** and pick the unzipped `whatsapp-sessions` folder.",
  "   To upgrade, replace the folder's contents and click ↻ on the extension. Your sessions are kept.",
  "",
  "_Unofficial; not affiliated with WhatsApp or Meta._",
);
console.log(out.join("\n"));
