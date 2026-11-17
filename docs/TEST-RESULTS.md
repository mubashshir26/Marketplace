# Test results

Run from `backend/`: `npm test` (Node's built-in test runner, no database, Redis or Elasticsearch needed).

**Result: 49 tests, 49 passed, 0 failed** (about 3.5 seconds). The frontend production build also succeeds (`npm run build`).

| File | Tests | What it checks |
|------|-------|----------------|
| rbac.test.js | 5 | Requests without a token or with a tampered token are refused; customer, vendor and admin can only reach their own routes |
| step3.test.js | 6 | Vendor onboarding and admin approval, pending vendors cannot add products, product CRUD with ownership, product writes still work when Elasticsearch is down, image upload (stores, serves, rejects wrong file types) |
| search.test.js | 4 | Query cleaning and limits, fuzzy text query, filters, sorting and paging, and the search endpoint output with category counts |
| orders.test.js | 8 | Cart rules and stock limits, checkout validation, one order per shop, rollback when stock runs out, double-click lock, who can see which order, status moves with permissions, cancel restocks |
| payments.test.js | 11 | Online checkout reserves stock and keeps the cart, bad signature refused, paying twice changes nothing, commission split, Route transfer and its failure, webhook signature, window close and expiry release stock, refund on cancel and refund failure flagged, gateway failure, missing keys, cash on delivery commission |
| step7a.test.js | 10 | Reviews (only after delivery, rating validation, public list, delete rules, average and search index update) and coupons (validation, preview, caps, expiry, vendor-only discount, one use per customer, usage limit, online checkout discount, given back on cancel or failure) |
| step7b.test.js | 5 | Invoice PDF access and multi-page layout, admin analytics (admin only, totals, top lists, daily series), CORS with several origins |

## How the tests work, and what they do not prove

The tests replace MongoDB, Redis, Elasticsearch and the Razorpay API with in-memory fakes. This makes them fast and repeatable, and they check the business rules. They do **not** prove that the real services behave the same way. Before the demo, run through the main flow once against the real stack (see "Try the main flow" in the README). Razorpay payments were tested by hand in test mode (the payment window opens and a payment completes).

## Performance and accuracy numbers

No load-test or search-accuracy numbers are included here because none have been measured. Make them on your own machine, with the real Docker stack, so the numbers are honest. For example:

- API speed: `npx autocannon -c 20 -d 10 "http://localhost:5000/api/search?q=phone"` reports requests per second and latency.
- Search with and without Elasticsearch: time the same query on `/api/search` and on `/api/products`.
- Search quality: pick 10 queries, mark which results you expect in the top 5, and count how many hit.

Paste the results into this file before the presentation.
