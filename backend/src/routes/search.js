const express = require('express');
const { parseParams, search } = require('../services/search');

const router = express.Router();

// GET /api/search?q=&category=&minPrice=&maxPrice=&rating=&sort=&page=&limit=
router.get('/', async (req, res, next) => {
  try {
    res.json(await search(parseParams(req.query)));
  } catch (err) {
    if (err.meta?.body?.error?.type === 'index_not_found_exception') {
      return res.status(503).json({ error: 'Search index is missing. Run "npm run reindex" in the backend.' });
    }
    if (['ConnectionError', 'NoLivingConnectionsError', 'TimeoutError'].includes(err.name)) {
      return res.status(503).json({ error: 'Search is temporarily unavailable' });
    }
    next(err);
  }
});

module.exports = router;