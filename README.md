# Ink Squid

A Flappy-Bird-style canvas game with a global leaderboard gated by wallet signatures on the Ink chain.

## Stack

- Next.js 15 (App Router, TypeScript)
- wagmi v2 + viem v2 + RainbowKit v2 (Ink mainnet / sepolia)
- iron-session + SIWE (Sign-In with Ethereum) for wallet auth
- Prisma + PostgreSQL for the leaderboard
- Plain CSS (no Tailwind) — single `app/globals.css`

## Local setup

```bash
pnpm install
cp .env.example .env
# fill in DATABASE_URL, SESSION_SECRET, NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
pnpm prisma db push
pnpm dev
```

Get a WalletConnect project id at https://cloud.walletconnect.com.

`SESSION_SECRET` must be 32+ chars. Generate one with `openssl rand -base64 32`.

## Deploying to Railway

1. Create a new Railway project from this repo.
2. Add the **PostgreSQL** plugin — Railway injects `DATABASE_URL` automatically.
3. Set the remaining vars on the service:
   - `SESSION_SECRET`
   - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
   - `NEXT_PUBLIC_INK_NETWORK` = `sepolia` or `mainnet`
4. Railway's Nixpacks builder auto-detects Next.js. The `build` script runs `prisma generate && next build`, and `start` runs `next start` on `$PORT`.
5. Run migrations once after first deploy: from the Railway service shell, `pnpm prisma db push`.

## Controls

- **Space / ArrowUp / Click / Tap** — swim
- **P** — pause
- **R** — restart

## Scoring

+1 per ink droplet collected. Pipes don't score on their own — every pipe spawns a droplet in the gap.

## Leaderboard flow

1. Player connects a wallet (RainbowKit).
2. Player clicks "Sign in" — app fetches a nonce, builds a SIWE message, wallet signs it, server verifies the signature and binds the address to an iron-session cookie.
3. After a run, if the player scored > 0, the score-submit modal POSTs `{ score, name }` to `/api/scores`. The server reads the address from the session — the client cannot claim a score for a different address.
4. Leaderboard (`GET /api/scores`) is public; top 10 by score.

Scores are deduplicated per-address: a submission only persists if it beats the player's previous best for that address.
