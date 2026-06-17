export function requireInternalToken(req, res, next) {
  if (req.headers["x-internal-token"] !== process.env.INTERNAL_TOKEN) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
}

