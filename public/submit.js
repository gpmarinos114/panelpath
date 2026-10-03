/* PanelPath — GitHub connect + submit (Phase B client). Globals from app.js: $, esc, showToast, CURRENT. */

let ghPollTimer = null;

async function ghStatus() {
  try {
    return await fetch("/api/github/status").then((r) => r.json());
  } catch {
    return {};
  }
}

async function renderGitHubSection() {
  const box = document.getElementById("ghBox");
  if (!box) return;
  clearInterval(ghPollTimer);
  ghPollTimer = null;
  const st = await ghStatus();
  box.innerHTML = "";

  if (st.connected) {
    const row = document.createElement("div");
    row.className = "gh-conn";
    const dot = document.createElement("span");
    dot.className = "gh-dot";
    const who = document.createElement("span");
    who.className = "gh-who";
    who.innerHTML = "Connected as <b>@" + esc(st.login || "?") + "</b>";
    const out = document.createElement("button");
    out.className = "ghost gh-disconnect";
    out.textContent = "Disconnect";
    out.addEventListener("click", async () => {
      await fetch("/api/github/disconnect", { method: "POST" });
      showToast("GITHUB DISCONNECTED");
      renderGitHubSection();
    });
    row.appendChild(dot);
    row.appendChild(who);
    row.appendChild(out);
    box.appendChild(row);
    return;
  }

  if (st.device) {
    const btn = document.createElement("button");
    btn.className = "ghost";
    btn.textContent = "Connect with GitHub";
    btn.addEventListener("click", startDeviceFlow);
    box.appendChild(btn);
  }

  const det = document.createElement("div");
  det.className = "gh-token";
  const lab = document.createElement("div");
  lab.className = "b-lab";
  lab.textContent = st.device ? "Or paste a personal access token" : "Connect with a personal access token";
  det.appendChild(lab);
  const inp = document.createElement("input");
  inp.type = "password";
  inp.autocomplete = "off";
  inp.placeholder = "paste token \u2014 stored on your server only";
  det.appendChild(inp);
  const row2 = document.createElement("div");
  row2.className = "modal-row";
  const save = document.createElement("button");
  save.className = "ghost";
  save.textContent = "Save token";
  save.addEventListener("click", async () => {
    const token = inp.value.trim();
    if (token.length < 20) return showToast("THAT DOESN'T LOOK LIKE A TOKEN");
    try {
      const r = await fetch("/api/github/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const j = await r.json();
      if (!r.ok) return showToast(j.error === "bad-token" ? "GITHUB DIDN'T ACCEPT THAT TOKEN" : "CONNECT FAILED");
      showToast("CONNECTED AS @" + j.login);
      renderGitHubSection();
    } catch {
      showToast("CONNECT FAILED");
    }
  });
  row2.appendChild(save);
  det.appendChild(row2);
  box.appendChild(det);

  const note = document.createElement("div");
  note.className = "modal-note";
  note.textContent = "Token needs access to public repositories (classic: \"public_repo\"). Stored on your server only.";
  box.appendChild(note);
}

async function startDeviceFlow() {
  const box = document.getElementById("ghBox");
  let j = null;
  try {
    const r = await fetch("/api/github/device/start", { method: "POST" });
    j = await r.json();
    if (!r.ok) throw new Error();
  } catch {
    return showToast("COULD NOT START \u2014 TRY THE TOKEN INSTEAD");
  }
  box.innerHTML =
    '<div class="gh-code">' + esc(j.user_code) + "</div>" +
    '<div class="gh-steps">Open <a href="' + esc(j.verification_uri) + '" target="_blank" rel="noopener">' + esc(j.verification_uri) + "</a> and enter this code.<br>This panel connects on its own once you approve.</div>" +
    '<div class="status-line" id="ghPollStatus" style="margin-top:8px">waiting for you\u2026</div>';
  const started = Date.now();
  ghPollTimer = setInterval(async () => {
    const statusEl = document.getElementById("ghPollStatus");
    if (!statusEl) {
      clearInterval(ghPollTimer);
      return;
    }
    if (Date.now() - started > (j.expires_in || 900) * 1000) {
      clearInterval(ghPollTimer);
      statusEl.textContent = "code expired \u2014 try again";
      return;
    }
    try {
      const pr = await fetch("/api/github/device/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: j.device_code }),
      });
      const pj = await pr.json().catch(() => ({}));
      if (pj.status === "connected") {
        clearInterval(ghPollTimer);
        showToast("CONNECTED AS @" + pj.login);
        renderGitHubSection();
      } else if (pj.status === "error") {
        clearInterval(ghPollTimer);
        statusEl.textContent = pj.error === "access_denied" ? "authorization denied on GitHub" : "error: " + String(pj.error);
      }
    } catch {}
  }, (j.interval || 5) * 1000);
}

async function openSubmitModal() {
  if (!CURRENT) return;
  let m = document.getElementById("submitModal");
  if (!m) {
    m = document.createElement("div");
    m.id = "submitModal";
    m.className = "modal";
    m.hidden = true;
    m.addEventListener("click", (e) => {
      if (e.target === m) m.hidden = true;
    });
    document.body.appendChild(m);
  }
  m.hidden = false;
  m.innerHTML =
    '<div class="modal-card">' +
    "<h3>Submit to PanelPath</h3>" +
    '<div class="modal-sec"><div id="smBody" class="gh-steps">Checking GitHub\u2026</div></div>' +
    '<div class="modal-row modal-close-row"><button id="smClose" class="ghost">Close</button></div>' +
    "</div>";
  document.getElementById("smClose").addEventListener("click", () => {
    m.hidden = true;
  });
  const body = document.getElementById("smBody");
  const st = await ghStatus();
  if (!st.connected) {
    body.innerHTML = "You need to connect GitHub first \u2014 open <b>Settings</b> \u2192 <b>Contribute</b> and connect. It takes a minute.";
    return;
  }
  body.textContent = "Opening a pull request as @" + (st.login || "you") + " \u2014 this can take a few seconds\u2026";
  try {
    const r = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: CURRENT.id }),
    });
    const j = await r.json();
    if (!r.ok) {
      const map = {
        "not-connected": "Connect GitHub first (Settings \u2192 Contribute).",
        "only-your-own": "Only orders you created in this app can be submitted.",
        "bad-order": "That order can\u2019t be submitted.",
        "fork-failed": "Couldn\u2019t create the fork \u2014 try again in a minute.",
      };
      body.innerHTML = esc(map[j.error] || ("Submit failed: " + String(j.error || "?")));
      return;
    }
    body.innerHTML =
      (j.updated ? "Updated the open pull request" : "Done \u2014 pull request opened") +
      ': <a href="' + esc(j.pr.url) + '" target="_blank" rel="noopener"><b>#' + j.pr.number + "</b></a>" +
      '<div class="modal-note" style="margin-top:6px">A maintainer will review it. Thanks for contributing!</div>';
  } catch {
    body.textContent = "Submit failed \u2014 check your connection and try again.";
  }
}
