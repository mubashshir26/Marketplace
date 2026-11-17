# Deployment guide

The frontend and the backend are deployed separately. Free tiers are enough for a demo, but they have limits (listed at the end).

Order: create the data services, deploy the backend, deploy the frontend, then give the backend the frontend's address.

## 1. Data services

| Service | Use | Setup |
|---------|-----|-------|
| MongoDB Atlas (free M0) | database | Create a cluster, a database user, and under Network Access allow `0.0.0.0/0` (Render has no fixed IP). Copy the connection string into `MONGO_URI` and put the database name `marketplace` in it |
| Upstash Redis (free) | cart, refresh tokens | Create a database. Copy the `rediss://...` URL into `REDIS_URL` |
| Elastic Cloud (14-day trial) | search | Create a deployment. Copy its endpoint into `ELASTICSEARCH_URL` and create an API key for `ELASTICSEARCH_API_KEY` |
| AWS S3 (optional) | vendor images | Needed because free hosts have a disk that is wiped on restart. Create a bucket and an IAM user that can only write to it. Set a billing budget alert first |

## 2. Backend on Render

`render.yaml` in the repo root describes the service. In Render choose New, Blueprint, pick the repo. Render asks for every variable marked as a secret:

| Variable | Value |
|----------|-------|
| MONGO_URI, REDIS_URL, ELASTICSEARCH_URL, ELASTICSEARCH_API_KEY | from step 1 |
| JWT_ACCESS_SECRET, JWT_REFRESH_SECRET | two different random strings (command below) |
| CLIENT_ORIGIN | the frontend address, filled in after step 3. Several allowed, separated by commas |
| PUBLIC_URL | the backend address, e.g. `https://marketplace-api.onrender.com` |
| STORAGE | `s3` (already set in the blueprint) |
| AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY | from S3 |
| RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET | Razorpay test mode, see step 5 |

Random secret:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Check `https://<backend>/api/health`.

## 3. Frontend

Any static host works. Root directory `frontend`, build command `npm run build`, output `dist`, and the variable `VITE_API_URL=https://<backend>/api` set before the build (it is baked into the files, so changing it needs a rebuild).

- Vercel: import the repo, set the root directory to `frontend`. `frontend/vercel.json` already sends every path to `index.html`, which React Router needs.
- Netlify or Render Static Site: `frontend/public/_redirects` does the same (Render needs the rewrite added in its dashboard).

Then go back to the backend and set `CLIENT_ORIGIN` to the frontend address (no trailing slash needed) and redeploy.

## 4. Fill the production database

Run the seed from your own computer against the hosted services:

```powershell
cd backend
$env:MONGO_URI="mongodb+srv://..."
$env:ELASTICSEARCH_URL="https://..."
$env:ELASTICSEARCH_API_KEY="..."
npm run seed
npm run reindex
```

The seed creates the demo admin with a well-known password. For anything beyond a demo set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` first, or change the password afterwards.

## 5. Razorpay webhook

In the Razorpay dashboard (test mode), Settings, Webhooks, add:

- URL: `https://<backend>/api/payments/webhook`
- Secret: the same value as `RAZORPAY_WEBHOOK_SECRET`
- Events: `payment.captured` and `order.paid`

The webhook is a safety net. The normal path is the browser calling `/api/checkout/verify`.

## 6. Smoke test

1. `/api/health` answers `{ "ok": true }`.
2. Search shows products (if empty, run `npm run reindex`).
3. Sign up, add to cart, pay with a test payment, see the order as `placed`.
4. Download the invoice.

## Free-tier limits to plan around

- **Render free web service** sleeps after 15 minutes without traffic, and the next request takes about a minute. Open the site a few minutes before a demo. It has 750 instance hours a month and a disk that is wiped on restart. [Render free tier](https://render.com/docs/free)
- **Elastic Cloud** is a 14-day trial with no card. After that, search stops. Either deploy close to the demo date, or record the demo against local Docker. [Elastic Cloud trial](https://www.elastic.co/cloud/cloud-trial-overview)
- **Upstash** free: 500K commands a month, 250 MB. [Upstash pricing](https://upstash.com/pricing/redis)
- **MongoDB Atlas M0**: 0.5 GB, 500 connections, and the cluster is paused after 30 days of inactivity. [Atlas free cluster limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)
- Not checked here: Vercel and Netlify free limits and the AWS S3 free tier. Check their pricing pages before relying on them.
- Razorpay test-mode behaviour of Route (vendor transfers) was not verified. The app keeps working if transfers are unavailable and records the vendor's share instead.
