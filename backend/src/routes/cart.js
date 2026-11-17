const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { authenticate, authorize } = require('../middleware/auth');
const { MAX_QTY, getCart, addItem, setQty, removeItem, clearCart } = require('../services/cart');

const router = express.Router();
router.use(authenticate, authorize('customer'));

function ok(req, res) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return true;
  res.status(400).json({ errors: errors.array().map((e) => ({ field: e.path, msg: e.msg })) });
  return false;
}

router.get('/', async (req, res, next) => {
  try {
    res.json(await getCart(req.user.id));
  } catch (err) {
    next(err);
  }
});

router.post(
  '/items',
  [body('productId').isMongoId(), body('qty').optional().isInt({ min: 1, max: MAX_QTY }).toInt()],
  async (req, res, next) => {
    try {
      if (!ok(req, res)) return;
      await addItem(req.user.id, req.body.productId, req.body.qty || 1);
      res.json(await getCart(req.user.id));
    } catch (err) {
      next(err);
    }
  }
);

// qty 0 removes the item.
router.patch(
  '/items/:productId',
  [param('productId').isMongoId(), body('qty').isInt({ min: 0, max: MAX_QTY }).toInt()],
  async (req, res, next) => {
    try {
      if (!ok(req, res)) return;
      await setQty(req.user.id, req.params.productId, req.body.qty);
      res.json(await getCart(req.user.id));
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/items/:productId', [param('productId').isMongoId()], async (req, res, next) => {
  try {
    if (!ok(req, res)) return;
    await removeItem(req.user.id, req.params.productId);
    res.json(await getCart(req.user.id));
  } catch (err) {
    next(err);
  }
});

router.delete('/', async (req, res, next) => {
  try {
    await clearCart(req.user.id);
    res.json(await getCart(req.user.id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;