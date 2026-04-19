# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev              # next dev
pnpm build            # prisma generate && next build
pnpm start            # next start -p $PORT (Railway-friendly)
pnpm db:push          # prisma db push (schema sync, dev)
pnpm db:migrate       # prisma migrate deploy (production)
```

No test suite, no linter configured beyond Next's default.

## Layout

Frontend lives under `src/` (App Router under `src/app`). Sibling repo `../ink-bird-contracts/` holds the Solidity contracts (Hardhat 3 + Ignition); the chain definitions in `src/config/chains.ts` match what's deployed there.

## Stack and why

- **Next.js 15 App Router + TypeScript + Tailwind v4** — one deploy target on Railway; server route handlers for SIWE + leaderboard. Tailwind available via `@import "tailwindcss"` in `src/app/globals.css`, but the existing canvas/menu/modal styling stays as hand-written CSS (too bespoke to Tailwind-ify sanely).
- **wagmi v2 / viem v2 / RainbowKit v2** — Ink chain (mainnet chainId 57073, sepolia 763373) selected at build time via `NEXT_PUBLIC_INK_NETWORK`.
- **iron-session v8** — stateless session cookie; holds nonce before verification and address after. Simpler than NextAuth for a single auth method.
- **Prisma 7 + Postgres + `@prisma/adapter-pg`** — Railway plugin gives `DATABASE_URL`. Single `Score` model, deduplicated per-address. Prisma 7 moved the datasource URL out of `schema.prisma` into `prisma.config.ts` (for Migrate) and into a driver adapter passed to `new PrismaClient({ adapter })` (for runtime). Don't add `url = env(...)` back to the schema — it'll fail validation.

## Architecture

### SIWE auth flow

Four routes under `src/app/api/auth/`:

- `POST /nonce` → mints a 16-byte hex nonce, stores it in the session, returns it.
- `POST /verify` → receives `{ message, signature }`. **Never trust the address in the message** — `parseSiweMessage` extracts the claimed address and nonce, the nonce is compared against the session's stored nonce (single-use), then `publicClient.verifySiweMessage` verifies the signature cryptographically (this also handles EIP-1271 smart-contract wallets). On success, nonce is cleared and address is bound to the session.
- `GET /me` → returns the current session's address (or null). Used by client components to know whether to show "Sign in" vs. "Sign out".
- `POST /logout` → destroys the session.

The server never accepts an address from the client directly — `session.address` is the only source of truth for writes.

### Attempt lifecycle

Per-play flow:

1. `POST /api/attempts/start` — checks on-chain `attemptsBought[address]` minus DB consumed rows; if > 0, creates an `Attempt` row with a server-generated 32-bit seed, returns `{ attemptId, seed }`.
2. Client runs the game with that seed, records flap inputs.
3. `POST /api/replay/submit` — server reruns `simulate.replay(seed, inputs)`, writes the server-computed `score` + `valid` flag onto the existing `Attempt` row. `claimedScore` is compared to the server's score; mismatch sets `valid = false` and the attempt is excluded from the leaderboard.
4. `GET /api/scores` — top 20 valid attempts for the current on-chain `currentWeekId()`, ranked by max score per address.

Unsubmitted attempts (`submittedAt = null`) are still counted as consumed, so an abandoned run burns an attempt. This prevents the trivial "start a run, quit, repeat to farm free plays" grief.

### Settlement (end-of-week)

`POST /api/admin/settle?week=<weekId>` — gated by `x-admin-secret` header matching `ADMIN_SECRET` env var. Runs the full pipeline:
- Read on-chain `weeks_(weekId).pool`
- Pull ranked leaderboard from `Attempt`
- Apply `PAYOUT_CURVE_BPS` via `computePayouts()` in `src/lib/payouts.ts`
- Build merkle tree via `src/lib/merkle.ts`
- Call `settleWeek(weekId, root)` from `SETTLER_PRIVATE_KEY`
- Write `Settlement` + `ClaimProof` rows

`GET /api/claim-proof?week=X&address=Y` — returns the stored proof for a winner. Public (proofs aren't secret).

### Game simulation (deterministic replay)

Gameplay logic is split into a **pure** module at `src/lib/simulate.ts` and a **rendering** component at `src/components/Game.tsx`. This split is load-bearing for anti-cheat.

- `simulate.ts` exports `initialState(seed)` + `step(state, inputs)`. No DOM, no Math.random for gameplay — all gameplay-affecting randomness routes through a Mulberry32 PRNG seeded with the server-issued `seed`. Particles / bubbles / weeds are cosmetic and use `Math.random()` freely in `Game.tsx` (they never feed back into scoring).
- `Game.tsx` runs the simulation client-side for the interactive UI, and records each flap as `{ f: frame, t: "flap" }`.
- On game-over, the client POSTs `{ attemptId, seed, inputs, claimedScore }` to `/api/replay/submit`, where the server imports the SAME `simulate.replay()` function and re-runs it deterministically. Server's score is authoritative; client's `claimedScore` is just a sanity echo.

**Do not import from `Game.tsx` into the server.** Only `simulate.ts` is isomorphic. `Game.tsx` is `"use client"` and touches DOM/canvas.

The fixed 60 Hz accumulator loop is preserved (`STEP_MS = 1000/60`, `MAX_FRAME_MS = 250`). If you add new gameplay state, it goes into `SimState` in `simulate.ts`, not refs in `Game.tsx`.

### Client ↔ server auth boundary

Two separate client pieces read `/api/auth/me`:
- `ConnectWallet` (in the topbar) — uses it to toggle Sign-in/Sign-out buttons.
- `src/app/page.tsx` — uses it to know whether the submit modal should be enabled.

Both re-fetch on window `focus`. If that becomes a perf concern, lift into a shared context; for now it's two cheap calls.

### Deployment (Railway)

`next.config.ts` sets `output: "standalone"`. The `start` script binds to `$PORT`. Railway's Nixpacks auto-detects Next.js. `postinstall` runs `prisma generate` so the client is always in sync with `schema.prisma`.

Railway Postgres plugin injects `DATABASE_URL`. Other env vars (`SESSION_SECRET`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `NEXT_PUBLIC_INK_NETWORK`) are set on the service. First deploy needs a one-time `npm run db:push` from the Railway shell to create the `Score` table.

## Things to be careful about

- **Session secret length**: `src/lib/session.ts` throws in production if `SESSION_SECRET` is missing or < 32 chars. Dev fallback exists so `npm run dev` doesn't fail on a fresh clone.
- **Ink chain switch**: changing `NEXT_PUBLIC_INK_NETWORK` requires a rebuild — it's read at module-init time in `src/config/wagmi.ts`.
- **Prisma on serverless**: not an issue on Railway (long-running Node process), so `src/lib/prisma.ts` uses the standard singleton pattern without Accelerate. The `PrismaPg` adapter opens a fresh `pg` pool per client — the global singleton prevents pool explosion during dev HMR.
- **Canvas anti-cheat**: effectively none. The server bounds-checks the score but cannot verify gameplay. If abuse becomes real, sign attestations from a trusted server round or move scoring to an on-chain game contract.
