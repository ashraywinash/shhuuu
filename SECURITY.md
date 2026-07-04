# shhuuu security model

shhuuu is designed so an honest-but-curious database or storage administrator can see ciphertext but cannot derive message or media plaintext. This implementation has not received an independent cryptographic audit and should not be treated as a Signal replacement for high-risk users.

## What is end-to-end encrypted

The following values are serialized and encrypted in the sender’s browser before transmission:

- Text and emoji content
- Reply target and quoted reply context
- Media filename, MIME type, and encrypted object path
- Image and video bytes
- Reaction emoji and target event
- Read-receipt target event

Every message row contains only a random identifier, conversation and sender routing IDs, AES-GCM ciphertext, a nonce, and a timestamp. Storage objects use `application/octet-stream` and contain only AES-GCM ciphertext.

## Key construction

1. At signup the browser creates an extractable P-256 ECDH identity pair.
2. The public JWK is published with the pseudonym. The private JWK is wrapped using AES-256-GCM with a key derived from the password via PBKDF2-SHA-256, 600,000 iterations, a random 128-bit salt, and a random 96-bit nonce.
3. After wrapping, the working private key is imported as non-extractable and kept only in JavaScript memory.
4. Two participants derive the same ECDH secret. HKDF-SHA-256 binds it to the conversation ID and produces a non-extractable AES-256-GCM conversation key.
5. Each event and media object uses a new random 96-bit nonce. Conversation and message identifiers are authenticated as additional data.
6. The safety number hashes both identity public keys and participant IDs in a stable order. A verified value is pinned in local browser storage so later key changes are visible on that device.

Supabase Auth separately hashes account passwords. The application never stores or logs the plaintext password.

## Authorization boundaries

- `profiles`: searchable by authenticated people; contains pseudonym and public identity key.
- `key_vaults`: selectable only by its owner; contains the password-wrapped private key.
- `conversations`: selectable only by either participant and creatable only through a constrained RPC.
- `messages`: selectable and insertable only by participants; the sender ID must match `auth.uid()`.
- `encrypted-media`: a private bucket; only participants can upload or download a conversation prefix.
- Realtime Broadcast and Presence: private topics authorized from conversation membership.
- Anonymous users receive no database or Storage grants.

Never use the service-role key in the browser. It bypasses RLS.

## Metadata that is not encrypted

Global pseudonym search and server-routed delivery require some metadata to remain available to Supabase:

- Pseudonyms and public identity keys
- Which accounts participate in a conversation
- Sender and conversation identifiers
- Message timestamps, frequency, ciphertext sizes, and encrypted object sizes
- Online/typing traffic while a private Realtime channel is active

This metadata can reveal social relationships and activity patterns even though it cannot reveal content. Claiming that *all* server data is opaque would be incompatible with global pseudonym search and practical message routing.

Opt-in browser notifications deliberately omit text content, but the device notification surface can still reveal the sender pseudonym and whether the event is a photo or video.

## Administrator and frontend compromise

An administrator reading database backups or Storage objects cannot decrypt existing content without a participant’s private key or password. However:

- A malicious administrator who can change public keys could attempt key substitution for future conversations. People should compare and pin safety numbers through a different trusted channel.
- A party able to deploy modified frontend JavaScript can steal future passwords or plaintext as users type. Protect Vercel ownership, require MFA, restrict deploy access, review dependencies, and monitor production changes.
- A weak password permits offline guessing against the wrapped private key if the vault is copied. shhuuu enforces 12 characters, but passphrases should be substantially stronger.

No web application can protect plaintext on an already compromised endpoint.

## Current cryptographic limitations

- Static identity ECDH does not provide per-message forward secrecy or post-compromise security.
- There is no multi-device device-key list, signed prekey, key rotation, recovery key, or revocation protocol.
- Attachment encryption buffers the complete file in browser memory and is therefore limited to 25 MB.
- Local safety-number pinning is per browser profile and does not synchronize between devices.

Before using shhuuu for high-risk communications, replace the static ECDH scheme with a well-reviewed Signal Double Ratchet implementation, add device verification and key transparency, commission an independent audit, and publish a reproducible client build.

## Production checklist

- Apply the migration to a fresh Supabase project and test every RLS policy with two users plus an unrelated third user.
- Disable public Realtime channels and email confirmation; enable CAPTCHA and Auth rate limits.
- Keep the Storage bucket private and confirm its MIME and size restrictions.
- Require MFA for Supabase, Vercel, source control, and domain accounts.
- Keep the supplied CSP and security headers enabled in production.
- Configure dependency scanning, secret scanning, deployment audit logs, backups, and incident response.
