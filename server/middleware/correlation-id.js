import crypto from 'crypto';

export function correlationId(req, res, next) {
  const cid = req.get('x-correlation-id') || crypto.randomUUID();
  req.cid = cid;
  res.setHeader('x-correlation-id', cid);
  next();
}
