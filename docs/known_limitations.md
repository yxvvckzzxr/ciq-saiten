# Known Limitations

## Browser-Only Processing

PDF generation, scan parsing, image cropping, and upload orchestration run in the browser. Large PDFs or weak devices can still be slow despite validation and bounded concurrency.

## Visual Verification

Automated tests cover logic, not full visual layout. Important UI changes still require manual inspection across desktop and mobile widths.

## Supabase Environment

Local development requires valid Supabase configuration. Static pages can load without a server, but OAuth and some browser APIs work better through `python3 -m http.server`.

## Email

Email delivery depends on Supabase Edge Functions and SES configuration. Browser code should not assume mail delivery succeeds; user-facing flows should remain clear when email fails.

## Security Testing

The repository has focused unit tests, but full RLS and Edge Function regression coverage is not complete yet. Security-sensitive changes require manual review of migrations, grants, policies, and client access paths.

## Free Plan Project Pausing

The Supabase Free plan pauses a project after 7 days with no requests, and restoring it is a manual
dashboard action that takes minutes. Entry and event periods generate enough traffic on their own, so
the risk is the off-season: the project pauses unnoticed and is still down on event day. A Cloudflare
Workers cron in `cloudflare/keepalive/` pings a public view twice a day to prevent this. Verify it
returns 200 before an event rather than trusting it silently.
