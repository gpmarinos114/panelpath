/* PanelPath — My comics (collection). Uses globals from app.js: $, esc, showToast, setHeader, armTwice, CURRENT. */

let COLE = [];
let COL_TOTALS = { count: 0, spent: 0, priced: 0, physical: 0, digital: 0, both: 0 };
let colQuery = "";
let colFilter = "all";
let colPickState = null; // {cv:{v,i}, label, seriesName, num} selected ComicVine item in the add modal

function fmtMoney(n) {
  return "$" + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

async function showCollection() {
  CURRENT = null;
  setHeader({
    title: "My comics",
    sub: "What you\u2019ve bought, what you paid, and whether it\u2019s on the shelf or on a screen.",
    back: true,
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

  await colLoad();
  colRender();
}

async function colLoad() {
  try {
    const d = await fetch("/api/collection").then((r) => r.json());
    COLE = Array.isArray(d.entries) ? d.entries : [];
    COL_TOTALS = d.totals || { count: COLE.length, spent: 0, priced: 0, physical: 0, digital: 0, both: 0 };
  } catch {
    COLE = [];
    COL_TOTALS = { count: 0, spent: 0, priced: 0, physical: 0, digital: 0, both: 0 };
    showToast("COULD NOT LOAD YOUR COMICS");
  }
}

function colRender() {
  const view = $("#view");
  view.innerHTML = "";

  const t = COL_TOTALS;
  const fmtCounts =
    [t.physical ? t.physical + " physical" : "", t.digital ? t.digital + " digital" : "", t.both ? t.both + " both" : ""]
      .filter(Boolean)
      .join(" \u00b7 ") || "\u2014";

  const stats = document.createElement("div");
  stats.className = "col-stats";
  stats.innerHTML =
    '<div class="col-stat"><span class="cs-lab">Comics</span><span class="cs-val">' + (t.count || 0) + "</span></div>" +
    '<div class="col-stat"><span class="cs-lab">Spent</span><span class="cs-val">' + fmtMoney(t.priced ? t.spent : 0) + "</span>" +
      (t.priced && t.priced < (t.count || 0) ? '<span class="cs-sub">' + t.priced + " of " + t.count + " priced</span>" : "") +
    "</div>" +
    '<div class="col-stat"><span class="cs-lab">Owned as</span><span class="cs-val cs-small">' + esc(fmtCounts) + "</span></div>";
  view.appendChild(stats);

  const tools = document.createElement("div");
  tools.className = "col-tools";
  const addB = document.createElement("button");
  addB.className = "ghost primary";
  addB.textContent = "+ Add comic";
  addB.addEventListener("click", () => colOpenAdd());
  tools.appendChild(addB);
  if (COLE.length) {
    const exp = document.createElement("a");
    exp.className = "col-export";
    exp.href = "/api/collection/export.csv";
    exp.textContent = "Export CSV";
    tools.appendChild(exp);
  }
  view.appendChild(tools);

  if (!COLE.length) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.textContent =
      "Nothing here yet. Add a comic and it will show up with its cover, what you paid, and whether you own it physically or digitally.";
    view.appendChild(note);
    return;
  }

  const search = document.createElement("div");
  search.className = "lib-search";
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Search your comics\u2026";
  input.setAttribute("aria-label", "Search your comics");
  input.value = colQuery;
  input.addEventListener("input", () => {
    colQuery = input.value;
    colRenderList();
  });
  search.appendChild(input);
  view.appendChild(search);

  const chips = document.createElement("div");
  chips.className = "col-chips";
  const mkChip = (label, val) => {
    const b = document.createElement("button");
    b.className = "chip toggle";
    b.setAttribute("aria-pressed", String(colFilter === val));
    b.textContent = label;
    b.addEventListener("click", () => {
      colFilter = val;
      colRender();
    });
    return b;
  };
  chips.appendChild(mkChip("All", "all"));
  chips.appendChild(mkChip("Physical", "physical"));
  chips.appendChild(mkChip("Digital", "digital"));
  chips.appendChild(mkChip("Both", "both"));
  view.appendChild(chips);

  const grid = document.createElement("div");
  grid.className = "col-grid";
  grid.id = "colGrid";
  view.appendChild(grid);
  colRenderList();
}

function colRenderList() {
  const grid = document.getElementById("colGrid");
  if (!grid) return;
  grid.innerHTML = "";
  const q = colQuery.trim().toLowerCase();
  let list = COLE.slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  if (colFilter !== "all") list = list.filter((e) => e.format === colFilter);
  if (q) {
    list = list.filter((e) => ((e.label || "") + " " + (e.seriesName || "") + " " + (e.num || "")).toLowerCase().includes(q));
  }
  if (!list.length) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.textContent = "Nothing matches.";
    grid.appendChild(note);
    return;
  }
  for (const e of list) {
    const card = document.createElement("div");
    card.className = "col-card";
    const img = e.hasCover
      ? '<img loading="lazy" src="covers/collection/' + encodeURIComponent(e.id) + '.jpg" alt="">'
      : '<div class="cc-ph">' + esc(e.num ? "#" + e.num : "no cover") + "</div>";
    const bits = [];
    bits.push(e.format === "both" ? "Physical + digital" : e.format === "digital" ? "Digital" : "Physical");
    if (typeof e.price === "number") bits.push(fmtMoney(e.price));
    if (e.date) bits.push(e.date);
    card.innerHTML =
      '<div class="cc-imgwrap">' + img + "</div>" +
      '<div class="cc-label">' + esc(e.label) + "</div>" +
      '<div class="cc-meta">' + esc(bits.join(" \u00b7 ")) + "</div>";
    card.addEventListener("click", () => colOpenEdit(e.id));
    grid.appendChild(card);
  }
}

/* ---------- modal shell ---------- */

function colModalEl() {
  let m = document.getElementById("colModal");
  if (!m) {
    m = document.createElement("div");
    m.id = "colModal";
    m.className = "modal";
    m.hidden = true;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => {
      if (e.target === m) colClose();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !m.hidden) colClose();
    });
  }
  return m;
}

function colClose() {
  const m = colModalEl();
  m.hidden = true;
  m.innerHTML = "";
  colPickState = null;
}

function colFieldsHtml(vals, manual) {
  const fmtBtn = (f, label) =>
    '<button type="button" class="chip toggle" data-f="' + f + '" aria-pressed="' + (vals.format === f) + '">' + label + "</button>";
  return (
    (manual
      ? '<span class="b-lab">Title</span><input id="colTitle" class="b-input" type="text" placeholder="e.g. Batman: Year One" autocomplete="off">'
      : "") +
    '<span class="b-lab">Format</span>' +
    '<div class="col-mode" id="colMode">' +
    fmtBtn("physical", "Physical") + fmtBtn("digital", "Digital") + fmtBtn("both", "Both") +
    "</div>" +
    '<div class="b-two" style="margin-top:10px">' +
    '<div><span class="b-lab">Price paid (optional)</span><input id="colPrice" class="b-input" type="text" inputmode="decimal" placeholder="e.g. 12.99" value="' +
    esc(vals.price) + '"></div>' +
    '<div><span class="b-lab">Date (optional)</span><input id="colDate" class="b-input" type="date" value="' + esc(vals.date) + '"></div>' +
    "</div>" +
    '<span class="b-lab">Note (optional)</span><input id="colNote" class="b-input" type="text" placeholder="e.g. reading copy, signed" value="' +
    esc(vals.note) + '">'
  );
}

function colWireFormatChips(root) {
  const box = root.querySelector("#colMode");
  if (!box) return;
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]");
    if (!b) return;
    box.querySelectorAll("button[data-f]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  });
}

function colReadFields(root) {
  const mode = root.querySelector("#colMode button[aria-pressed='true']");
  const priceRaw = (root.querySelector("#colPrice") || {}).value || "";
  const cleaned = priceRaw.replace(/[$,\s]/g, "");
  let price = null;
  if (cleaned) {
    const n = Number(cleaned);
    if (!isFinite(n) || n < 0) return { error: "That price doesn\u2019t look right." };
    price = n;
  }
  return {
    body: {
      format: mode ? mode.dataset.f : "physical",
      price,
      date: (root.querySelector("#colDate") || {}).value || "",
      note: (root.querySelector("#colNote") || {}).value || "",
    },
  };
}

/* ---------- add ---------- */

function colOpenAdd() {
  const m = colModalEl();
  colPickState = null;
  m.hidden = false;
  m.innerHTML =
    '<div class="modal-card b-cv">' +
    "<h3>Add a comic</h3>" +
    '<div class="modal-sec" id="colSearchSec">' +
    '<input id="colq" class="b-input" type="text" placeholder="Search a series or book (e.g. Batman: Year One)" autocomplete="off">' +
    '<div id="colres" class="b-cvres"></div>' +
    '<div class="b-note" id="colnote">Search ComicVine, then pick the exact issue or book.</div>' +
    "</div>" +
    '<div class="modal-sec" id="colFields" hidden>' +
    '<div class="b-note" id="colpick" style="margin:0 0 4px"></div>' +
    colFieldsHtml({ format: "physical", price: "", date: todayStr(), note: "" }, false) +
    '<div class="modal-sec" id="colManualTitle" hidden style="margin-top:10px">' +
    '<span class="b-lab">Title</span><input id="colTitle" class="b-input" type="text" placeholder="e.g. Batman: Year One" autocomplete="off">' +
    "</div>" +
    "</div>" +
    '<div class="modal-row modal-close-row" style="margin-top:14px">' +
    '<button id="colAdd" class="ghost primary" hidden>Add</button>' +
    '<button id="colManual" class="ghost">Add without ComicVine</button>' +
    '<button id="colCancel" class="ghost">Close</button>' +
    "</div>" +
    "</div>";

  document.getElementById("colCancel").addEventListener("click", colClose);
  document.getElementById("colAdd").addEventListener("click", colSubmitAdd);
  document.getElementById("colManual").addEventListener("click", colManualMode);
  colWireFormatChips(m.querySelector(".modal-card"));

  const q = document.getElementById("colq");
  let t = null;
  q.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => colSearchVolumes(q.value), 550);
  });
  q.focus();
}

function colManualMode() {
  const m = colModalEl();
  const searchSec = m.querySelector("#colSearchSec");
  const fields = m.querySelector("#colFields");
  searchSec.hidden = true;
  fields.hidden = false;
  m.querySelector("#colManualTitle").hidden = false;
  m.querySelector("#colpick").textContent = "Manual entry";
  m.querySelector("#colAdd").hidden = false;
  const t = m.querySelector("#colTitle");
  if (t) t.focus();
}

async function colSearchVolumes(qs) {
  const box = document.getElementById("colres");
  const note = document.getElementById("colnote");
  if (!box) return;
  qs = String(qs || "").trim();
  if (qs.length < 2) {
    box.innerHTML = "";
    note.textContent = "Keep typing\u2026";
    return;
  }
  note.textContent = "Searching\u2026";
  box.innerHTML = "";
  let data = {};
  try {
    data = await fetch("/api/cv/volumes?q=" + encodeURIComponent(qs)).then((r) => r.json());
  } catch {}
  if (data.error === "no-key") {
    note.textContent = "Add a ComicVine API key in Settings first (it powers search and covers). You can still use Add without ComicVine.";
    return;
  }
  const rs = data.results || [];
  note.textContent = rs.length ? "Pick the right volume:" : "No volumes found \u2014 try a different search, or add it manually.";
  for (const v of rs) {
    const row = document.createElement("div");
    row.className = "b-cvrow";
    row.innerHTML =
      "<div style='flex:1;min-width:0'><div style='font-weight:600'>" + esc(v.name) + "</div>" +
      '<div class="y">' + esc([v.year, v.publisher, v.issues + " issues"].filter(Boolean).join(" \u00b7 ")) + "</div></div>";
    row.addEventListener("click", () => colLoadIssues(v));
    box.appendChild(row);
  }
}

async function colLoadIssues(vol) {
  const box = document.getElementById("colres");
  const note = document.getElementById("colnote");
  note.textContent = "Loading issues\u2026";
  box.innerHTML = "";
  let data = {};
  try {
    data = await fetch("/api/cv/issues?vol=" + encodeURIComponent(vol.id)).then((r) => r.json());
  } catch {}
  const issues = data.results || [];
  if (!issues.length) {
    note.textContent = "No issues found for this volume.";
    return;
  }
  const back = document.createElement("button");
  back.className = "b-mini";
  back.textContent = "\u2190 back to results";
  back.addEventListener("click", () => {
    document.getElementById("colq").value = vol.name;
    colSearchVolumes(vol.name);
  });
  box.appendChild(back);
  for (const iss of issues) {
    const row = document.createElement("div");
    row.className = "b-cvrow col-pickrow";
    row.innerHTML =
      "<span style='font-weight:600;min-width:44px'>#" + esc(iss.num) + "</span>" +
      "<span style='flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>" +
      esc(iss.name || "\u2014") + "</span>" +
      '<span class="y" style="color:var(--dim);font-size:11px">' + esc(iss.date || "") + "</span>";
    row.addEventListener("click", () => colPickIssue(vol, iss, row));
    box.appendChild(row);
  }
  note.textContent = "Pick the exact issue or book you bought.";
}

function colPickIssue(vol, iss, rowEl) {
  const m = colModalEl();
  const issues = m.querySelectorAll(".col-pickrow");
  issues.forEach((r) => r.classList.remove("sel"));
  if (rowEl) rowEl.classList.add("sel");
  const single = (vol.issues || 0) <= 1;
  const label = vol.name + (single || !iss.num ? "" : " #" + iss.num);
  colPickState = {
    cv: { v: vol.id, i: Number(iss.i) },
    label: label,
    seriesName: vol.name + (vol.year ? " (" + vol.year + ")" : ""),
    num: String(iss.num || ""),
  };
  const fields = m.querySelector("#colFields");
  fields.hidden = false;
  m.querySelector("#colManualTitle").hidden = true;
  m.querySelector("#colpick").textContent = "Picked: " + label + (iss.date ? " \u00b7 " + iss.date : "");
  m.querySelector("#colAdd").hidden = false;
  const box = document.getElementById("colres");
  if (box) box.scrollTop = 0;
}

async function colSubmitAdd() {
  const m = colModalEl();
  const root = m.querySelector(".modal-card");
  const fields = colReadFields(root);
  if (fields.error) return showToast(fields.error);
  const body = fields.body;
  if (colPickState) {
    body.label = colPickState.label;
    body.seriesName = colPickState.seriesName;
    body.num = colPickState.num;
    body.cv = colPickState.cv;
  } else {
    body.label = ((root.querySelector("#colTitle") || {}).value || "").trim();
    if (!body.label) return showToast("GIVE IT A TITLE");
  }
  const btn = root.querySelector("#colAdd");
  btn.disabled = true;
  btn.textContent = "Saving\u2026";
  try {
    const r = await fetch("/api/collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error();
    colClose();
    showToast("ADDED");
    await colLoad();
    colRender();
  } catch {
    btn.disabled = false;
    btn.textContent = "Add";
    showToast("COULD NOT SAVE");
  }
}

/* ---------- edit drawer ---------- */

function colOpenEdit(id) {
  const e = COLE.find((x) => x.id === id);
  if (!e) return;
  const m = colModalEl();
  m.hidden = false;
  m.innerHTML =
    '<div class="modal-card b-cv">' +
    "<h3>Edit comic</h3>" +
    '<div class="col-edit-head">' +
    '<div class="cc-thumb">' +
    (e.hasCover
      ? '<img src="covers/collection/' + encodeURIComponent(e.id) + '.jpg" alt="">'
      : '<div class="cc-ph">no cover</div>') +
    "</div>" +
    '<div class="col-edit-info">' +
    '<span class="b-lab">Title</span><input id="colTitle" class="b-input" type="text" value="' + esc(e.label) + '" autocomplete="off">' +
    colFieldsHtml(
      { format: e.format, price: e.price == null ? "" : e.price.toFixed(2), date: e.date || "", note: e.note || "" },
      false
    ) +
    (e.seriesName ? '<div class="b-note">' + esc(e.seriesName) + (e.num ? " \u00b7 #" + esc(e.num) : "") + "</div>" : "") +
    "</div>" +
    "</div>" +
    '<div class="modal-row" style="margin-top:14px">' +
    '<button id="colSave" class="ghost primary">Save</button>' +
    (!e.hasCover && e.cv ? '<button id="colCover" class="ghost">Retry cover</button>' : "") +
    '<button id="colRemove" class="ghost danger">Remove</button>' +
    '<button id="colCancel" class="ghost" style="margin-left:auto">Close</button>' +
    "</div>" +
    "</div>";

  document.getElementById("colCancel").addEventListener("click", colClose);
  colWireFormatChips(m.querySelector(".modal-card"));
  document.getElementById("colSave").addEventListener("click", () => colSaveEdit(e.id));
  const rm = document.getElementById("colRemove");
  rm.addEventListener("click", () => armTwice(rm, "Tap again to remove", () => colRemove(e.id)));
  const cb = document.getElementById("colCover");
  if (cb) {
    cb.addEventListener("click", async () => {
      cb.disabled = true;
      cb.textContent = "Fetching\u2026";
      try {
        const r = await fetch("/api/collection/" + encodeURIComponent(e.id) + "/cover", { method: "POST" });
        const j = await r.json();
        if (j.hasCover) {
          showToast("COVER ADDED");
          await colLoad();
          colClose();
          colRender();
        } else {
          cb.disabled = false;
          cb.textContent = "Retry cover";
          showToast("NO COVER FOUND");
        }
      } catch {
        cb.disabled = false;
        cb.textContent = "Retry cover";
        showToast("COULD NOT FETCH");
      }
    });
  }
}

async function colSaveEdit(id) {
  const m = colModalEl();
  const root = m.querySelector(".modal-card");
  const fields = colReadFields(root);
  if (fields.error) return showToast(fields.error);
  const body = fields.body;
  body.label = ((root.querySelector("#colTitle") || {}).value || "").trim();
  if (!body.label) return showToast("GIVE IT A TITLE");
  const btn = document.getElementById("colSave");
  btn.disabled = true;
  btn.textContent = "Saving\u2026";
  try {
    const r = await fetch("/api/collection/" + encodeURIComponent(id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error();
    colClose();
    showToast("SAVED");
    await colLoad();
    colRender();
  } catch {
    btn.disabled = false;
    btn.textContent = "Save";
    showToast("COULD NOT SAVE");
  }
}

async function colRemove(id) {
  try {
    const r = await fetch("/api/collection/" + encodeURIComponent(id), { method: "DELETE" });
    if (!r.ok) throw new Error();
    colClose();
    showToast("REMOVED");
    await colLoad();
    colRender();
  } catch {
    showToast("COULD NOT REMOVE");
  }
}
