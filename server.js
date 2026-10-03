const express = require("express");
const fs = require("fs");
const path = require("path");
const { validateOrder } = require("./lib/validate.js");

const app = express();
const PORT = process.env.PORT || 5175;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const BUNDLED_ORDERS_DIR = path.join(__dirname, "data", "orders");
const USER_ORDERS_DIR = path.join(DATA_DIR, "orders");
const COVERS_DIR = path.join(DATA_DIR, "covers");
const DRAFTS_DIR = path.join(DATA_DIR, "drafts");
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

function bundledIds() {
  const s = new Set();
  try {
    for (const f of fs.readdirSync(BUNDLED_ORDERS_DIR)) if (f.endsWith(".json")) s.add(f.replace(/\.json$/, ""));
  } catch {}
  return s;
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
  const rawId = String(req.params.id);
  const src = /^[a-z0-9-]+$/i.test(rawId) && fs.existsSync(path.join(USER_ORDERS_DIR, rawId + ".json")) ? "user" : "bundled";
  const loaded = loadOrder(rawId);
  if (!loaded) return res.status(404).json({ error: "order not found" });
  if (req.query.raw === "1") return res.json({ ...loaded, source: src });
  const order = orderWithTags(loaded);
  const out = { ...order };
  out.sections = order.sections.map((s) => ({
    ...s,
    items: s.items.map((i) => {
      const fp = coverPath(order.id, i.id);
      return { ...i, hasCover: !!(fp && fs.existsSync(fp) && fs.statSync(fp).size > 1000) };
    }),
  }));
  const meta = orderMeta(out, readProgress());
  res.json({ ...out, total: meta.total, read: meta.read, source: src });
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
  res.json({
    hasKey: !!s.comicvineKey,
    amazonTag: s.amazonTag || "",
    githubConnected: !!s.githubToken,
    githubLogin: s.githubToken ? (s.githubLogin || null) : null,
    githubDevice: !!process.env.GITHUB_CLIENT_ID,
  });
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

/* ---------- order builder: drafts, CV search, save ---------- */

function cleanOrder(o) {
  return {
    id: o.id,
    title: String(o.title).trim(),
    subtitle: String(o.subtitle || "").trim(),
    credit: String(o.credit || "").trim(),
    sections: o.sections.map((s) => ({
      id: String(s.id),
      name: String(s.name).trim(),
      years: String(s.years || "").trim(),
      color: s.color,
      ...(s.tagline ? { tagline: String(s.tagline).trim() } : {}),
      ...(Array.isArray(s.buy) && s.buy.length
        ? { buy: s.buy.map((b) => ({ label: String(b.label).trim(), url: String(b.url).trim() })) }
        : {}),
      items: s.items.map((it) => ({
        id: it.id,
        label: String(it.label).trim(),
        ...(it.title ? { title: String(it.title).trim() } : {}),
        ...(it.series ? { series: String(it.series).trim() } : {}),
        ...(it.seriesName ? { seriesName: String(it.seriesName).trim() } : {}),
        ...(it.num ? { num: String(it.num) } : {}),
        ...(it.cv && it.cv.v && it.cv.i ? { cv: { v: Number(it.cv.v), i: Number(it.cv.i) } } : {}),
      })),
    })),
  };
}

function draftFile(id) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return path.join(DRAFTS_DIR, id + ".json");
}

app.get("/api/drafts", (req, res) => {
  res.set("Cache-Control", "no-store");
  const out = [];
  try {
    for (const f of fs.readdirSync(DRAFTS_DIR)) {
      if (!f.endsWith(".json")) continue;
      const d = readJson(path.join(DRAFTS_DIR, f), null);
      if (d && d.draftId) {
        out.push({
          draftId: d.draftId,
          title: d.title || "",
          orderId: d.id || "",
          updatedAt: d.updatedAt || 0,
          sections: (d.sections || []).length,
          items: (d.sections || []).reduce((n, s) => n + ((s.items || []).length), 0),
        });
      }
    }
  } catch {}
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  res.json(out);
});

app.get("/api/drafts/:id", (req, res) => {
  const fp = draftFile(req.params.id);
  const d = fp && readJson(fp, null);
  if (!d) return res.status(404).json({ error: "draft not found" });
  res.set("Cache-Control", "no-store");
  res.json(d);
});

app.post("/api/drafts", (req, res) => {
  const d = req.body;
  const fp = d && draftFile(d.draftId || "");
  if (!fp) return res.status(400).json({ error: "bad draft id" });
  if (JSON.stringify(d).length > 3000000) return res.status(413).json({ error: "draft too large" });
  d.updatedAt = Date.now();
  writeJsonAtomic(fp, d);
  res.json({ ok: true, draftId: d.draftId, updatedAt: d.updatedAt });
});

app.delete("/api/drafts/:id", (req, res) => {
  const fp = draftFile(req.params.id);
  if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
  res.json({ ok: true });
});

/* ---------- GitHub connect + submit (Phase B) ---------- */

const GH_REPO = "gpmarinos114/panelpath";
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";

async function ghApi(token, apiPath, opts = {}) {
  const res = await fetch("https://api.github.com" + apiPath, {
    ...opts,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "User-Agent": "PanelPath",
      ...(opts.headers || {}),
    },
    signal: AbortSignal.timeout(25000),
  });
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, body };
}

function ghErr(r) {
  if (r.status === 401) return "token expired or invalid";
  if (r.status === 403 || r.status === 429) return "GitHub rate limit \u2014 try again later";
  return (r.body && r.body.message) || ("GitHub error " + r.status);
}

app.get("/api/github/status", (req, res) => {
  const s = readSettings();
  res.set("Cache-Control", "no-store");
  res.json({ connected: !!s.githubToken, login: s.githubToken ? (s.githubLogin || null) : null, device: !!GITHUB_CLIENT_ID });
});

app.post("/api/github/device/start", async (req, res) => {
  if (!GITHUB_CLIENT_ID) return res.status(400).json({ error: "no-client-id" });
  try {
    const r = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new URLSearchParams({ client_id: GITHUB_CLIENT_ID, scope: "public_repo" }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.device_code) return res.status(502).json({ error: "device-start-failed" });
    res.json({ user_code: j.user_code, verification_uri: j.verification_uri, device_code: j.device_code, interval: j.interval || 5, expires_in: j.expires_in });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e).slice(0, 120) });
  }
});

app.post("/api/github/device/poll", async (req, res) => {
  const { device_code } = req.body || {};
  if (!GITHUB_CLIENT_ID || typeof device_code !== "string" || !device_code) return res.status(400).json({ error: "bad-request" });
  try {
    const r = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new URLSearchParams({ client_id: GITHUB_CLIENT_ID, device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => null);
    if (!j) return res.status(502).json({ error: "poll-failed" });
    if (j.error === "authorization_pending" || j.error === "slow_down") return res.json({ status: "pending" });
    if (j.error) return res.json({ status: "error", error: j.error });
    if (!j.access_token) return res.status(502).json({ error: "no-token" });
    const me = await ghApi(j.access_token, "/user");
    if (!me.ok) return res.status(502).json({ error: "validate-failed" });
    const s = readSettings();
    s.githubToken = j.access_token;
    s.githubLogin = me.body.login;
    writeSettings(s);
    res.json({ status: "connected", login: me.body.login });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e).slice(0, 120) });
  }
});

app.post("/api/github/token", async (req, res) => {
  const { token } = req.body || {};
  if (typeof token !== "string" || token.trim().length < 20) return res.status(400).json({ error: "bad-token" });
  try {
    const me = await ghApi(token.trim(), "/user");
    if (!me.ok) return res.status(400).json({ error: "bad-token" });
    const s = readSettings();
    s.githubToken = token.trim();
    s.githubLogin = me.body.login;
    writeSettings(s);
    res.json({ ok: true, login: me.body.login });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e).slice(0, 120) });
  }
});

app.post("/api/github/disconnect", (req, res) => {
  const s = readSettings();
  delete s.githubToken;
  delete s.githubLogin;
  writeSettings(s);
  res.json({ ok: true });
});

app.post("/api/submit", async (req, res) => {
  const { order } = req.body || {};
  if (typeof order !== "string" || !/^[a-z0-9-]+$/.test(order)) return res.status(400).json({ error: "bad-order" });
  const userFile = path.join(USER_ORDERS_DIR, order + ".json");
  if (!fs.existsSync(userFile)) return res.status(400).json({ error: "only-your-own" });
  const o = readJson(userFile, null);
  if (!o) return res.status(400).json({ error: "bad-order" });
  const s = readSettings();
  const token = s.githubToken;
  if (!token) return res.status(400).json({ error: "not-connected" });
  try {
    const me = await ghApi(token, "/user");
    if (!me.ok) return res.status(400).json({ error: ghErr(me) });
    const login = me.body.login;

    // fork (or the repo itself, when the submitter owns it)
    let fork = await ghApi(token, `/repos/${login}/panelpath`);
    if (fork.status === 404) {
      await ghApi(token, `/repos/${GH_REPO}/forks`, { method: "POST" });
      for (let i = 0; i < 10; i++) {
        await new Promise((r2) => setTimeout(r2, 2000));
        fork = await ghApi(token, `/repos/${login}/panelpath`);
        if (fork.ok) break;
      }
    }
    if (!fork.ok) return res.status(502).json({ error: "fork-failed" });
    const onBase = String((fork.body && fork.body.full_name) || "").toLowerCase() === GH_REPO.toLowerCase();

    const branch = "submit/" + o.id;
    const branchPath = branch.split("/").map(encodeURIComponent).join("/");
    const filePath = "data/orders/" + o.id + ".json";

    // find an existing open PR for this submission — deterministic scan (the ?head= filter is index-lagged and misses internal PRs)
    const headQ = onBase ? branch : login + ":" + branch;
    const headRepo = onBase ? GH_REPO : login + "/panelpath";
    const openPrs = await ghApi(token, `/repos/${GH_REPO}/pulls?state=open&per_page=100`);
    let pr = openPrs.ok && Array.isArray(openPrs.body)
      ? openPrs.body.find(
          (p) => p.head && p.head.ref === branch && p.head.repo && String(p.head.repo.full_name).toLowerCase() === headRepo.toLowerCase()
        ) || null
      : null;

    if (!pr) {
      // NO open PR — safe to (re)point the branch at latest main.
      // Never force-reset a branch under an open PR: GitHub auto-closes the PR when its head is reset to the base commit.
      const mainRef = await ghApi(token, `/repos/${GH_REPO}/git/ref/heads/main`);
      if (!mainRef.ok) return res.status(502).json({ error: ghErr(mainRef) });
      const sha = mainRef.body.object.sha;
      const br = await ghApi(token, `/repos/${login}/panelpath/git/ref/heads/${branchPath}`);
      if (br.ok) {
        const up = await ghApi(token, `/repos/${login}/panelpath/git/refs/heads/${branchPath}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sha, force: true }),
        });
        if (!up.ok) return res.status(502).json({ error: ghErr(up) });
      } else {
        const cr = await ghApi(token, `/repos/${login}/panelpath/git/refs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ref: "refs/heads/" + branch, sha }),
        });
        if (!cr.ok) return res.status(502).json({ error: ghErr(cr) });
      }
    }

    // commit the order file (skip the commit when the branch already carries identical content)
    const existing = await ghApi(token, `/repos/${login}/panelpath/contents/${filePath}?ref=${encodeURIComponent(branch)}`);
    const clean = cleanOrder(o);
    const jsonStr = JSON.stringify(clean, null, 2) + "\n";
    const content = Buffer.from(jsonStr).toString("base64");
    let existingText = null;
    if (existing.ok && existing.body && existing.body.content) {
      try {
        existingText = Buffer.from(String(existing.body.content).replace(/\n/g, ""), "base64").toString("utf8");
      } catch {}
    }
    const isNew = !bundledIds().has(o.id);
    if (existingText === null || existingText.trim() !== jsonStr.trim()) {
      const put = await ghApi(token, `/repos/${login}/panelpath/contents/${filePath}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: (isNew ? "Add order: " : "Update order: ") + clean.title,
          content,
          branch,
          ...(existing.ok && existing.body && existing.body.sha ? { sha: existing.body.sha } : {}),
        }),
      });
      if (!put.ok) return res.status(502).json({ error: ghErr(put) });
    }

    let updated = false;
    if (pr) {
      updated = true;
    } else {
      const itemCount = clean.sections.reduce((n, sec) => n + sec.items.length, 0);
      const body =
        "## " + (isNew ? "New reading order" : "Update to an existing reading order") + ": **" + clean.title + "**\n\n" +
        (clean.subtitle ? clean.subtitle + "\n\n" : "") +
        "- " + clean.sections.length + " sections, " + itemCount + " issues\n" +
        "- Submitted from the PanelPath app (@" + login + ")\n\n" +
        (clean.credit ? "> " + clean.credit + "\n\n" : "") +
        "---\n*A maintainer will review this. Thanks for contributing!*";
      const prR = await ghApi(token, `/repos/${GH_REPO}/pulls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: (isNew ? "Order: " : "Update order: ") + clean.title, head: headQ, base: "main", body }),
      });
      if (!prR.ok) return res.status(502).json({ error: ghErr(prR) });
      pr = prR.body;
    }
    res.json({ ok: true, login, updated, pr: { number: pr.number, url: pr.html_url } });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e).slice(0, 160) });
  }
});

app.get("/api/cv/volumes", async (req, res) => {
  const key = readSettings().comicvineKey;
  if (!key) return res.status(400).json({ error: "no-key" });
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.json({ results: [] });
  try {
    const j = await getJson(
      `https://comicvine.gamespot.com/api/search/?api_key=${encodeURIComponent(key)}&format=json` +
      `&resources=volume&field_list=id,name,start_year,count_of_issues,publisher,image&limit=12&query=${encodeURIComponent(q)}`
    );
    res.set("Cache-Control", "no-store");
    res.json({
      results: (j.results || []).map((r) => ({
        id: r.id,
        name: r.name,
        year: r.start_year || "",
        issues: r.count_of_issues || 0,
        publisher: (r.publisher && r.publisher.name) || "",
        image: pickImage(r.image),
      })),
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e).slice(0, 120) });
  }
});

app.get("/api/cv/issues", async (req, res) => {
  const key = readSettings().comicvineKey;
  if (!key) return res.status(400).json({ error: "no-key" });
  const vol = String(req.query.vol || "");
  if (!/^\d+$/.test(vol)) return res.status(400).json({ error: "bad vol" });
  try {
    const out = [];
    let offset = 0;
    for (let page = 0; page < 4; page++) {
      const j = await getJson(
        `https://comicvine.gamespot.com/api/issues/?api_key=${encodeURIComponent(key)}&format=json` +
        `&filter=volume:${vol}&field_list=id,issue_number,name,cover_date&limit=100&offset=${offset}`
      );
      const rs = j.results || [];
      for (const r of rs) out.push({ i: r.id, num: String(r.issue_number), name: r.name || "", date: r.cover_date || "" });
      if (rs.length < 100) break;
      offset += 100;
      await new Promise((r) => setTimeout(r, 300));
    }
    out.sort((a, b) => (parseFloat(a.num) || 0) - (parseFloat(b.num) || 0));
    res.set("Cache-Control", "no-store");
    res.json({ results: out });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e).slice(0, 120) });
  }
});

app.post("/api/orders/save", (req, res) => {
  const o = req.body;
  const err = validateOrder(o);
  if (err) return res.status(400).json({ error: err });
  if (bundledIds().has(o.id)) return res.status(400).json({ error: "id-taken" });
  const userExists = fs.existsSync(path.join(USER_ORDERS_DIR, o.id + ".json"));
  if (userExists && o.allowOverwrite !== true) return res.status(400).json({ error: "id-taken" });
  if (!fs.existsSync(USER_ORDERS_DIR)) fs.mkdirSync(USER_ORDERS_DIR, { recursive: true });
  writeJsonAtomic(path.join(USER_ORDERS_DIR, o.id + ".json"), cleanOrder(o));
  res.json({ ok: true, id: o.id, updated: userExists });
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
