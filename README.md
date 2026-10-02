# Academic Portfolio & Isolated Assessment Hub

## Repository, Data, and Reproducibility

The Vercel-linked GitHub repository supplies application source and serverless functions. Admin persistence is independently configured by the server-only `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_BRANCH`, and `GITHUB_DATA_PATH` values; the existing content repository remains the source of truth and is not the application repository. The API also stores uploaded assets in that configured content repository. No data migration or duplicate production archive is part of this release. To change the content repository in a future phase, migrate the archive and managed assets deliberately, then update the server-side GitHub variables in Development, Preview, and Production.

Everything under `public/` is directly downloadable. The unused 52-byte starter `public/data/data.json` has been removed from the application repository; the API reads the configured path from the separate content repository. Do not place private identity, feedback, or management-only data in a public path. The live content archive size was not measured from this application checkout.

For a clean clone, use the checked-in npm lockfile:

```powershell
npm ci
npm run typecheck
npm run test:api
npm run build
```

`npm run dev` serves the Vite frontend only. For local Admin/API development, link this folder to the existing Vercel project if needed, configure `.env.local`, and use `npm run dev:vercel` to serve the application and API together on port 3000.

## Phase 3 Admin API

The Admin API is implemented as same-origin serverless functions under `api/`. Production login uses the configured administrator email and a scrypt password hash, verified server-side by `POST /api/admin/auth/login`. Successful authentication creates the existing encrypted, HttpOnly session cookie. The GitHub Personal Access Token is used only by server functions for persistence and is never sent to the browser or stored in the session.

### Server environment

Copy `.env.example` to `.env.local` for local development and set these values in the serverless environment only:

| Variable | Purpose |
| --- | --- |
| `GITHUB_PAT` | Fine-grained GitHub PAT used only by server functions for persistence. |
| `GITHUB_OWNER` | Configured GitHub account or organization. |
| `GITHUB_REPO` | Configured repository name. |
| `GITHUB_BRANCH` | Branch that contains the academic archive. |
| `GITHUB_DATA_PATH` | The only GitHub file the API can read or write. Existing project path: `public/data/data.json`. |
| `ADMIN_SESSION_SECRET` | Random secret of at least 32 bytes for AES-256-GCM session encryption. |
| `ADMIN_EMAIL` | Administrator account email, verified by the server. |
| `ADMIN_PASSWORD_HASH` | Salted scrypt hash created with `scripts/hash-admin-password.mjs`; never use a plaintext password here. |
| `ADMIN_LOCAL_BYPASS` | Local-only opt-in. Keep `false` except in a local serverless development environment. |

Create a session secret with Node.js, then put the result in the server's local environment file or deployment settings:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

The server fails closed when a required value is absent or invalid. Do not use `VITE_` prefixes, place these values in frontend code, or commit `.env.local`.

### GitHub token permissions

Use a fine-grained PAT scoped to the configured repository with only **Contents: Read and write**. Do not grant unrelated repository or organization permissions. The server-side PAT must have access to the configured data file; it is not an Admin login credential and is not sent to the browser.

Create the password hash locally without putting the plaintext in shell history. In PowerShell, enter the password through the hidden prompt, pipe it to the hash utility, and add the resulting hash to the Vercel server environment:

```powershell
$secure = Read-Host 'Admin password (at least 12 characters)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
	[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) | node --experimental-strip-types scripts/hash-admin-password.mjs
} finally {
	[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
```

### Local serverless development

Vite alone does not execute files in `api/`; `npm run dev` serves only the frontend. First link this local folder to the **existing** Vercel project (do not create a new project):

```powershell
npx vercel link
```

After selecting the existing project and configuring `.env.local`, run the Vercel-compatible local runtime:

```powershell
npx vercel dev --listen 3000
```

This serves the Vite application and `/api/*` functions on the same origin. Do not configure a browser-to-GitHub development fallback. The Admin API requires the same-origin `Origin` header for login, logout, and data writes.

### Local Admin Development Access

To open the Admin Portal locally without entering production credentials, set `ADMIN_LOCAL_BYPASS=true` in the local server environment, then run the Vercel-compatible local runtime above and open `http://localhost:3000/admin`. `127.0.0.1` and `::1` loopback hosts are also accepted. The Admin Header shows **Local Development** while this mode is active.

This bypass is disabled by default and works only when `NODE_ENV=development`, `VERCEL_ENV` is unset or `development`, `ADMIN_LOCAL_BYPASS` is exactly `true`, and the request Host is exactly `localhost`, `127.0.0.1`, or `::1` (with an optional port). LAN IPs, custom/public domains, Vercel Preview, and Production remain protected even if the flag is mistakenly set there. Never set the flag in Vercel Preview or Production. The bypass authenticates only the local Admin UI; GitHub status/read/write still require the server-side `GITHUB_PAT` and never expose it to the browser. Without GitHub credentials, the local Admin opens but GitHub operations fail safely.

### Development, Preview, and Production Authentication

- **Development:** configure `ADMIN_LOCAL_BYPASS=true` only in the local server environment. The bypass is restricted to loopback hosts and is never activated by a browser-side flag.
- **Preview:** set `ADMIN_LOCAL_BYPASS=false`; configure Preview-scoped `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`, and GitHub server variables if Preview Admin access is needed. Preview is not treated as localhost.
- **Production:** set `ADMIN_LOCAL_BYPASS=false`; configure Production-scoped `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`, and GitHub server variables. Use HTTPS. A deployment must be redeployed after Vercel environment changes.

The login endpoint checks email/password on the server using the configured salted scrypt hash. It returns only the account email and sets the encrypted HttpOnly session cookie. The password hash and GitHub PAT are never returned. Apply Vercel Firewall/rate-limiting rules to `POST /api/admin/auth/login`; the function remains stateless and does not rely on an in-memory limiter.

### Session and API security

The `bivmor_admin_session` cookie is stateless AES-256-GCM ciphertext containing only the administrator email and issue/expiry timestamps. It is HttpOnly, SameSite=Strict, scoped to `/api`, and expires after eight hours. Production responses add Secure; deploy behind HTTPS. Authenticated API responses use `Cache-Control: no-store, private`. GitHub errors are normalized before returning to the client.

The API exposes only these endpoints:

- `POST /api/admin/auth/login`
- `GET /api/admin/auth/session`
- `POST /api/admin/auth/logout`
- `GET /api/admin/github/status`
- `GET /api/admin/data`
- `PUT /api/admin/data`

Data writes use the server-configured owner, repository, branch, and path; the client must provide the SHA previously read from GitHub. Stale SHAs return HTTP 409 and are never retried or overwritten automatically. Requests and serialized data are limited to 1 MiB.

### Vercel deployment

Configure the required GitHub, session, and administrator credential variables in Vercel's **Production** scope; configure separate values in **Preview** if Preview Admin access is desired. Set `ADMIN_LOCAL_BYPASS=false` in both scopes. Do not use client-exposed variables. Vercel detects the Vite build (`npm run build`, output `dist`) and the serverless functions under `api/`; no localhost URLs are used for API requests or generated Professor Links. Deploy with HTTPS so production session cookies use Secure.

The Admin API reads and writes the configured content-repository file server-side. Keep the data path outside the application repository; if private identity, feedback, or management-only fields are introduced, ensure the configured content path is not under a publicly served `public/` directory because such files are directly downloadable.

### Future data growth

The Admin API uses one centralized JSON document in the content repository, and the shared in-memory Admin store reuses its loaded snapshot across Admin navigation. The live document size and growth rate must be measured in the content repository before setting migration thresholds. If size, write contention, or response time warrants it, migrate at the API boundary to partitioned structured records or a database, with binary files in object storage. Do not split the current source into many public JSON files as a navigation workaround.

### Interface languages

The interface defaults to Arabic and supports French. When adding or changing user-facing text, add both Arabic and French entries in `src/app/i18n/messages.ts` and render the text through `useLocale().t()`. This includes button labels, form validation, loading and error states, and accessible names. Academic names, descriptions, comments, and other user-authored archive content remain in the language in which they were entered.