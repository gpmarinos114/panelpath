#!/usr/bin/env node
/* Validate reading-order files. Usage: node tools/validate-order.mjs <file.json> [...] */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { validateOrder } = require("../lib/validate.js");

const files = process.argv.slice(2).filter((f) => f.endsWith(".json"));
if (!files.length) {
  console.log("no order files to validate");
  process.exit(0);
}

let bad = 0;
for (const f of files) {
  let o = null;
  try {
    o = JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (e) {
    console.log("FAIL " + f + ": not valid JSON (" + e.message + ")");
    bad++;
    continue;
  }
  const err = validateOrder(o);
  if (err) {
    console.log("FAIL " + f + ": " + err);
    bad++;
    continue;
  }
  if (path.basename(f) !== o.id + ".json") {
    console.log("FAIL " + f + ": filename must match the order id (expected " + o.id + ".json)");
    bad++;
    continue;
  }
  const n = o.sections.reduce((a, s) => a + s.items.length, 0);
  console.log("OK   " + f + " (id=" + o.id + ", " + o.sections.length + " sections, " + n + " items)");
}
process.exit(bad ? 1 : 0);
