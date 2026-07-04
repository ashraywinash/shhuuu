# shhuuu

shhuuu is a responsive pseudonymous direct-messaging app built for Vercel and Supabase. Its name evokes the sound of a fast arrow: communication that moves directly and quickly. People create a unique pseudonym and password, search authenticated platform members, and exchange client-side encrypted text, images, videos, replies, emoji reactions, read receipts, typing state, and presence.

## What is included

- Unique 3–24 character pseudonyms with password authentication
- Browser-generated identity keys and password-wrapped private-key backup
- End-to-end encrypted message, media, reaction, and receipt payloads
- Private Supabase Storage objects containing ciphertext only
- Participant-only database, Storage, Realtime, and RPC policies
- Searchable member directory available only after authentication
- Direct conversations, optimistic sending, read state, typing, and presence
- Encrypted message replies with quoted context and jump-to-original behavior
- Full-screen previews for decrypted images
- Opt-in, privacy-preserving browser notifications
- Identity safety numbers with device-local verification pinning
- Responsive desktop and mobile layouts plus a no-credentials demo mode
- CSP and browser security headers for Vercel

## Local setup

Requirements: Node.js 20.9 or newer and a Supabase project.

1. Install dependencies:

   ```bash
   npm ci
   ```

2. In the Supabase SQL Editor, run [the initial migration](./supabase/migrations/0001_initial.sql).

3. In Supabase Authentication settings:

   - Keep the Email provider enabled.
   - Turn **Confirm email** off. shhuuu maps pseudonyms to internal non-deliverable addresses and does not collect inboxes.
   - Set the minimum password length to at least 12.
   - Enable CAPTCHA and Supabase password protections before a public launch.

4. In Supabase Realtime settings, disable **Allow public access**. The migration installs participant-only Broadcast and Presence policies for private conversation topics.

5. Create `.env.local` from `.env.example`:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-or-anon-key
   ```

   Never put a Supabase service-role key in this application or in a `NEXT_PUBLIC_*` variable.

6. Start the app:

   ```bash
   npm run dev
   ```

Without environment variables, the same interface runs in an in-memory demo mode so the full UI can be reviewed safely.

## Deploy to Vercel

1. Push this directory to a Git repository and import it in Vercel as a Next.js project.
2. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the Production, Preview, and Development environments as appropriate.
3. Deploy. Vercel will use `npm run build` automatically.
4. Create two test pseudonyms in separate browser profiles. Compare their safety number, exchange text and media, react, and confirm read receipts before opening registration publicly.

The app does not need a custom server or a Supabase service-role secret. Browser requests are authorized by the signed-in JWT and the RLS policies in the migration.

## Validation

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

The cryptographic test suite covers cross-participant ECDH agreement, password key wrapping, authenticated-ciphertext tamper detection, encrypted media round-tripping, and symmetric safety numbers.

## Operational notes

- Uploaded files are capped at 25 MB and encrypted in browser memory before upload.
- Browser notifications are opt-in, omit message text, and work while the app remains open in a background tab or window.
- The initial sync loads the latest 2,000 encrypted events across a user’s conversations. Add cursor pagination before operating at large history volumes.
- There is intentionally no password-reset flow: without a verified recovery channel, resetting a password would either enable account takeover or make the previous private key unrecoverable.
- Account deletion and key rotation require a deliberate product policy and are not exposed in this first release.
- Read [SECURITY.md](./SECURITY.md) before production use; it defines the encryption guarantees and unavoidable metadata.

## Project structure

```text
app/                         Next.js entry point and responsive styles
components/                  Authentication and chat UI
lib/auth.ts                  Pseudonym auth and private-key unlock
lib/crypto.ts                Web Crypto E2EE primitives
lib/chat.ts                  Supabase encrypted chat operations
supabase/migrations/         Schema, RLS, Storage, and Realtime policies
tests/                       Cryptographic behavior tests
```
