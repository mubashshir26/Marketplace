# Multi-Vendor Marketplace

**Demo video:** [Watch the demo walkthrough](https://drive.google.com/file/d/1ilwpujnCaw2IZprTtSm_UIyLQDCc423D/view?usp=sharing)

A marketplace with three roles (customer, vendor, admin). Several shops sell on one site, a customer checks out once, and each shop gets its own order, its own payout and its own invoice.

**Stack:** React (Vite), Node.js + Express, MongoDB, Redis, Elasticsearch, AWS S3 (optional), Razorpay test mode.

## What works

| Step | Feature | Status |
|------|---------|--------|
| 1 | Roles, schema, API list, architecture | Done, see `docs/` |
| 2 | JWT auth (access + rotating refresh tokens), role-based access | Done |
| 3 | Vendor onboarding with admin approval, product CRUD, image upload (local or S3) | Done |
| 4 | Elasticsearch search: fuzzy text, category / price / rating filters, sorting, pagination | Done |
| 5 | Redis cart, checkout (one order per shop), order lifecycle, cancel with stock restore | Done |
| 6 | Razorpay test mode: online payment, signature check, webhook, refunds, commission split | Done |
| 7 | Verified-purchase reviews, vendor coupons, PDF invoices, admin analytics, separate deploys | Done |

## Documentation

- [Architecture and diagrams](docs/ARCHITECTURE.md)
- [Database schema](docs/SCHEMA.md)
- [API reference](docs/API.md)
- [Deployment guide](docs/DEPLOYMENT.md)
- [Test results](docs/TEST-RESULTS.md)

## Run it locally (Windows / Mac / Linux)

You need Node 20 or newer and Docker Desktop.

```powershell
# 1. Start MongoDB, Redis and Elasticsearch
docker compose up -d

# 2. Backend
cd backend
copy .env.example .env      # Mac/Linux: cp .env.example .env
npm install
npm run seed                # demo admin, vendors and products
npm run reindex             # copy products into Elasticsearch (the seed does not do this)
npm run dev                 # http://localhost:5000/api/health

# 3. Frontend (new terminal)
cd frontend
copy .env.example .env
npm install
npm run dev                 # http://localhost:5173
```

Elasticsearch needs about a minute to start. If `npm run reindex` fails, wait and run it again. If you change `.env`, restart the backend: `node --watch` does not watch that file.

### Demo accounts (created by `npm run seed`)

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@example.com | Admin@12345 |
| Vendors | vendor1@example.com ... vendor4@example.com | Vendor@123 |

Customers sign up on the site. Admins cannot be created from the sign-up form, only by the seed.

### Environment variables (`backend/.env`)

| Variable | Needed for | Notes |
|----------|-----------|-------|
| PORT | | default 5000 |
| CLIENT_ORIGIN | CORS | frontend URL, several allowed separated by commas |
| MONGO_URI, REDIS_URL, ELASTICSEARCH_URL | data | defaults match `docker-compose.yml` |
| ELASTICSEARCH_API_KEY | Elastic Cloud only | leave empty locally |
| JWT_ACCESS_SECRET, JWT_REFRESH_SECRET | auth | use long random values outside local testing |
| JWT_ACCESS_TTL, JWT_REFRESH_TTL_DAYS | auth | 15m and 7 |
| STORAGE | images | `local` (backend/uploads) or `s3` |
| PUBLIC_URL | local images | public address of the API |
| AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY | S3 | only when `STORAGE=s3` |
| RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET | online payment | test keys (`rzp_test_...`). Without them only cash on delivery works |
| RAZORPAY_WEBHOOK_SECRET | webhook | needs a public URL, see the deployment guide |
| COMMISSION_PERCENT | split | platform cut, default 10 |

Frontend: `VITE_API_URL` (default `http://localhost:5000/api`).

### Scripts (in `backend/`)

| Command | What it does |
|---------|--------------|
| `npm run dev` | API with auto-restart |
| `npm start` | API for production |
| `npm test` | all tests (no database needed) |
| `npm run seed` | demo users and products (about 100 products from DummyJSON) |
| `npm run reindex` | rebuild the Elasticsearch index from MongoDB |

## Try the main flow

1. Log in as `vendor1@example.com`, onboard if asked. Log in as admin and approve the shop.
2. As the vendor, add a coupon, e.g. `WELCOME10` (10%).
3. Sign up as a customer, search, add items from two shops, apply the coupon, pay online or choose cash on delivery.
4. Log in as each vendor and move the order to packed, shipped, delivered.
5. As the customer, download the invoice and leave a review on the delivered product.
6. As admin, open the analytics tab.

For a test payment use Razorpay's test mode keys and the test card or UPI details shown in the Razorpay dashboard documentation. Large carts can exceed Razorpay's test amount limit, so use cheap items.

## Known limitations

- Vendor payouts use Razorpay Route and need a linked account id per vendor. Without it the vendor's share is only recorded and shown as "owed" on the admin dashboard.
- A customer who closes the browser after paying is confirmed by the webhook, but their cart is then not emptied automatically.
- No rate limiting on the API.
- Invoices use "Rs." and replace non-Latin characters with "?" (the built-in PDF fonts have no rupee sign).
- Search needs Elasticsearch. If it is down, browsing by id and ordering still work, but `/api/search` answers 503.

## Commit convention

`feat:`, `fix:`, `docs:`, `test:`, `chore:` with one logical change per commit.

## Team ownership and reflections

## Reflection: Mohd Mubashshir

**What I owned**
- Setting up and running the full stack with Docker (MongoDB, Redis, Elasticsearch)
- Connecting the app to Razorpay test mode and debugging the payment setup
- Adapting the code to the project requirements, then running and testing the whole flow end to end
- Fixing problems I found along the way, such as payment keys that failed to authenticate, an API error handler returning the wrong status code, and file names that work on Windows but would break on Linux
- The GitHub repository, documentation and the demo video

**What I learned**
- How authentication, role-based access, search, a Redis cart, payment verification and order lifecycles fit together in one product
- Why the server must verify a payment signature instead of trusting the browser
- That bugs hide in details such as stock handling, double clicks and file-name casing, and that automated tests (49 of them) catch many of them early

**What I would do next**
- Deploy the frontend and backend separately using the included configuration
- Set up Razorpay Route linked accounts so vendor payouts are sent automatically
- Add rate limiting and measure the search and API performance on real data
