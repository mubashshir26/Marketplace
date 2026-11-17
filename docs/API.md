# API reference

Base URL: `http://localhost:5000/api` (locally). JSON in, JSON out. Protected routes need `Authorization: Bearer <accessToken>`.
Errors look like `{ "error": "message" }` with the right status code (400 validation, 401 not logged in, 403 wrong role, 404, 409 conflict, 502 payment gateway).

Roles: **public**, **any** (logged in), **customer**, **vendor** (approved shop), **admin**.

## Auth
| Method | Path | Who | Notes |
|--------|------|-----|-------|
| POST | /auth/register | public | `name, email, password (8+ chars), role` where role is `customer` or `vendor` |
| POST | /auth/login | public | returns `accessToken`, `refreshToken`, `user` |
| POST | /auth/refresh | public | rotates the refresh token. The old one stops working |
| POST | /auth/logout | any | revokes the refresh token |
| GET | /auth/me | any | current user |

## Vendors
| Method | Path | Who | Notes |
|--------|------|-----|-------|
| GET | /vendors/ping | vendor | role check |
| GET | /vendors/me | vendor | own shop and approval status |
| POST | /vendors/onboard | vendor | `shopName (2-80), description (max 500)`. Status starts as `pending` |

## Admin
| Method | Path | Notes |
|--------|------|-------|
| GET | /admin/ping | role check |
| GET | /admin/vendors?status= | list vendors, filter by `pending`, `approved`, `rejected` |
| PATCH | /admin/vendors/:id/status | `{ "status": "approved" }` or `rejected` |
| GET | /admin/analytics?days=7\|30\|90 | GMV, commission, average order, discounts, units, payouts due, refunds due, daily series, status counts, top 5 vendors and products |

## Products
| Method | Path | Who | Notes |
|--------|------|-----|-------|
| GET | /products | public | simple list from MongoDB |
| GET | /products/mine | vendor | own products |
| GET | /products/:id | public | one product |
| POST | /products/upload | vendor | multipart `image`. Returns the stored image URL (local disk or S3) |
| POST | /products | vendor | `name, description, category, price, stock, images[]` |
| PUT | /products/:id | vendor | own products only |
| DELETE | /products/:id | vendor | own products only |

## Search (Elasticsearch)
`GET /search` with query parameters:

| Param | Meaning |
|-------|---------|
| q | text, fuzzy match on name, description, category |
| category | exact category |
| minPrice, maxPrice | price range |
| rating | minimum average rating |
| sort | `relevance` (default), `newest`, `price_asc`, `price_desc`, `rating` |
| page, limit | default page 1, limit 12, max 50 |

The response has `products`, `total`, `page`, `pages` and `categories` (counts for the filter list). Answers 503 if Elasticsearch is down.

## Reviews
Base: `/products/:productId/reviews`

| Method | Path | Who | Notes |
|--------|------|-----|-------|
| GET | / | public | reviews and rating summary |
| GET | /mine | customer | your review and whether you are allowed to write one |
| PUT | / | customer | `{ rating 1-5, comment }`. Needs a delivered order with this product. Creates or updates your single review |
| DELETE | /:reviewId | customer (own) or admin | |

## Cart (customer, stored in Redis)
| Method | Path | Notes |
|--------|------|-------|
| GET | /cart | items with fresh price and stock, plus totals |
| POST | /cart/items | `{ productId, qty }` (1-20) |
| PATCH | /cart/items/:productId | `{ qty }` |
| DELETE | /cart/items/:productId | remove one item |
| DELETE | /cart | empty the cart |

## Coupons
| Method | Path | Who | Notes |
|--------|------|-----|-------|
| POST | /coupons/preview | customer | `{ code }`. Shows the discount on the current cart without using the coupon |
| GET | /coupons/mine | vendor | own coupons |
| POST | /coupons | vendor | `code, type (percent/flat), value, minOrder, maxDiscount, usageLimit, expiresAt` |
| PATCH | /coupons/:id | vendor | edit or pause |
| DELETE | /coupons/:id | vendor | |

## Checkout
| Method | Path | Who | Notes |
|--------|------|-----|-------|
| POST | /checkout | customer | `{ paymentMethod: "cod" or "online", couponCode?, shippingAddress: {name, phone, line1, line2?, city, state, pincode} }`. COD creates `placed` orders and empties the cart. Online creates `pending_payment` orders and returns `{ groupId, orders, payment: { keyId, orderId, amount, currency } }` for the Razorpay window. Phone must be a 10-digit Indian mobile, pincode 6 digits |
| POST | /checkout/verify | customer | `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }`. Checks the signature, marks the orders paid, empties the cart. Returns `{ groupId }` |
| POST | /checkout/:groupId/cancel | customer | used when the payment window is closed. Returns stock |

## Orders
| Method | Path | Who | Notes |
|--------|------|-----|-------|
| GET | /orders | customer | own orders (newest first) |
| GET | /orders/vendor | vendor | orders of the own shop |
| GET | /orders/:id | owner, shop or admin | |
| GET | /orders/:id/invoice | owner, shop or admin | PDF download. 409 for unpaid or cancelled orders |
| POST | /orders/:id/cancel | customer (while `placed`) | returns stock and coupon, refunds if paid online |
| PATCH | /orders/:id/status | vendor or admin | `{ status }` moves forward one step (packed, shipped, delivered) or cancels. 409 for `pending_payment` |

## Payments webhook
`POST /payments/webhook`. Called by Razorpay, not by the frontend. The raw body is checked against the `X-Razorpay-Signature` header with `RAZORPAY_WEBHOOK_SECRET`. Events used: `payment.captured`, `order.paid`. Always answers 200 for unknown orders so Razorpay does not retry forever. It needs a public URL (see [DEPLOYMENT.md](DEPLOYMENT.md)).

## Other
| Method | Path | Notes |
|--------|------|-------|
| GET | /health | `{ ok: true }`. Used by the host as a health check |
| GET | /uploads/... | images stored on local disk (only when `STORAGE=local`) |
