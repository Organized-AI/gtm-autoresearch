// Builds public/ for the Worker and dist/artifact.html for a static share.
// The newest recorded proof run (JSONL from ARB_RECORD) is embedded, so the page
// replays it when no Worker is behind it.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const BOX = join(dirname(fileURLToPath(import.meta.url)), "..");
const proofFile = readdirSync(join(BOX, "proof")).filter((f) => f.endsWith(".jsonl")).sort().pop();
const events = readFileSync(join(BOX, "proof", proofFile), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const page = readFileSync(join(BOX, "site/page.html"), "utf8").replace("__PROOF__", () => JSON.stringify(events).replace(/</g, "\\u003c"));
const doc = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${page.replace(/<nav>/, "</head>\n<body>\n<nav>")}\n</body>\n</html>\n`;
mkdirSync(join(BOX, "public/run"), { recursive: true }); mkdirSync(join(BOX, "dist"), { recursive: true });
writeFileSync(join(BOX, "public/index.html"), doc);
writeFileSync(join(BOX, "public/run/index.html"), doc);
writeFileSync(join(BOX, "dist/artifact.html"), page);
console.log("built", proofFile, events.length, "events", page.length, "bytes");
