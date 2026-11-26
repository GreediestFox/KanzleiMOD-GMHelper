# Crash receiver (Cloudflare Worker `amialive-crash-receiver` + R2 bucket `amialive-crash`)

A separate worker, bucket and address from the existing `gmc-crash-receiver`, so nothing of that one is touched.

Receives the crash-report zips of AmIAlive and keeps them for **30 days**. Tested locally against `wrangler dev --local` (`npm test` after starting the worker, see `test.mjs`).

## Setup (once) – the short way
Put `crash-receiver-secrets.txt` (two lines: `UPLOAD_TOKEN=...` and `ADMIN_TOKEN=...`, any long random strings, **not in git**) next to the script and run
```
powershell -ExecutionPolicy Bypass -File Deploy_Crash_Receiver.ps1
```
It creates the bucket, the 30 day rule, both secrets and deploys the worker (first run: wrangler opens the browser to log in to Cloudflare).

## Setup – by hand
```bash
cd amialive/crash-bucket
npm install
npx wrangler r2 bucket create amialive-crash
# retention: delete everything under crash/ after 30 days  (check "npx wrangler r2 bucket lifecycle add --help" for the exact form of your wrangler version)
npx wrangler r2 bucket lifecycle add amialive-crash expire-30d crash/ --expire-days 30
# two secrets: the server gets only the first one
npx wrangler secret put UPLOAD_TOKEN       # goes into AmIAlive.ini as report_token
npx wrangler secret put ADMIN_TOKEN        # for you: list / download / delete
npx wrangler deploy                        # route amialive-crash.wulpischelande.de (change it in wrangler.jsonc if you want another name)
```
In the server's `AmIAlive.ini`: `report_url=https://amialive-crash.wulpischelande.de/upload` and `report_token=<UPLOAD_TOKEN>`; then `AmIAlive.exe report` must print `uploaded crash/...`.

## Reading the reports
```bash
curl -H "Authorization: Bearer <ADMIN_TOKEN>" "https://amialive-crash.wulpischelande.de/reports?n=20"
curl -H "Authorization: Bearer <ADMIN_TOKEN>" -o report.zip "https://amialive-crash.wulpischelande.de/report?key=crash/2026/11/26/VPS1_...zip"
```
(or look into the bucket in the Cloudflare dashboard: *R2 > amialive-crash*).

## Limits
Zip header and size are checked (max 60 MB), at most 30 uploads per host and day. Keys are `crash/<yyyy>/<mm>/<dd>/<host>_<timestamp>_<random>.zip`. `POST /admin/purge?days=N` deletes by hand (also used in the tests).
