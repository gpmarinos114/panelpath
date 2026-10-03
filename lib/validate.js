/* Shared order validation — used by server.js (save + submit) and by CI via tools/validate-order.mjs. */
function validateOrder(o) {
  if (!o || typeof o !== "object") return "bad-order";
  if (!/^[a-z0-9-]{3,40}$/.test(o.id || "")) return "bad-id";
  if (!String(o.title || "").trim()) return "no-title";
  if (!Array.isArray(o.sections) || !o.sections.length || o.sections.length > 40) return "bad-sections";
  const seen = new Set();
  let total = 0;
  for (const s of o.sections) {
    if (!String(s.name || "").trim() || String(s.name).length > 120) return "section-name";
    if (!/^#[0-9a-fA-F]{6}$/.test(s.color || "")) return "bad-color";
    if (!Array.isArray(s.items) || !s.items.length || s.items.length > 400) return "bad-items";
    total += s.items.length;
    for (const it of s.items) {
      if (!String(it.label || "").trim() || String(it.label).length > 160) return "item-label";
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(it.id || "")) return "bad-item-id";
      if (seen.has(it.id)) return "dupe-item-id";
      seen.add(it.id);
    }
    if (Array.isArray(s.buy)) {
      for (const b of s.buy) {
        if (!String(b.label || "").trim() || String(b.label).length > 80) return "buy-label";
        if (!/^https?:\/\//.test(b.url || "") || String(b.url).length > 500) return "bad-buy-url";
      }
    }
  }
  if (total > 2000) return "too-big";
  return null;
}

module.exports = { validateOrder };
