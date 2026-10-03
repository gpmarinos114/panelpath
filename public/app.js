/* Reading Orders — client v2 (multi-order) */
const ASSET_V = 3;

const $ = (s) => document.querySelector(s);
let PROGRESS = {};   // { orderId: { itemId: ts } }
let CURRENT = null;  // full order object (+meta) being viewed
let unreadOnly = false;
let statusTimer = null;

async function boot() {
  try {
    PROGRESS = await fetch("/api/progress").then((r) => r.json());
  } catch {
    PROGRESS = {};
  }
  route();
  window.addEventListener("hashchange", route);
  bindSettings();
  scheduleVersionCheck();
}

/* ---------- routing ---------- */

function route() {
  const m = (location.hash || "").match(/^#\/o\/([\w-]+)/);
  unreadOnly = false;
  closeModal();
  if (m) showOrder(m[1]);
  else showHome();
}

function setHeader({ title, sub, back }) {
  $("#appTitle").textContent = title;
  $("#appSub").textContent = sub;
  $("#backLink").hidden = !back;
}

/* ---------- home ---------- */

async function showHome() {
  CURRENT = null;
  setHeader({
    title: "PanelPath",
    sub: "Comic runs, in the order to read them — check off as you go.",
    back: false,
  });
  $("#progressWrap").hidden = true;
  $("#chips").hidden = true;
  $("#resetBtn").hidden = true;

  const view = $("#view");
  view.innerHTML = "";
  let orders = [];
  try {
    orders = await fetch("/api/orders").then((r) => r.json());
  } catch {
    showToast("COULD NOT LOAD ORDERS");
  }
  const wrap = document.createElement("div");
  wrap.className = "orders";
  for (const o of orders) {
    const card = document.createElement("a");
    card.className = "order-card";
    card.href = "#/o/" + o.id;
    const pct = o.total ? Math.round((o.read / o.total) * 100) : 0;
    const complete = o.total > 0 && o.read === o.total;
    card.innerHTML =
      `<div class="oc-top"><span class="oc-title">${esc(o.title)}</span>` +
      (complete ? `<span class="complete">Complete</span>` : "") +
      `</div>` +
      `<div class="oc-sub">${esc(o.subtitle)}</div>` +
      `<div class="oc-bar"><div style="width:${pct}%"></div></div>` +
      `<div class="oc-counts"><span>${o.read} / ${o.total} read</span><span>${o.sections.length} sections</span></div>`;
    wrap.appendChild(card);
  }
  if (!orders.length) {
    wrap.innerHTML = '<div class="empty-note">No reading orders found. Add one in <b>data/orders/</b>.</div>';
  }
  view.appendChild(wrap);
}

/* ---------- order view ---------- */

async function showOrder(id) {
  let data;
  try {
    data = await fetch("/api/orders/" + encodeURIComponent(id)).then((r) => r.json());
  } catch {
    showToast("COULD NOT LOAD ORDER");
    return;
  }
  if (!data || data.error) {
    location.hash = "#/";
    return;
  }
  CURRENT = data;
  setHeader({ title: data.title, sub: data.subtitle || "", back: true });
  $("#progressWrap").hidden = false;
  $("#chips").hidden = false;
  $("#resetBtn").hidden = false;
  renderChips();
  renderOrder();
}

function progressFor() {
  return (CURRENT && PROGRESS[CURRENT.id]) || {};
}

function renderChips() {
  const nav = $("#chips");
  nav.innerHTML = "";
  const mk = (label, color) => {
    const b = document.createElement("button");
    b.className = "chip";
    b.innerHTML = color ? `<span class="dot" style="--era:${color}"></span>${esc(label)}` : esc(label);
    return b;
  };
  const unread = mk("Unread", null);
  unread.classList.add("toggle");
  unread.setAttribute("aria-pressed", String(unreadOnly));
  unread.addEventListener("click", () => {
    unreadOnly = !unreadOnly;
    unread.setAttribute("aria-pressed", String(unreadOnly));
    renderOrder();
  });
  nav.appendChild(unread);
  for (const s of CURRENT.sections) {
    const b = mk(s.name, s.color);
    b.addEventListener("click", () => {
      const el = document.getElementById("era-" + s.id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    nav.appendChild(b);
  }
}

function renderOrder() {
  const main = $("#view");
  main.innerHTML = "";
  const frag = document.createDocumentFragment();
  const p = progressFor();

  for (const s of CURRENT.sections) {
    const items = s.items;
    const shown = unreadOnly ? items.filter((i) => !p[i.id]) : items;
    const readIn = items.filter((i) => p[i.id]).length;
    const complete = readIn === items.length;

    const sec = document.createElement("section");
    sec.className = "era";
    sec.id = "era-" + s.id;

    const band = document.createElement("div");
    band.className = "era-band";
    band.style.setProperty("--era", s.color);
    band.innerHTML =
      `<h2>${esc(s.name)}</h2>` +
      (s.years ? `<span class="years">${esc(s.years)}</span>` : "") +
      (complete ? `<span class="complete">Complete</span>` : "") +
      `<span class="era-count">${readIn} / ${items.length}</span>` +
      (s.tagline ? `<span class="tagline">${esc(s.tagline)}</span>` : "");
    sec.appendChild(band);

    if (unreadOnly && shown.length === 0) {
      const note = document.createElement("div");
      note.className = "empty-note";
      note.textContent = "All read in this section.";
      sec.appendChild(note);
      frag.appendChild(sec);
      continue;
    }

    const list = document.createElement("div");
    list.className = "items";
    list.style.setProperty("--era", s.color);
    for (const it of shown) {
      const done = !!p[it.id];
      const card = document.createElement("div");
      card.className = "item" + (done ? " done" : "");
      card.dataset.id = it.id;
      card.style.setProperty("--era", s.color);
      const coverHtml = it.hasCover
        ? `<img class="cover" loading="lazy" src="covers/${CURRENT.id}/${it.id}.jpg" alt="${esc(it.label)} cover">`
        : `<div class="cover ph">${esc(it.series)}<br>${esc(it.num)}</div>`;
      card.innerHTML =
        `<span class="dot"></span>` +
        coverHtml +
        `<div class="meta">` +
        `<div class="label">${esc(it.label)}</div>` +
        (it.title ? `<div class="title">${esc(it.title)}</div>` : "") +
        `<div class="seriesline">${esc(it.seriesName || "")}</div>` +
        `</div>` +
        `<button class="check" aria-pressed="${done}" aria-label="toggle read">${done ? "&#10003;" : ""}</button>`;
      list.appendChild(card);
    }
    sec.appendChild(list);
    frag.appendChild(sec);
  }
  main.appendChild(frag);
  updateProgressUI();
}

function updateProgressUI() {
  if (!CURRENT) return;
  const p = progressFor();
  const total = CURRENT.total;
  const read = CURRENT.sections.reduce((n, s) => n + s.items.filter((i) => p[i.id]).length, 0);
  const pct = total ? Math.round((read / total) * 100) : 0;
  $("#barfill").style.width = pct + "%";
  $("#count").textContent = `${read} / ${total} read`;
  $("#pct").textContent = pct + "%";
  $("#allBadge").hidden = !(total > 0 && read === total);
}

/* ---------- toggling ---------- */

document.addEventListener("click", async (e) => {
  const card = e.target.closest(".item");
  if (!card || !CURRENT) return;
  const id = card.dataset.id;
  const p = PROGRESS[CURRENT.id] || (PROGRESS[CURRENT.id] = {});
  const cur = !!p[id];
  const next = !cur;

  if (next) p[id] = Date.now();
  else delete p[id];
  applyCardState(card, next);
  updateProgressUI();

  try {
    const res = await fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: CURRENT.id, id, read: next }),
    });
    if (!res.ok) throw new Error("bad status");
  } catch {
    if (next) delete p[id];
    else p[id] = Date.now();
    applyCardState(card, cur);
    updateProgressUI();
    showToast("NOT SAVED — CHECK CONNECTION");
  }
});

function applyCardState(card, done) {
  card.classList.toggle("done", done);
  const btn = card.querySelector(".check");
  btn.setAttribute("aria-pressed", String(done));
  btn.innerHTML = done ? "&#10003;" : "";
}

/* ---------- reset (two-tap) ---------- */

let resetArmed = false;
$("#resetBtn").addEventListener("click", async function () {
  if (!CURRENT) return;
  if (!resetArmed) {
    resetArmed = true;
    this.textContent = "Tap again to confirm reset";
    this.classList.add("danger");
    setTimeout(() => {
      resetArmed = false;
      this.textContent = "Reset this order\u2019s progress";
      this.classList.remove("danger");
    }, 4000);
    return;
  }
  resetArmed = false;
  this.textContent = "Reset this order\u2019s progress";
  this.classList.remove("danger");
  try {
    await fetch("/api/progress/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: CURRENT.id }),
    });
    PROGRESS[CURRENT.id] = {};
    renderOrder();
  } catch {
    showToast("RESET FAILED");
  }
});

/* ---------- settings modal ---------- */

function openModal() {
  $("#settingsModal").hidden = false;
  const hasCurrent = !!CURRENT;
  const fb = $("#fetchBtn");
  fb.disabled = !hasCurrent;
  fb.textContent = hasCurrent ? `Fetch missing covers for ${CURRENT.title}` : "Open an order to fetch its covers";
  $("#fetchStatus").textContent = "";
  fetch("/api/settings")
    .then((r) => r.json())
    .then((s) => {
      $("#keyState").textContent = s.hasKey ? "key saved \u2713" : "no key yet";
    })
    .catch(() => {});
  pollFetchStatus(true);
}

function closeModal() {
  $("#settingsModal").hidden = true;
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
}

function bindSettings() {
  $("#settingsBtn").addEventListener("click", openModal);
  $("#closeModal").addEventListener("click", closeModal);
  $("#settingsModal").addEventListener("click", (e) => {
    if (e.target === $("#settingsModal")) closeModal();
  });

  $("#saveKeyBtn").addEventListener("click", async () => {
    const key = $("#cvKey").value.trim();
    if (key.length < 10) return showToast("THAT DOESN'T LOOK LIKE A KEY");
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!r.ok) throw new Error();
      $("#cvKey").value = "";
      $("#keyState").textContent = "key saved \u2713";
      showToast("KEY SAVED");
    } catch {
      showToast("SAVE FAILED");
    }
  });

  $("#fetchBtn").addEventListener("click", async () => {
    if (!CURRENT) return;
    try {
      const r = await fetch("/api/covers/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: CURRENT.id }),
      });
      if (r.status === 409) return pollFetchStatus(true);
      if (!r.ok) throw new Error();
      pollFetchStatus(true);
    } catch {
      showToast("FETCH FAILED TO START");
    }
  });
}

function pollFetchStatus(immediate) {
  if (statusTimer) clearInterval(statusTimer);
  const tick = async () => {
    let st = {};
    try {
      st = await fetch("/api/covers/status").then((r) => r.json());
    } catch {
      return;
    }
    const el = $("#fetchStatus");
    if (!st || !st.running) {
      if (st && st.error === "no-key") el.textContent = "Add a key above first.";
      else if (st && st.finishedAt) {
        const secs = Math.max(1, Math.round((st.finishedAt - st.startedAt) / 1000));
        el.textContent = `Done — ${st.done} cover(s) fetched${st.failed ? `, ${st.failed} missing` : ""} in ${secs}s.`;
        if (CURRENT && st.order === CURRENT.id) {
          const data = await fetch("/api/orders/" + encodeURIComponent(CURRENT.id)).then((r) => r.json());
          if (data && !data.error) {
            CURRENT = data;
            renderOrder();
          }
        }
      } else {
        el.textContent = "";
      }
      clearInterval(statusTimer);
      statusTimer = null;
      return;
    }
    if (st.phase === "listing") el.textContent = "Reading the catalog\u2026";
    else el.textContent = `Fetching covers\u2026 ${st.done} / ${st.total}`;
  };
  if (immediate) tick();
  statusTimer = setInterval(tick, 2000);
}

/* ---------- misc ---------- */

function showToast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 3200);
}

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function scheduleVersionCheck() {
  const check = async () => {
    try {
      const { v } = await fetch("/api/version").then((r) => r.json());
      if (v > ASSET_V) location.reload();
    } catch {}
  };
  setTimeout(check, 4000);
  setInterval(check, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
}

boot();
