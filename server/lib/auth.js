// server/lib/auth.js
// Unified auth middleware for all three lanes

export function bearer(expected, alsoHeader) {
  return (req, res, next) => {
    const hAuth = req.get("authorization") || "";
    const token = hAuth.toLowerCase().startsWith("bearer ") ? hAuth.slice(7).trim() : "";
    const alt = alsoHeader ? (req.get(alsoHeader) || "") : "";
    const ok = (!!expected && (token === expected || alt === expected));
    if (!ok) return res.status(401).json({ ok: false, error: "unauthorized" });
    return next();
  };
}
