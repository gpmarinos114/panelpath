/* PanelPath — client (multi-order) */
const ASSET_V = 18;

const $ = (s) => document.querySelector(s);
let PROGRESS = {};   // { orderId: { itemId: ts } }
let CURRENT = null;  // full order object (+meta) being viewed
let unreadOnly = false;
let orderQuery = "";
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
  fetch("/api/settings")
    .then((r) => r.json())
    .then((s) => updateAssocNote(s.amazonTag))
    .catch(() => {});
}

/* ---------- routing ---------- */

function route() {
  const mb = (location.hash || "").match(/^#\/new(?:\/([\w-]+))?/);
  const me = (location.hash || "").match(/^#\/edit\/([\w-]+)/);
  unreadOnly = false;
  closeModal();
  if (mb) {
    if (window.showBuilder) showBuilder(mb[1] || null);
    return;
  }
  if (me) {
    if (window.showBuilder) showBuilder(null, me[1]);
    return;
  }
  const m = (location.hash || "").match(/^#\/o\/([\w-]+)/);
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
  $("#chips").innerHTML = "";
  $("#resetBtn").hidden = true;
  $("#editBtn").hidden = true;
  $("#submitBtn").hidden = true;
  $("#orderTools").hidden = true;
  $("#orderCredit").hidden = true;
  $("#orderSearch").value = "";
  orderQuery = "";
  $("#searchCount").textContent = "";
  $("#searchClear").hidden = true;

  const view = $("#view");
  view.innerHTML = "";
  let orders = [];
  try {
    orders = await fetch("/api/orders").then((r) => r.json());
  } catch {
    showToast("COULD NOT LOAD ORDERS");
  }

  if (!orders.length) {
    view.innerHTML = '<div class="empty-note">No reading orders found. Add one in <b>data/orders/</b>.</div>';
    return;
  }

  let query = "";
  const search = document.createElement("div");
  search.className = "lib-search";
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Search reading orders\u2026";
  input.setAttribute("aria-label", "Search reading orders");
  search.appendChild(input);
  view.appendChild(search);

  const listArea = document.createElement("div");
  view.appendChild(listArea);

  const isInProgress = (o) => o.read > 0 && o.read < o.total;

  const makeCard = (o) => {
    const card = document.createElement("a");
    card.className = "order-card";
    const inProg = isInProgress(o);
    card.href = "#/o/" + o.id + (inProg ? "?go=next" : "");
    const pct = o.total ? Math.round((o.read / o.total) * 100) : 0;
    const complete = o.total > 0 && o.read === o.total;
    card.innerHTML =
      `<div class="oc-top"><span class="oc-title">${esc(o.title)}</span>` +
      (complete ? `<span class="complete">Complete</span>` : "") +
      `</div>` +
      `<div class="oc-sub">${esc(o.subtitle)}</div>` +
      `<div class="oc-bar"><div style="width:${pct}%"></div></div>` +
      `<div class="oc-counts"><span>${o.read} / ${o.total} read</span><span>${o.sections.length} sections</span></div>` +
      (inProg && o.next
        ? `<div class="oc-next"><span class="oc-next-l">Continue &rarr;</span><b>${esc(o.next.label)}</b>` +
          (o.lastRead ? `<i>last read ${timeAgo(o.lastRead)}</i>` : "") + `</div>`
        : "");
    return card;
  };

  const cardsWrap = (list) => {
    const w = document.createElement("div");
    w.className = "orders";
    for (const o of list) w.appendChild(makeCard(o));
    return w;
  };

  const groupHead = (label, count, tick) => {
    const h = document.createElement("div");
    h.className = "lib-group-head";
    h.style.setProperty("--tick", tick);
    h.innerHTML = `<h2>${esc(label)}</h2><span class="lg-count">${count}</span>`;
    return h;
  };

  const renderCards = () => {
    const q = query.trim().toLowerCase();
    listArea.innerHTML = "";
    const list = q
      ? orders.filter((o) => (o.id + " " + o.title + " " + (o.subtitle || "")).toLowerCase().includes(q))
      : orders;
    if (!list.length) {
      listArea.innerHTML = `<div class="empty-note">No reading orders match &ldquo;${esc(query.trim())}&rdquo;.</div>`;
      return;
    }
    const current = list.filter(isInProgress);
    const rest = list.filter((o) => !isInProgress(o));
    if (!q && current.length) {
      listArea.appendChild(groupHead("Currently reading", current.length, "var(--red)"));
      listArea.appendChild(cardsWrap(current));
      if (rest.length) {
        listArea.appendChild(groupHead("Library", rest.length, "var(--dim)"));
        listArea.appendChild(cardsWrap(rest));
      }
      return;
    }
    listArea.appendChild(cardsWrap(list));
  };

  input.addEventListener("input", () => {
    query = input.value;
    renderCards();
  });
  renderCards();

  const tools = document.createElement("div");
  tools.className = "lib-tools";
  const nb = document.createElement("a");
  nb.className = "ghost b-new";
  nb.href = "#/new";
  nb.textContent = "+ New order";
  tools.appendChild(nb);
  try {
    const drafts = await fetch("/api/drafts").then((r) => r.json());
    for (const d of drafts) {
      const item = document.createElement("span");
      item.className = "draft-item";
      const a = document.createElement("a");
      a.className = "draft-link";
      a.href = "#/new/" + d.draftId;
      a.textContent = "Draft: " + (d.title || "untitled") + " (" + d.items + " items)";
      const del = document.createElement("button");
      del.className = "draft-del";
      del.title = "Delete this draft";
      del.textContent = "\u00d7";
      del.addEventListener("click", () => {
        armTwice(del, "sure?", async () => {
          try {
            await fetch("/api/drafts/" + encodeURIComponent(d.draftId), { method: "DELETE" });
            item.remove();
            showToast("DRAFT DELETED");
          } catch {
            showToast("DELETE FAILED");
          }
        });
      });
      item.appendChild(a);
      item.appendChild(del);
      tools.appendChild(item);
    }
  } catch {}
  view.appendChild(tools);
}

/* ---------- shared: two-tap arm (no native dialogs) ---------- */
function armTwice(btn, armText, fire) {
  if (btn.dataset.armed === "1") {
    btn.dataset.armed = "";
    if (btn.dataset.armTimer) clearTimeout(Number(btn.dataset.armTimer));
    fire();
    return;
  }
  btn.dataset.armed = "1";
  btn.dataset.armOrig = btn.textContent;
  btn.textContent = armText;
  btn.classList.add("danger");
  btn.dataset.armTimer = String(setTimeout(() => {
    btn.dataset.armed = "";
    if (btn.dataset.armOrig) btn.textContent = btn.dataset.armOrig;
    btn.classList.remove("danger");
  }, 3500));
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
  $("#editBtn").hidden = data.source !== "user";
  $("#submitBtn").hidden = data.source !== "user";
  $("#orderTools").hidden = false;
  $("#orderSearch").value = "";
  orderQuery = "";
  $("#searchCount").textContent = "";
  $("#searchClear").hidden = true;
  const crEl = $("#orderCredit");
  if (data.credit) {
    crEl.hidden = false;
    crEl.innerHTML =
      "About this order: " + esc(data.credit) +
      (data.source === "bundled"
        ? ` &middot; <a href="https://github.com/gpmarinos114/panelpath/edit/main/data/orders/${encodeURIComponent(data.id)}.json" target="_blank" rel="noopener">Suggest an edit</a>`
        : "");
  } else {
    crEl.hidden = true;
  }
  renderChips();
  renderOrder();
  if (/[?&]go=next/.test(location.hash)) setTimeout(jumpToNextUnread, 80);
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
    if (!CURRENT) return;
    unreadOnly = !unreadOnly;
    unread.setAttribute("aria-pressed", String(unreadOnly));
    renderOrder();
  });
  nav.appendChild(unread);
  const nextChip = mk("Next unread", null);
  nextChip.addEventListener("click", jumpToNextUnread);
  nav.appendChild(nextChip);
  for (const s of CURRENT.sections) {
    const b = mk(s.name, s.color);
    b.addEventListener("click", () => {
      const el = document.getElementById("era-" + s.id);
      if (!el) return;
      const hdr = document.querySelector("header#top");
      const off = (hdr ? hdr.getBoundingClientRect().height : 0) + 10;
      const y = Math.max(0, window.scrollY + el.getBoundingClientRect().top - off);
      const before = window.scrollY;
      window.scrollTo({ top: y, behavior: "smooth" });
      setTimeout(() => {
        // fallback for environments where smooth scrolling doesn't animate (it would stay put)
        if (Math.abs(window.scrollY - before) < 2 && Math.abs(window.scrollY - y) > 4) {
          window.scrollTo(0, y);
        }
      }, 150);
    });
    nav.appendChild(b);
  }
}

function collapsedSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem("pp_col_" + (CURRENT && CURRENT.id)) || "[]"));
  } catch (e) {
    return new Set();
  }
}
function saveCollapsed(set) {
  try {
    localStorage.setItem("pp_col_" + CURRENT.id, JSON.stringify([...set]));
  } catch (e) {}
}

function renderOrder() {
  if (!CURRENT) return;
  const main = $("#view");
  main.innerHTML = "";
  const frag = document.createDocumentFragment();
  const p = progressFor();
  const collapsed = collapsedSet();
  const q = orderQuery.trim().toLowerCase();
  let matchTotal = 0;

  for (const s of CURRENT.sections) {
    const items = s.items;
    let shown = q ? items.filter((i) => matchItem(i, q)) : items;
    if (unreadOnly) shown = shown.filter((i) => !p[i.id]);
    if (q && shown.length === 0) continue;
    if (q) matchTotal += shown.length;
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
      `<span class="era-x" aria-hidden="true">&#9662;</span>` +
      (s.tagline ? `<span class="tagline">${esc(s.tagline)}</span>` : "") +
      (s.buy && s.buy.length
        ? `<div class="era-buy"><span class="buy-label">Get it</span>` +
          s.buy.map((b) => `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.label)}</a>`).join("") +
          `</div>`
        : "");
    sec.appendChild(band);

    const markBtn = document.createElement("button");
    markBtn.className = "band-action";
    markBtn.textContent = complete ? "Clear" : "Mark read";
    markBtn.addEventListener("click", (e) => e.stopPropagation());
    markBtn.addEventListener("click", () => {
      const ids = (complete ? items.filter((i) => p[i.id]) : items.filter((i) => !p[i.id])).map((i) => i.id);
      if (!ids.length) return;
      armTwice(markBtn, "sure?", async () => {
        const pp = PROGRESS[CURRENT.id] || (PROGRESS[CURRENT.id] = {});
        const prev = {};
        for (const x of ids) prev[x] = pp[x];
        const now = Date.now();
        for (const x of ids) { if (complete) delete pp[x]; else pp[x] = now; }
        renderOrder();
        try {
          const res = await fetch("/api/progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order: CURRENT.id, ids, read: !complete }),
          });
          if (!res.ok) throw new Error("bad status");
        } catch {
          for (const x of ids) { if (prev[x]) pp[x] = prev[x]; else delete pp[x]; }
          renderOrder();
          showToast("NOT SAVED \u2014 CHECK CONNECTION");
        }
      });
    });
    const cntEl = band.querySelector(".era-count");
    if (cntEl) cntEl.insertAdjacentElement("afterend", markBtn);
    else band.appendChild(markBtn);

    const secCollapsed = !q && collapsed.has(s.id);
    if (secCollapsed) sec.classList.add("collapsed");
    band.setAttribute("role", "button");
    band.setAttribute("tabindex", "0");
    band.setAttribute("aria-expanded", String(!secCollapsed));
    const toggleCollapse = () => {
      const set = collapsedSet();
      if (set.has(s.id)) set.delete(s.id); else set.add(s.id);
      saveCollapsed(set);
      sec.classList.toggle("collapsed");
      band.setAttribute("aria-expanded", String(!sec.classList.contains("collapsed")));
    };
    band.addEventListener("click", (e) => {
      if (e.target.closest("a, button")) return; // buy links + band actions keep working
      toggleCollapse();
    });
    band.addEventListener("keydown", (e) => {
      if (e.target !== band) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleCollapse();
      }
    });

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
    if (!q && complete) {
      const nxt = nextSection(s);
      if (nxt && nxt.buy && nxt.buy.length) {
        const nb = document.createElement("div");
        nb.className = "sec-next";
        nb.innerHTML = `<span class="buy-label">Up next &middot; ${esc(nxt.name)}</span>` +
          nxt.buy.map((b) => `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.label)}</a>`).join("");
        sec.appendChild(nb);
      }
    }
    frag.appendChild(sec);
  }
  if (CURRENT.buy && CURRENT.buy.length) {
    const ob = document.createElement("div");
    ob.className = "order-buy";
    ob.innerHTML = '<span class="buy-label">This run in print</span>' +
      CURRENT.buy.map((b) => `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.label)}</a>`).join("");
    main.appendChild(ob);
  }
  if (q && matchTotal === 0) {
    const none = document.createElement("div");
    none.className = "empty-note";
    none.textContent = `No issues match "${orderQuery.trim()}".`;
    frag.appendChild(none);
  }
  main.appendChild(frag);
  const scEl = $("#searchCount");
  const clrEl = $("#searchClear");
  if (q) { scEl.textContent = matchTotal + (matchTotal === 1 ? " match" : " matches"); clrEl.hidden = false; }
  else { scEl.textContent = ""; clrEl.hidden = true; }
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

/* ---------- reading flow: next unread, hints, search ---------- */

function timeAgo(ts) {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const days = Math.floor(h / 24);
  if (days < 30) return days + "d ago";
  return Math.floor(days / 30) + "mo ago";
}

function matchItem(it, q) {
  const hay = ((it.label || "") + " " + (it.title || "") + " " + (it.seriesName || "") + " " + (it.num || "")).toLowerCase();
  if (hay.includes(q)) return true;
  const qn = q.replace(/^#/, "").replace(/\s+/g, "");
  if (/^\d+[a-z.]?$/.test(qn) && String(it.num || "").toLowerCase() === qn) return true;
  return false;
}

function sequence() {
  const seq = [];
  if (!CURRENT) return seq;
  for (const s of CURRENT.sections) for (const it of s.items) seq.push({ section: s, item: it });
  return seq;
}

function firstUnread() {
  const p = progressFor();
  for (const x of sequence()) if (!p[x.item.id]) return x;
  return null;
}

function expandSection(sectionId) {
  const secEl = document.getElementById("era-" + sectionId);
  if (secEl && secEl.classList.contains("collapsed")) {
    const set = collapsedSet();
    set.delete(sectionId);
    saveCollapsed(set);
    secEl.classList.remove("collapsed");
    const b = secEl.querySelector(".era-band");
    if (b) b.setAttribute("aria-expanded", "true");
  }
}

function itemEl(id) {
  const esc2 = window.CSS && CSS.escape ? CSS.escape(id) : id;
  return document.querySelector('.item[data-id="' + esc2 + '"]');
}

function scrollToItemEl(el, flash) {
  const hdr = document.querySelector("header#top");
  const off = (hdr ? hdr.getBoundingClientRect().height : 0) + 10;
  const y = Math.max(0, window.scrollY + el.getBoundingClientRect().top - off);
  const before = window.scrollY;
  window.scrollTo({ top: y, behavior: "smooth" });
  setTimeout(() => {
    if (Math.abs(window.scrollY - before) < 2 && Math.abs(window.scrollY - y) > 4) window.scrollTo(0, y);
  }, 150);
  if (flash) {
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1500);
  }
}

function jumpToNextUnread() {
  const nu = firstUnread();
  if (!nu) { showToast("ALL READ \u2014 ORDER COMPLETE"); return; }
  expandSection(nu.section.id);
  const el = itemEl(nu.item.id);
  if (el) scrollToItemEl(el, true);
}

function clearNextHint() {
  const h = document.querySelector(".next-hint");
  if (h) h.remove();
}

function nextUnreadAfter(itemId) {
  const p = progressFor();
  const seq = sequence();
  const idx = seq.findIndex((x) => x.item.id === itemId);
  if (idx === -1) return null;
  for (let i = idx + 1; i < seq.length; i++) if (!p[seq[i].item.id]) return seq[i];
  return null;
}

function showNextHint(afterCard) {
  clearNextHint();
  const nu = nextUnreadAfter(afterCard.dataset.id);
  if (!nu) return;
  const hint = document.createElement("div");
  hint.className = "next-hint";
  hint.setAttribute("role", "button");
  hint.tabIndex = 0;
  hint.innerHTML = `<span class="nh-l">Next</span><b>${esc(nu.item.label)}</b><span class="nh-jump">jump &darr;</span>`;
  const go = () => {
    expandSection(nu.section.id);
    const el = itemEl(nu.item.id);
    if (el) scrollToItemEl(el, true);
    hint.remove();
  };
  hint.addEventListener("click", go);
  hint.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  afterCard.insertAdjacentElement("afterend", hint);
}

function nextSection(section) {
  if (!CURRENT) return null;
  const idx = CURRENT.sections.indexOf(section);
  return idx >= 0 && idx + 1 < CURRENT.sections.length ? CURRENT.sections[idx + 1] : null;
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
  clearNextHint();

  try {
    const res = await fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: CURRENT.id, id, read: next }),
    });
    if (!res.ok) throw new Error("bad status");
    if (next) showNextHint(card);
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
  updateSectionHeader(card);
}

function updateSectionHeader(card) {
  if (!CURRENT) return;
  const era = card.closest(".era");
  if (!era) return;
  const sec = CURRENT.sections.find((s) => "era-" + s.id === era.id);
  if (!sec) return;
  const p = progressFor();
  const readIn = sec.items.filter((i) => p[i.id]).length;
  const band = era.querySelector(".era-band");
  if (!band) return;
  const cnt = band.querySelector(".era-count");
  if (cnt) cnt.textContent = `${readIn} / ${sec.items.length}`;
  const complete = sec.items.length > 0 && readIn === sec.items.length;
  const badge = band.querySelector(".complete");
  if (complete && !badge) {
    const b = document.createElement("span");
    b.className = "complete";
    b.textContent = "Complete";
    band.insertBefore(b, cnt || null);
  } else if (!complete && badge) {
    badge.remove();
  }
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
      $("#amazonTag").value = s.amazonTag || "";
      $("#tagState").textContent = s.amazonTag ? "active" : "not set";
    })
    .catch(() => {});
  pollFetchStatus(true);
  if (window.renderGitHubSection) renderGitHubSection();
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
  $("#editBtn").addEventListener("click", () => {
    if (CURRENT) location.hash = "#/edit/" + CURRENT.id;
  });
  $("#submitBtn").addEventListener("click", () => {
    if (window.openSubmitModal) openSubmitModal();
  });
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

  $("#saveTagBtn").addEventListener("click", async () => {
    const amazonTag = $("#amazonTag").value.trim();
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amazonTag }),
      });
      if (!r.ok) throw new Error();
      const s = await r.json();
      $("#tagState").textContent = s.amazonTag ? "active" : "not set";
      updateAssocNote(s.amazonTag);
      showToast(s.amazonTag ? "TAG SAVED" : "TAG CLEARED");
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

  let searchTimer = null;
  $("#orderSearch").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      orderQuery = $("#orderSearch").value || "";
      renderOrder();
    }, 140);
  });
  $("#orderSearch").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      $("#orderSearch").value = "";
      orderQuery = "";
      renderOrder();
    }
  });
  $("#searchClear").addEventListener("click", () => {
    $("#orderSearch").value = "";
    orderQuery = "";
    renderOrder();
    $("#orderSearch").focus();
  });

  $("#exportBtn").addEventListener("click", () => {
    window.location.href = "/api/progress/export";
  });
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", async () => {
    const f = $("#importFile").files && $("#importFile").files[0];
    if (!f) return;
    const st = $("#backupState");
    st.textContent = "importing\u2026";
    try {
      const text = await f.text();
      const parsed = JSON.parse(text);
      const progress = parsed && typeof parsed.progress === "object" && !Array.isArray(parsed.progress) ? parsed.progress : parsed;
      const res = await fetch("/api/progress/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ progress }),
      });
      if (!res.ok) throw new Error("bad");
      const j = await res.json();
      st.textContent = `merged \u2014 ${j.added} added, ${j.updated} updated`;
      PROGRESS = await fetch("/api/progress").then((r) => r.json());
      if (CURRENT) renderOrder();
    } catch {
      st.textContent = "import failed \u2014 is that a PanelPath progress file?";
    } finally {
      $("#importFile").value = "";
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

function updateAssocNote(tag) {
  const n = $("#assocNote");
  if (n) n.hidden = !tag;
}

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

