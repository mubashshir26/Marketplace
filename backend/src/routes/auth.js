const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

const User = require('../models/User');
const redis = require('../config/redis');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const REFRESH_TTL_SECONDS = Number(process.env.JWT_REFRESH_TTL_DAYS || 7) * 24 * 60 * 60;

function signAccess(user) {
  return jwt.sign({ role: user.role }, process.env.JWT_ACCESS_SECRET, {
    subject: String(user._id),
    expiresIn: process.env.JWT_ACCESS_TTL || '15m',
  });
}

async function issueRefresh(user) {
  const tokenId = crypto.randomUUID();
  const token = jwt.sign({ jti: tokenId }, process.env.JWT_REFRESH_SECRET, {
    subject: String(user._id),
    expiresIn: REFRESH_TTL_SECONDS,
  });
  await redis.set(`refresh:${user._id}:${tokenId}`, '1', 'EX', REFRESH_TTL_SECONDS);
  return token;
}

function checkValidation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array().map((e) => ({ field: e.path, msg: e.msg })) });
    return false;
  }
  return true;
}

router.post(
  '/register',
  [
    body('name').trim().notEmpty(),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    // Admins are never self-registered; they are seeded.
    body('role').optional().isIn(['customer', 'vendor']),
  ],
  async (req, res, next) => {
    try {
      if (!checkValidation(req, res)) return;
      const { name, email, password, role = 'customer' } = req.body;

      if (await User.exists({ email })) {
        return res.status(409).json({ error: 'Email already registered' });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await User.create({ name, email, passwordHash, role });

      res.status(201).json({
        user: user.toSafeJSON(),
        accessToken: signAccess(user),
        refreshToken: await issueRefresh(user),
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/login',
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  async (req, res, next) => {
    try {
      if (!checkValidation(req, res)) return;
      const user = await User.findOne({ email: req.body.email });
      const ok = user && (await bcrypt.compare(req.body.password, user.passwordHash));
      if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

      res.json({
        user: user.toSafeJSON(),
        accessToken: signAccess(user),
        refreshToken: await issueRefresh(user),
      });
    } catch (err) {
      next(err);
    }
  }
);

// Rotates the refresh token: the old one is revoked, a new pair is returned.
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });

    let payload;
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const key = `refresh:${payload.sub}:${payload.jti}`;
    const deleted = await redis.del(key);
    if (!deleted) return res.status(401).json({ error: 'Refresh token revoked' });

    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ error: 'User not found' });

    res.json({ accessToken: signAccess(user), refreshToken: await issueRefresh(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      try {
        const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        if (payload.sub === req.user.id) {
          await redis.del(`refresh:${payload.sub}:${payload.jti}`);
        }
      } catch {
        /* already invalid; nothing to revoke */
      }
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: user.toSafeJSON() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
