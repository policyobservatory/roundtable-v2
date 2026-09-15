# Pricing and launch-discount waitlist

The workspace footer links to `/pricing`, a separate statically generated SvelteKit
page. It keeps the current theme and presents a launch-discount waitlist, not an
invented price, discount percentage, or launch date. The footer is on the workspace
and pricing pages, not over the full-screen meeting/recording interface.

## API and storage

`POST /api/waitlist` accepts JSON:

```json
{
  "first_name": "Ana",
  "email": "ana@example.org",
  "industry": "legislature"
}
```

- `first_name`: required, trimmed, 1–80 characters, no control characters.
- `email`: required, trimmed and lowercased, valid email format, maximum 254 characters.
- `industry`: optional. Omitted, empty, and null all become SQL `NULL`. Allowed values
  and dropdown labels are in `shared/waitlist.ts`.
- `website`: an optional, non-persisted spam-trap field. Human users do not see it.
- Other fields are rejected. JSON payloads are limited to 8 KiB.

The existing `DB` binding stores rows in **`waitlists`**, created by
`migrations/0004_waitlists.sql`. Rows contain a UUID, first name, normalized email,
optional industry, signup timestamp, and `consent_version = launch-discount-v1`.
This version records the form's notice about launch/special-discount emails.

Writes use bound parameters and an atomic unique-email insert. Existing emails get
the same `{ "ok": true }` acknowledgement, without disclosing subscriber status or
overwriting the original person's details. Transient D1 failures can be retried
without duplicating a signup, including after a lost acknowledgement. Responses
contain no subscriber records and use `Cache-Control: no-store`.

Malformed/invalid JSON gets 400, oversized requests 413, and non-JSON submissions
415. Database failures get a generic 503; submitted data and raw database errors
are not logged. There is no public listing, editing, deleting, or exporting API.

## Local development and rollout

From the project root, initialize local D1 before using the form against Wrangler:

```bash
node node_modules/wrangler/bin/wrangler.js d1 migrations apply roundtable-v2-db --local
npm run build
node node_modules/wrangler/bin/wrangler.js dev
```

For an authorized production rollout, apply pending migrations to the existing
**remote** `roundtable-v2-db` before deploying the API and frontend:

```bash
node node_modules/wrangler/bin/wrangler.js d1 migrations apply roundtable-v2-db --remote
npm run build
node node_modules/wrangler/bin/wrangler.js deploy --keep-vars
```

Do not execute schema DDL in request handlers. Implementation tests apply the new
migration only to disposable Miniflare databases; they do not enroll real people
or touch production resources.

## Operational limits

- A successful form submission saves to D1. **No email is sent automatically**, no
  payment is taken, and no fixed launch/discount details have been configured.
- Email format is validated, but ownership is **not verified**. This does not
  implement double opt-in, an unsubscribe flow, or an email campaign service.
- The hidden field is only a basic spam trap. This endpoint is public and has no
  dedicated rate limiter or Turnstile verification. Add those protections before
  promoting it broadly; the trap and duplicate prevention are not bot protection.
- Names and emails are personal data. Restrict D1/dashboard/export access, define
  a retention/deletion policy, and provide unsubscribe handling before sending
  launch communications. Do not publish the table or log exports.

`tests/waitlist.test.mjs` exercises the actual API against local D1, including
normalization, duplicate/concurrent writes, optional industries, malformed input,
SQL parameter safety, interrupted acknowledgements, and safe error responses.
The browser harness separately tests footer navigation, direct pricing reloads,
mobile layout, form validation, JSON requests, in-flight guards, failure/retry, and
server-confirmed success with mocked network responses.
