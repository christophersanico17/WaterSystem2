# Deploying to Railway

One Railway service runs everything: the API, the website (built from `src/`
and served by the same server), and the endpoint the ESP meters report to.
Everything lives at one public HTTPS address, so meters in any household on
any WiFi network can reach it. Build/start settings are in `railway.json`.

## 1. Create the service

1. Push this repo to GitHub.
2. Sign in at <https://railway.com> with GitHub → **New Project** →
   **Deploy from GitHub repo** → pick `WaterSystem2`.
   The first deploy may fail until the variables below are set. That's expected.

## 2. Add a volume (keeps the database)

Without this, the SQLite database is wiped on every redeploy.

Service → **right-click / ⋯ → Attach Volume** → mount path: `/data`

## 3. Set variables

Service → **Variables** → add:

| Variable | Value |
|---|---|
| `DB_PATH` | `/data/water_system.db` |
| `JWT_SECRET` | a long random string (e.g. run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
| `TRUST_PROXY` | `1` |
| `DISCOVERY_PORT` | `0` |
| `FRONTEND_ORIGIN` | your public URL from step 4, e.g. `https://watersystem2-production.up.railway.app` |
| `VITE_GOOGLE_CLIENT_ID` | same as in the root `.env` (only if Google Sign-In is used) |
| `GOOGLE_CLIENT_ID` | same as in `server/.env` (only if Google Sign-In is used) |
| `PAYMONGO_SECRET_KEY` / `PAYMONGO_PUBLIC_KEY` / `PAYMONGO_WEBHOOK_SECRET` | same as in `server/.env` (only if GCash payments are used) |

Don't set `PORT`. Railway provides it.

## 4. Get the public URL

Service → **Settings → Networking → Generate Domain**. Copy it into
`FRONTEND_ORIGIN` (step 3), which triggers a redeploy.

If Google Sign-In is used: Google Cloud Console → Credentials → your OAuth
client → add this URL to **Authorized JavaScript origins**.

## 5. First login: change the demo passwords

The first boot seeds the demo data (`server/src/db/seed.js`), including
`admin@barangay.local` / `admin12345` and `collector@barangay.local` /
`collector123`. The site is public now, so change both passwords right away.

## 6. Point the meters at it

1. Admin panel → **Households** → the meter's household → **Generate device key**.
   (The cloud database is separate from your local one, so local keys don't work there.)
2. In `firmware/esp_water_meter/config.h`:
   ```c
   #define SERVER_URL "https://<your-domain>.up.railway.app"
   #define DEVICE_KEY "dev_...the new key..."
   ```
3. Upload the sketch. Serial Monitor (115200) should show `Reported ...` every
   10 s, and the household shows **Online** on the website.

The meter now works on any WiFi with internet access. To go back to local
testing, comment out `SERVER_URL` and the meter finds your PC's server on the
same WiFi automatically.

## Updating

Push to GitHub, and Railway rebuilds and redeploys automatically. The database on
the `/data` volume is kept.
