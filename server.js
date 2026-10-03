const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5175;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const BUNDLED_ORDERS_DIR = path.join(__dirname, "data", "orders");
const USER_ORDERS_DIR = path.join(DATA_DIR, "orders");
const COVERS_DIR = path.join(DATA_DIR, "covers");
const PROGRESS_FILE = process.env.PROGRESS_FILE || path.join(DATA_DIR, "progress.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

app.use(express.json());

/* ---------- helpers ---------- */

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, file);
}

function orderFile(id) {
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  const user = path.join(USER_ORDERS_DIR, id + ".json");
  if (fs.existsSync(user)) return user;
  const bundled = path.join(BUNDLED_ORDERS_DIR, id + ".json");
  if (fs.existsSync(bundled)) return bundled;
  return null;
}

function loadOrder(id) {
  const file = orderFile(id);
  if (!file) return null;
  return readJson(file, null);
}

function listOrders() {
  const seen = new Map();
  for (const dir of [BUNDLED_ORDERS_DIR, USER_ORDERS_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const o = readJson(path.join(dir, f), null);
      if (o && o.id) seen.set(o.id, o); // user dir overrides bundled
    }
  }
  return [...seen.values()].sort((a, b) => (a.title || "").localeCompare(b.title || ""));
}

// progress: v2 = { orderId: { itemId: ts } }; v1 flat maps migrate on read
function readProgress() {
  const p = readJson(PROGRESS_FILE, {});
  if (p && typeof p === "object" && !Array.isArray(p)) {
    const vals = Object.values(p);
    if (vals.length && vals.every((v) => typeof v === "number")) {
      const migrated = { "power-rangers": p };
      writeJsonAtomic(PROGRESS_FILE, migrated);
      return migrated;
    }
  }
  return p && typeof p === "object" ? p : {};
}

function writeProgress(p) {
  writeJsonAtomic(PROGRESS_FILE, p);
}

function readSettings() {
  return readJson(SETTINGS_FILE, {});
}

function writeSettings(s) {
  writeJsonAtomic(SETTINGS_FILE, s);
}

function readVersion() {
  try {
    const html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
    const m = html.match(/\?v=(\d+)/);
    return m ? Number(m[1]) : 1;
  } catch {
    return 1;
  }
}

/* ---------- affiliate tags ---------- */

function affiliateTag() {
  const s = readSettings();
  const t = (s.amazonTag || process.env.AMAZON_TAG || "").trim();
  return t;
}

function applyTag(url, tag) {
  if (!tag || typeof url !== "string") return url;
  try {
    const u = new URL(url);
    if (!/(^|\.)amazon\.com$/i.test(u.hostname)) return url;
    u.searchParams.set("tag", tag);
    return u.toString();
  } catch {
    return url;
  }
}

function tagBuys(buy, tag) {
  if (!Array.isArray(buy)) return buy;
  return buy.map((b) =>
    b && typeof b.url === "string" ? { ...b, url: applyTag(b.url, tag) } : b
  );
}

function orderWithTags(order) {
  const tag = affiliateTag();
  if (!order || !tag) return order;
  const out = { ...order };
  if (out.buy) out.buy = tagBuys(out.buy, tag);
  out.sections = order.sections.map((s) => (s.buy ? { ...s, buy: tagBuys(s.buy, tag) } : s));
  return out;
}

function coverPath(orderId, itemId) {
  if (!/^[a-z0-9-]+$/.test(orderId) || !/^[A-Za-z0-9_.-]+$/.test(itemId)) return null;
  return path.join(COVERS_DIR, orderId, itemId + ".jpg");
}

function orderMeta(order, progress) {
  const total = order.sections.reduce((n, s) => n + s.items.length, 0);
  const p = progress[order.id] || {};
  const read = order.sections.reduce((n, s) => n + s.items.filter((i) => p[i.id]).length, 0);
  return {
    id: order.id,
    title: order.title,
    subtitle: order.subtitle || "",
    credit: order.credit || "",
    buy: order.buy || null,
    total,
    read,
    sections: order.sections.map((s) => ({
      id: s.id, name: s.name, color: s.color, years: s.years, kind: s.kind || null,
      count: s.items.length,
      read: s.items.filter((i) => p[i.id]).length,
      buy: s.buy || null,
    })),
  };
}

/* ---------- cover fetch job ---------- */

let fetchJob = { running: false };

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "reading-order-app (cover fetch; personal use)" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

function pickImage(img) {
  if (!img) return null;
  return img.medium_url || img.screen_url || img.small_url || img.thumb_url || null;
}

async function runCoverFetch(orderId) {
  const order = loadOrder(orderId);
  const settings = readSettings();
  const key = settings.comicvineKey;
  if (!order) { fetchJob = { running: false, error: "unknown order" }; return; }
  if (!key) { fetchJob = { running: false, error: "no-key" }; return; }

  fetchJob = { running: true, order: orderId, phase: "listing", total: 0, done: 0, failed: 0, error: null, startedAt: Date.now() };

  try {
    // group items by ComicVine volume
    const byVol = new Map();
    for (const s of order.sections) {
      for (const it of s.items) {
        if (!it.cv || !it.cv.v || !it.cv.i) continue;
        if (!byVol.has(it.cv.v)) byVol.set(it.cv.v, []);
        byVol.get(it.cv.v).push(it);
      }
    }

    // build the work list (skip items that already have a cover)
    const work = [];
    for (const [volId, items] of byVol) {
      const imageById = new Map();
      let offset = 0;
      while (true) {
        const j = await getJson(
          `https://comicvine.gamespot.com/api/issues/?api_key=${encodeURIComponent(key)}&format=json` +
          `&filter=volume:${volId}&field_list=id,image&limit=100&offset=${offset}`
        );
        const results = j.results || [];
        for (const r of results) imageById.set(r.id, pickImage(r.image));
        if (results.length < 100) break;
        offset += 100;
      }
      for (const it of items) {
        const file = coverPath(orderId, it.id);
        if (file && fs.existsSync(file) && fs.statSync(file).size > 1000) continue;
        const url = imageById.get(it.cv.i);
        if (url) work.push({ itemId: it.id, url });
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    fetchJob.phase = "downloading";
    fetchJob.total = work.length;
    for (const w of work) {
      const file = coverPath(orderId, w.itemId);
      try {
        const res = await fetch(w.url, {
          headers: { "User-Agent": "reading-order-app (cover fetch; personal use)" },
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 800) throw new Error("too small");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, buf);
        fetchJob.done++;
      } catch {
        fetchJob.failed++;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    fetchJob.running = false;
    fetchJob.finishedAt = Date.now();
  } catch (e) {
    fetchJob.running = false;
    fetchJob.error = String(e.message || e).slice(0, 200);
  }
}

/* ---------- API ---------- */

app.get("/api/orders", (req, res) => {
  res.set("Cache-Control", "no-store");
  const progress = readProgress();
  res.json(listOrders().map((o) => orderMeta(orderWithTags(o), progress)));
});

app.get("/api/orders/:id", (req, res) => {
  res.set("Cache-Control", "no-store");
  const order = orderWithTags(loadOrder(req.params.id));
  if (!order) return res.status(404).json({ error: "order not found" });
  const out = { ...order };
  out.sections = order.sections.map((s) => ({
    ...s,
    items: s.items.map((i) => {
      const fp = coverPath(order.id, i.id);
      return { ...i, hasCover: !!(fp && fs.existsSync(fp) && fs.statSync(fp).size > 1000) };
    }),
  }));
  const meta = orderMeta(out, readProgress());
  res.json({ ...out, total: meta.total, read: meta.read });
});

app.get("/api/progress", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(readProgress());
});

app.post("/api/progress", (req, res) => {
  const { order, id, read } = req.body || {};
  if (typeof order !== "string" || typeof id !== "string" || !order || !id)
    return res.status(400).json({ error: "order and id required" });
  const p = readProgress();
  if (!p[order]) p[order] = {};
  if (read) p[order][id] = Date.now();
  else delete p[order][id];
  writeProgress(p);
  res.json({ ok: true, order, id, read: !!read });
});

app.post("/api/progress/reset", (req, res) => {
  const { order } = req.body || {};
  const p = readProgress();
  if (order) delete p[order];
  else {
    writeProgress({});
    return res.json({ ok: true });
  }
  writeProgress(p);
  res.json({ ok: true, order });
});

app.get("/api/settings", (req, res) => {
  const s = readSettings();
  res.set("Cache-Control", "no-store");
  res.json({ hasKey: !!s.comicvineKey, amazonTag: s.amazonTag || "" });
});

app.post("/api/settings", (req, res) => {
  const { key, amazonTag } = req.body || {};
  const s = readSettings();
  let changed = false;
  if (typeof amazonTag === "string") {
    const t = amazonTag.trim();
    if (t && !/^[A-Za-z0-9._-]{3,40}$/.test(t)) return res.status(400).json({ error: "bad tag" });
    s.amazonTag = t;
    changed = true;
  }
  if (typeof key === "string") {
    if (key.length < 10) return res.status(400).json({ error: "bad key" });
    s.comicvineKey = key.trim();
    changed = true;
  }
  if (!changed) return res.status(400).json({ error: "nothing to save" });
  writeSettings(s);
  res.json({ ok: true, hasKey: !!s.comicvineKey, amazonTag: s.amazonTag || "" });
});

app.post("/api/covers/fetch", (req, res) => {
  const { order, key } = req.body || {};
  if (fetchJob.running) return res.status(409).json({ error: "already running", job: fetchJob });
  if (typeof key === "string" && key.length >= 10) {
    const s = readSettings();
    s.comicvineKey = key.trim();
    writeSettings(s);
  }
  const o = loadOrder(order || "");
  if (!o) return res.status(404).json({ error: "order not found" });
  runCoverFetch(o.id); // fire and forget (job state in memory)
  res.json({ ok: true, job: fetchJob });
});

app.get("/api/covers/status", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(fetchJob);
});

app.get("/api/version", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ v: readVersion() });
});

app.get("/covers/:order/:file", (req, res) => {
  const fp = coverPath(req.params.order, req.params.file.replace(/\.jpg$/i, ""));
  if (!fp || !fs.existsSync(fp)) return res.status(404).end();
  res.set("Cache-Control", "public, max-age=86400");
  res.sendFile(fp);
});

app.use(
  express.static(path.join(__dirname, "public"), {
    etag: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) res.set("Cache-Control", "no-cache");
    },
  })
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`reading-order app running — http://0.0.0.0:${PORT}`);
});
