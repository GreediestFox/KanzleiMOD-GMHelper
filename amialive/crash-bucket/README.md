# Crash bucket (Cloudflare Worker + R2)

Receives the crash-report zips of AmIAlive and keeps them for **30 days**. Tested locally against `wrangler dev --local` (`npm test` after starting the worker, see `test.mjs`).

## Setup (once)
```bash
cd amialive/crash-bucket
npm install
npx wrangler r2 bucket create kanzlei-crash
# retention: delete everything under crash/ after 30 days  (check "npx wrangler r2 bucket lifecycle add --help" for the exact form of your wrangler version)
npx wrangler r2 bucket lifecycle add kanzlei-crash expire-30d crash/ --expire-days 30
# two secrets: the server gets only the first one
npx wrangler secret put UPLOAD_TOKEN       # goes into AmIAlive.ini as report_token
npx wrangler secret put ADMIN_TOKEN        # for you: list / download / delete
npx wrangler deploy                        # route crash.wulpischelande.de (change it in wrangler.jsonc if you want another name)
```
In the server's `AmIAlive.ini`: `report_url=https://crash.wulpischelande.de/upload` and `report_token=<UPLOAD_TOKEN>`; then `AmIAlive.exe report` must print `uploaded crash/...`.

## Reading the reports
```bash
curl -H "Authorization: Bearer <ADMIN_TOKEN>" "https://crash.wulpischelande.de/reports?n=20"
curl -H "Authorization: Bearer <ADMIN_TOKEN>" -o report.zip "https://crash.wulpischelande.de/report?key=crash/2026/11/26/VPS1_...zip"
```
(or look into the bucket in the Cloudflare dashboard: *R2 > kanzlei-crash*).

## Limits
Zip header and size are checked (max 60 MB), at most 30 uploads per host and day. Keys are `crash/<yyyy>/<mm>/<dd>/<host>_<timestamp>_<random>.zip`. `POST /admin/purge?days=N` deletes by hand (also used in the tests).
