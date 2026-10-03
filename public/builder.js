/* PanelPath — order builder (client). Uses globals from app.js: $, esc, showToast, setHeader, CURRENT. */

const BD_PALETTE = ["#d32f2f", "#2e7d32", "#607d8b", "#f9a825", "#1976d2", "#ef6c00", "#d81b60", "#c9a227", "#795548", "#43a047", "#7e57c2", "#546e7a"];

let BD = null;
let bdAutoTimer = null;
let bdCvSection = null;
let bdCvVol = null;
let bdCvIssues = [];

function bdSlug(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function bdAbbr(name) {
  const words = String(name || "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length > 1) return words.map((w) => w[0].toUpperCase()).join("").slice(0, 6);
  return (words[0] || "SOLO").slice(0, 5).toUpperCase();
}

function bdCleanTitle(t) {
  const s = String(t || "").trim();
  if (!s || /^\[?untitled\]?$/i.test(s)) return "";
  return s.slice(0, 140);
}

function bdNewDraft() {
  return {
    draftId: "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    id: "",
    title: "",
    subtitle: "",
    credit: "Compiled by a reader. Unofficial fan project; corrections welcome.",
    updatedAt: 0,
    sections: [],
  };
}

function bdNextItemId() {
  let max = 0;
  for (const s of BD.sections) for (const it of s.items) {
    const m = String(it.id || "").match(/-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const slug = bdSlug(BD.title || "");
  return (slug.length >= 3 ? slug : "order") + "-" + String(max + 1).padStart(3, "0");
}

function bdNextSectionId() {
  let max = 0;
  for (const s of BD.sections) {
    const m = String(s.id || "").match(/^S(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return "S" + (max + 1);
}

function bdTouch() {
  const st = document.getElementById("bdStatus");
  if (st) st.textContent = "saving\u2026";
  clearTimeout(bdAutoTimer);
  bdAutoTimer = setTimeout(bdAutoSave, 1200);
}

async function bdAutoSave() {
  if (!BD || !BD.draftId) return;
  BD.updatedAt = Date.now();
  const st = document.getElementById("bdStatus");
  try {
    const r = await fetch("/api/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(BD),
    });
    if (!r.ok) throw new Error();
    if (st) st.textContent = "draft saved " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    if (st) st.textContent = "draft not saved \u2014 check connection";
  }
}

function bdField(label, value, oninput, opts) {
  const wrap = document.createElement("div");
  if (opts && opts.flex) wrap.style.flex = "1";
  const lab = document.createElement("span");
  lab.className = "b-lab";
  lab.textContent = label;
  const inp = document.createElement("input");
  inp.className = "b-input";
  inp.type = "text";
  inp.autocomplete = "off";
  inp.value = value || "";
  if (opts && opts.placeholder) inp.placeholder = opts.placeholder;
  inp.addEventListener("input", () => oninput(inp.value));
  wrap.appendChild(lab);
  wrap.appendChild(inp);
  return wrap;
}

async function showBuilder(draftId) {
  setHeader({ title: "Order builder", sub: "Draft saves automatically \u2014 nothing is final until you save.", back: true });
  $("#progressWrap").hidden = true;
  $("#chips").hidden = true;
  $("#chips").innerHTML = "";
  $("#resetBtn").hidden = true;
  CURRENT = null;

  BD = null;
  if (draftId) {
    try {
      const d = await fetch("/api/drafts/" + encodeURIComponent(draftId)).then((r) => r.json());
      if (d && d.draftId) BD = d;
    } catch {}
  }
  if (!BD) BD = bdNewDraft();
  renderBuilder();
}

function renderBuilder() {
  const view = $("#view");
  view.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "builder";

  /* --- meta card --- */
  const meta = document.createElement("div");
  meta.className = "b-card";
  meta.innerHTML = "<h3>Order</h3>";
  meta.appendChild(bdField("Title", BD.title, (v) => { BD.title = v; bdTouch(); }, { placeholder: "e.g. Invincible" }));
  meta.appendChild(bdField("Subtitle", BD.subtitle, (v) => { BD.subtitle = v; bdTouch(); }, { placeholder: "One line about the run" }));
  meta.appendChild(bdField("Credit", BD.credit, (v) => { BD.credit = v; bdTouch(); }));
  wrap.appendChild(meta);

  /* --- sections --- */
  if (!BD.sections.length) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.textContent = "No sections yet \u2014 add one (an era, a year, a reading block) and fill it with issues.";
    wrap.appendChild(note);
  }
  BD.sections.forEach((sec, i) => wrap.appendChild(bdSectionCard(sec, i)));

  const addSec = document.createElement("button");
  addSec.className = "ghost b-addsec";
  addSec.textContent = "+ Add section";
  addSec.addEventListener("click", () => {
    BD.sections.push({
      id: bdNextSectionId(), name: "", years: "",
      color: BD_PALETTE[BD.sections.length % BD_PALETTE.length],
      tagline: "", buy: [], items: [],
    });
    bdTouch();
    renderBuilder();
  });
  wrap.appendChild(addSec);

  /* --- bottom bar --- */
  const bar = document.createElement("div");
  bar.className = "b-bar";
  bar.innerHTML =
    '<button id="bdDiscard" class="ghost b-discard">Discard draft</button>' +
    '<span id="bdStatus" class="status-line">' + (BD.updatedAt ? "draft saved" : "") + "</span>" +
    '<button id="bdPreview" class="ghost">Preview</button>' +
    '<button id="bdSave" class="ghost primary">Save order</button>';
  wrap.appendChild(bar);
  view.appendChild(wrap);

  document.getElementById("bdDiscard").addEventListener("click", () => {
    armTwice(document.getElementById("bdDiscard"), "Tap again to discard", bdDiscard);
  });
  document.getElementById("bdPreview").addEventListener("click", bdTogglePreview);
  document.getElementById("bdSave").addEventListener("click", bdSaveOrder);
}

async function bdDiscard() {
  if (!BD) return;
  const had = !!(BD.title || BD.sections.length || BD.updatedAt);
  const draftId = BD.draftId;
  BD.draftId = null;
  clearTimeout(bdAutoTimer);
  if (draftId) {
    try { await fetch("/api/drafts/" + encodeURIComponent(draftId), { method: "DELETE" }); } catch {}
  }
  if (had) showToast("DRAFT DISCARDED");
  location.hash = "#/";
}

function bdSectionCard(sec, i) {
  const card = document.createElement("div");
  card.className = "b-card b-sec";
  card.style.setProperty("--era", sec.color);

  /* head: name / years */
  const two = document.createElement("div");
  two.className = "b-two";
  two.appendChild(bdField("Section name", sec.name, (v) => { sec.name = v; bdTouch(); }, { placeholder: "e.g. Year One" }));
  two.appendChild(bdField("Years / issues label", sec.years, (v) => { sec.years = v; bdTouch(); }, { placeholder: "e.g. 2016\u201317 or #0\u201312" }));
  card.appendChild(two);

  /* color swatches */
  const swWrap = document.createElement("div");
  const swLab = document.createElement("span");
  swLab.className = "b-lab";
  swLab.textContent = "Color";
  swWrap.appendChild(swLab);
  const sw = document.createElement("div");
  sw.className = "b-swatches";
  for (const c of BD_PALETTE) {
    const b = document.createElement("button");
    b.className = "b-swatch" + (c === sec.color ? " on" : "");
    b.style.background = c;
    b.title = c;
    b.addEventListener("click", () => { sec.color = c; bdTouch(); renderBuilder(); });
    sw.appendChild(b);
  }
  swWrap.appendChild(sw);
  card.appendChild(swWrap);

  card.appendChild(bdField("Tagline (optional)", sec.tagline, (v) => { sec.tagline = v; bdTouch(); }, { placeholder: "Flavor line under the header" }));

  /* section controls */
  const ctl = document.createElement("div");
  ctl.className = "b-row";
  ctl.style.marginTop = "8px";
  ctl.appendChild(bdMini("\u2191", "Move section up", () => {
    if (i === 0) return;
    [BD.sections[i - 1], BD.sections[i]] = [BD.sections[i], BD.sections[i - 1]];
    bdTouch(); renderBuilder();
  }));
  ctl.appendChild(bdMini("\u2193", "Move section down", () => {
    if (i >= BD.sections.length - 1) return;
    [BD.sections[i + 1], BD.sections[i]] = [BD.sections[i], BD.sections[i + 1]];
    bdTouch(); renderBuilder();
  }));
  let bdArmRm = false;
  const rmB = bdMini("Remove section", "Remove this section", () => {
    if (!bdArmRm) {
      bdArmRm = true;
      rmB.textContent = "Tap again to remove";
      rmB.classList.add("danger");
      setTimeout(() => { bdArmRm = false; rmB.textContent = "Remove section"; rmB.classList.remove("danger"); }, 4000);
      return;
    }
    BD.sections.splice(i, 1);
    bdTouch();
    renderBuilder();
  }, "rm");
  ctl.appendChild(rmB);
  card.appendChild(ctl);

  /* items */
  const ilab = document.createElement("span");
  ilab.className = "b-lab";
  ilab.textContent = "Items (" + sec.items.length + ")";
  card.appendChild(ilab);
  const list = document.createElement("div");
  sec.items.forEach((it, j) => {
    const row = document.createElement("div");
    row.className = "b-itemrow";
    row.innerHTML =
      '<span class="dot2" style="background:' + esc(sec.color) + '"></span>' +
      '<div style="flex:1;min-width:0">' +
      '<div class="bl" style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(it.label) + "</div>" +
      (it.title ? '<div class="bsub">' + esc(it.title) + "</div>" : "") +
      "</div>";
    if (it.cv) {
      const cvb = document.createElement("span");
      cvb.className = "b-mini";
      cvb.style.cursor = "default";
      cvb.textContent = "CV";
      cvb.title = "ComicVine item \u2014 cover can be fetched after saving";
      row.appendChild(cvb);
    }
    row.appendChild(bdMini("\u2191", "Move up", () => {
      if (j === 0) return;
      [sec.items[j - 1], sec.items[j]] = [sec.items[j], sec.items[j - 1]];
      bdTouch(); renderBuilder();
    }));
    row.appendChild(bdMini("\u2193", "Move down", () => {
      if (j >= sec.items.length - 1) return;
      [sec.items[j + 1], sec.items[j]] = [sec.items[j], sec.items[j + 1]];
      bdTouch(); renderBuilder();
    }));
    row.appendChild(bdMini("\u00d7", "Remove item", () => {
      sec.items.splice(j, 1);
      bdTouch(); renderBuilder();
    }, "rm"));
    list.appendChild(row);
  });
  card.appendChild(list);

  /* add item controls */
  const addRow = document.createElement("div");
  addRow.className = "b-row";
  addRow.style.marginTop = "8px";
  const cvBtn = document.createElement("button");
  cvBtn.className = "ghost";
  cvBtn.textContent = "+ From ComicVine";
  cvBtn.addEventListener("click", () => bdOpenCv(i));
  const manBtn = document.createElement("button");
  manBtn.className = "ghost";
  manBtn.textContent = "+ Manual item";
  manBtn.addEventListener("click", () => {
    const f = card.querySelector(".b-manual");
    f.hidden = !f.hidden;
  });
  addRow.appendChild(cvBtn);
  addRow.appendChild(manBtn);
  card.appendChild(addRow);

  const man = document.createElement("div");
  man.className = "b-manual";
  man.hidden = true;
  const mt = document.createElement("div");
  mt.className = "b-two";
  mt.appendChild(bdField("Label", "", (v) => { man.dataset.label = v; }, { placeholder: "e.g. Annual #1" }));
  mt.appendChild(bdField("Issue number", "", (v) => { man.dataset.num = v; }, { placeholder: "e.g. 1" }));
  man.appendChild(mt);
  const mt2 = document.createElement("div");
  mt2.className = "b-two";
  mt2.appendChild(bdField("Title (optional)", "", (v) => { man.dataset.title = v; }));
  mt2.appendChild(bdField("Series short name (optional)", "", (v) => { man.dataset.series = v; }, { placeholder: "auto if blank" }));
  man.appendChild(mt2);
  const addMan = document.createElement("button");
  addMan.className = "ghost";
  addMan.style.marginTop = "8px";
  addMan.textContent = "Add item";
  addMan.addEventListener("click", () => {
    const label = (man.dataset.label || "").trim();
    if (!label) return showToast("GIVE THE ITEM A LABEL");
    const num = (man.dataset.num || "").trim();
    sec.items.push({
      id: bdNextItemId(),
      label,
      ...(bdCleanTitle(man.dataset.title) ? { title: bdCleanTitle(man.dataset.title) } : {}),
      ...((man.dataset.series || "").trim() ? { series: man.dataset.series.trim() } : {}),
      ...(num ? { num } : {}),
    });
    bdTouch(); renderBuilder();
  });
  man.appendChild(addMan);
  card.appendChild(man);

  /* buy links */
  const blab = document.createElement("span");
  blab.className = "b-lab";
  blab.textContent = "Buy links (" + (sec.buy || []).length + ")";
  card.appendChild(blab);
  const bw = document.createElement("div");
  (sec.buy || []).forEach((b, k) => {
    const r = document.createElement("div");
    r.className = "b-buyrow";
    r.innerHTML = "<span style='flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>" + esc(b.label) + "</span>";
    r.appendChild(bdMini("\u00d7", "Remove link", () => { sec.buy.splice(k, 1); bdTouch(); renderBuilder(); }, "rm"));
    bw.appendChild(r);
  });
  card.appendChild(bw);
  const buyForm = document.createElement("div");
  buyForm.className = "b-two";
  buyForm.style.marginTop = "6px";
  const buyLabel = bdField("Link label", "", (v) => { buyForm.dataset.label = v; }, { placeholder: "e.g. Amazon \u2014 Vol. 1" });
  buyForm.appendChild(buyLabel);
  buyForm.appendChild(bdField("URL", "", (v) => { buyForm.dataset.url = v; }, { placeholder: "https://" }));
  card.appendChild(buyForm);
  const addBuy = document.createElement("button");
  addBuy.className = "ghost";
  addBuy.style.marginTop = "6px";
  addBuy.textContent = "Add link";
  addBuy.addEventListener("click", () => {
    const label = (buyForm.dataset.label || "").trim();
    const url = (buyForm.dataset.url || "").trim();
    if (!label || !/^https?:\/\//.test(url)) return showToast("LINK NEEDS A LABEL + http(s) URL");
    if (!sec.buy) sec.buy = [];
    sec.buy.push({ label, url });
    bdTouch(); renderBuilder();
  });
  card.appendChild(addBuy);

  return card;
}

function bdMini(text, title, fn, cls) {
  const b = document.createElement("button");
  b.className = "b-mini" + (cls ? " " + cls : "");
  b.textContent = text;
  b.title = title;
  b.addEventListener("click", fn);
  return b;
}

/* ---------- ComicVine modal ---------- */

function bdOpenCv(sectionIndex) {
  bdCvSection = sectionIndex;
  bdCvVol = null;
  bdCvIssues = [];
  let m = document.getElementById("cvModal");
  if (!m) {
    m = document.createElement("div");
    m.id = "cvModal";
    m.className = "modal";
    document.body.appendChild(m);
  }
  m.hidden = false;
  m.innerHTML =
    '<div class="modal-card b-cv">' +
    "<h3>Add from ComicVine</h3>" +
    '<div class="modal-sec">' +
    '<input id="cvq" class="b-input" type="text" placeholder="Search a series (e.g. Invincible)" autocomplete="off">' +
    '<div id="cvres" class="b-cvres"></div>' +
    '<div class="b-note" id="cvnote">Search for the series, then pick the volume.</div>' +
    "</div>" +
    '<div class="modal-row modal-close-row"><button id="cvClose" class="ghost">Close</button></div>' +
    "</div>";
  m.addEventListener("click", (e) => { if (e.target === m) bdCloseCv(); });
  document.getElementById("cvClose").addEventListener("click", bdCloseCv);
  const q = document.getElementById("cvq");
  let t = null;
  q.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => bdSearchVolumes(q.value), 550);
  });
  q.focus();
}

function bdCloseCv() {
  const m = document.getElementById("cvModal");
  if (m) m.hidden = true;
}

async function bdSearchVolumes(qs) {
  const box = document.getElementById("cvres");
  const note = document.getElementById("cvnote");
  qs = String(qs || "").trim();
  if (qs.length < 2) { box.innerHTML = ""; note.textContent = "Keep typing\u2026"; return; }
  note.textContent = "Searching\u2026";
  box.innerHTML = "";
  let data = {};
  try {
    data = await fetch("/api/cv/volumes?q=" + encodeURIComponent(qs)).then((r) => r.json());
  } catch {}
  if (data.error === "no-key") {
    note.textContent = "Add a ComicVine API key in Settings first (it powers both covers and this search).";
    return;
  }
  const rs = data.results || [];
  note.textContent = rs.length ? "Pick the right volume:" : "No volumes found \u2014 try a different search.";
  for (const v of rs) {
    const row = document.createElement("div");
    row.className = "b-cvrow";
    row.innerHTML =
      "<div style='flex:1;min-width:0'><div style='font-weight:600'>" + esc(v.name) + "</div>" +
      '<div class="y">' + esc([v.year, v.publisher, v.issues + " issues"].filter(Boolean).join(" \u00b7 ")) + "</div></div>";
    row.addEventListener("click", () => bdLoadIssues(v));
    box.appendChild(row);
  }
}

async function bdLoadIssues(vol) {
  const box = document.getElementById("cvres");
  const note = document.getElementById("cvnote");
  note.textContent = "Loading issues\u2026";
  box.innerHTML = "";
  bdCvVol = vol;
  let data = {};
  try {
    data = await fetch("/api/cv/issues?vol=" + encodeURIComponent(vol.id)).then((r) => r.json());
  } catch {}
  bdCvIssues = data.results || [];
  if (!bdCvIssues.length) {
    note.textContent = "No issues found for this volume.";
    return;
  }
  const have = new Set();
  for (const it of BD.sections[bdCvSection].items) if (it.cv) have.add(it.cv.i);

  const back = document.createElement("button");
  back.className = "b-mini";
  back.textContent = "\u2190 back to results";
  back.addEventListener("click", () => { document.getElementById("cvq").value = vol.name; bdSearchVolumes(vol.name); });
  box.appendChild(back);

  const ctl = document.createElement("div");
  ctl.className = "b-row";
  ctl.style.margin = "8px 0";
  ctl.innerHTML =
    '<span class="b-lab" style="margin:0">From</span> <input id="cvFrom" class="b-input" style="width:64px" type="text" inputmode="decimal">' +
    '<span class="b-lab" style="margin:0">to</span> <input id="cvTo" class="b-input" style="width:64px" type="text" inputmode="decimal">' +
    '<button id="cvRange" class="b-mini">Apply range</button>' +
    '<button id="cvAll" class="b-mini">All</button>' +
    '<button id="cvNone" class="b-mini">None</button>';
  box.appendChild(ctl);

  const listEl = document.createElement("div");
  listEl.id = "cvList";
  for (const iss of bdCvIssues) {
    const row = document.createElement("label");
    row.className = "b-cviss";
    const already = have.has(iss.i);
    row.innerHTML =
      '<input type="checkbox" data-i="' + iss.i + '"' + (already ? " disabled" : "") + ">" +
      "<span style='font-weight:600;min-width:44px'>#" + esc(iss.num) + "</span>" +
      "<span style='flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:" + (already ? "var(--dim)" : "inherit") + "'>" + esc(bdCleanTitle(iss.name) || "\u2014") + "</span>" +
      '<span class="y" style="color:var(--dim);font-size:11px">' + esc(iss.date || "") + (already ? " \u00b7 added" : "") + "</span>";
    listEl.appendChild(row);
  }
  box.appendChild(listEl);

  const addb = document.createElement("button");
  addb.className = "ghost primary";
  addb.style.marginTop = "10px";
  addb.textContent = "Add selected";
  addb.addEventListener("click", () => bdAddSelected(vol));
  box.appendChild(addb);
  note.textContent = "Select issues (or use a range), then Add.";

  document.getElementById("cvRange").addEventListener("click", () => {
    const f = parseFloat((document.getElementById("cvFrom").value || "").trim());
    const t = parseFloat((document.getElementById("cvTo").value || "").trim());
    if (isNaN(f) && isNaN(t)) return;
    listEl.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      const iss = bdCvIssues.find((x) => String(x.i) === cb.dataset.i);
      const n = iss ? parseFloat(iss.num) : NaN;
      cb.checked = !cb.disabled && !isNaN(n) && (isNaN(f) || n >= f) && (isNaN(t) || n <= t);
    });
  });
  document.getElementById("cvAll").addEventListener("click", () => listEl.querySelectorAll("input[type=checkbox]").forEach((cb) => { if (!cb.disabled) cb.checked = true; }));
  document.getElementById("cvNone").addEventListener("click", () => listEl.querySelectorAll("input[type=checkbox]").forEach((cb) => { cb.checked = false; }));
}

function bdAddSelected(vol) {
  const sec = BD.sections[bdCvSection];
  const picks = [...document.querySelectorAll("#cvList input[type=checkbox]")].filter((cb) => cb.checked && !cb.disabled);
  if (!picks.length) return showToast("NOTHING SELECTED");
  const abbr = bdAbbr(vol.name);
  let added = 0;
  for (const cb of picks) {
    const iss = bdCvIssues.find((x) => String(x.i) === cb.dataset.i);
    if (!iss) continue;
    sec.items.push({
      id: bdNextItemId(),
      label: abbr + " #" + iss.num,
      ...(bdCleanTitle(iss.name) ? { title: bdCleanTitle(iss.name) } : {}),
      series: abbr,
      seriesName: vol.name + (vol.year ? " (" + vol.year + ")" : ""),
      num: String(iss.num),
      cv: { v: vol.id, i: Number(iss.i) },
    });
    added++;
  }
  bdTouch();
  bdCloseCv();
  renderBuilder();
  showToast("ADDED " + added + " ITEM" + (added === 1 ? "" : "S"));
}

/* ---------- preview ---------- */

function bdTogglePreview() {
  let pv = document.getElementById("bdPreviewBlock");
  if (pv) { pv.remove(); return; }
  const wrap = document.querySelector("#view .builder");
  if (!wrap) return;
  pv = document.createElement("div");
  pv.id = "bdPreviewBlock";
  pv.className = "b-preview";
  const head = document.createElement("div");
  head.className = "b-preview-head";
  head.textContent = "Preview \u2014 this is how the order will look";
  pv.appendChild(head);
  for (const s of BD.sections) {
    const band = document.createElement("div");
    band.className = "era-band";
    band.style.setProperty("--era", s.color || "#546e7a");
    band.innerHTML =
      "<h2>" + esc(s.name || "Untitled section") + "</h2>" +
      (s.years ? '<span class="years">' + esc(s.years) + "</span>" : "") +
      '<span class="era-count">0 / ' + s.items.length + "</span>" +
      (s.tagline ? '<span class="tagline">' + esc(s.tagline) + "</span>" : "") +
      (s.buy && s.buy.length
        ? '<div class="era-buy"><span class="buy-label">Get it</span>' +
          s.buy.map((b) => '<a href="' + esc(b.url) + '" target="_blank" rel="noopener">' + esc(b.label) + "</a>").join("") +
          "</div>"
        : "");
    pv.appendChild(band);
    const list = document.createElement("div");
    list.className = "items";
    list.style.setProperty("--era", s.color || "#546e7a");
    for (const it of s.items) {
      const card = document.createElement("div");
      card.className = "item";
      card.style.setProperty("--era", s.color || "#546e7a");
      card.innerHTML =
        '<span class="dot"></span>' +
        '<div class="cover ph">' + esc(it.series || "") + "<br>" + esc(it.num || "") + "</div>" +
        '<div class="meta"><div class="label">' + esc(it.label) + "</div>" +
        (it.title ? '<div class="title">' + esc(it.title) + "</div>" : "") +
        '<div class="seriesline">' + esc(it.seriesName || "") + "</div></div>";
      list.appendChild(card);
    }
    pv.appendChild(list);
  }
  wrap.insertBefore(pv, wrap.querySelector(".b-bar"));
  pv.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- save ---------- */

function bdValidate() {
  if (!BD.title.trim()) return "GIVE THE ORDER A TITLE";
  if (!BD.sections.length) return "ADD AT LEAST ONE SECTION";
  const seen = new Set();
  for (const s of BD.sections) {
    if (!String(s.name || "").trim()) return "EVERY SECTION NEEDS A NAME";
    if (!s.items.length) return "\u201c" + (s.name || "SECTION") + "\u201d IS EMPTY \u2014 ADD ITEMS";
    for (const it of s.items) {
      if (seen.has(it.id)) return "DUPLICATE ITEM ID";
      seen.add(it.id);
    }
  }
  return null;
}

async function bdSaveOrder() {
  const err = bdValidate();
  if (err) return showToast(err);
  let base = bdSlug(BD.title);
  if (base.length < 3) base = "order-" + String(BD.draftId || "x").replace(/^d/, "").slice(0, 4);
  const payload = (id) => ({
    id,
    title: BD.title,
    subtitle: BD.subtitle,
    credit: BD.credit,
    sections: BD.sections.map((s) => ({
      id: s.id, name: s.name, years: s.years, color: s.color,
      ...(s.tagline ? { tagline: s.tagline } : {}),
      ...(s.buy && s.buy.length ? { buy: s.buy } : {}),
      items: s.items.map((it) => ({ ...it })),
    })),
  });
  try {
    let usedId = null;
    for (let i = 0; i <= 6; i++) {
      const trial = i === 0 ? base : base + "-" + (i + 1);
      const r = await fetch("/api/orders/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload(trial)),
      });
      const j = await r.json();
      if (r.ok) { usedId = trial; break; }
      if (j.error !== "id-taken") {
        const msg = {
          "no-title": "Give the order a title.",
          "bad-items": "Every section needs 1\u2013400 items.",
          "dupe-item-id": "Duplicate item id \u2014 remove the item and re-add it.",
        }[j.error] || ("SAVE FAILED: " + (j.error || "?"));
        return showToast(msg);
      }
    }
    if (!usedId) return showToast("SAVE FAILED \u2014 TRY A DIFFERENT TITLE");
    const draftId = BD.draftId;
    BD.draftId = null;
    clearTimeout(bdAutoTimer);
    if (draftId) {
      try { await fetch("/api/drafts/" + encodeURIComponent(draftId), { method: "DELETE" }); } catch {}
    }
    showToast(usedId === base ? "ORDER SAVED" : "ORDER SAVED AS " + usedId);
    location.hash = "#/o/" + usedId;
  } catch {
    showToast("SAVE FAILED \u2014 CHECK CONNECTION");
  }
}
