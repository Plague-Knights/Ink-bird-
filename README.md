# Ink Bird Arcade

Flappy-style bird game with a paid weekly leaderboard on **Ink Chain** (L2).

- 0.001 ETH entry grants **100 play credits**
- **90%** of every entry goes to the week's prize pool, **10%** to the treasury
- Weekly rounds distribute the pool across the **top 100** (top-10 weighted)
- Gameplay is gasless after entry; only the weekly settlement and player
  claim are on-chain

> ⚠️ **Unaudited mainnet deployment.** This repository ships a minimally
> safety-railed contract (pause, per-week cap, claim timelock with owner
> veto, unclaimed sweep). It has **not** been audited. The operator
> accepts the risk of total pool loss from undiscovered bugs.

## Repository layout

```
/            static frontend (index.html, game.js, arcade.js, wallet-ui.js, style.css)
/contracts   Hardhat project with InkBirdArcade.sol + tests + deploy script
/backend     Node + express + sqlite: sessions, score submission, weekly settler
```

## Contract: `InkBirdArcade`

Deployed on Ink mainnet (chainId 57073). Configurable parameters:

| Constant | Value |
|---|---|
| `ENTRY_FEE` | 0.001 ETH |
| `CREDITS_PER_ENTRY` | 100 |
| `TREASURY_BPS` | 1000 (10.00%) |
| `WEEK` | 7 days |
| `CLAIM_TIMELOCK` | 24 hours |
| `UNCLAIMED_SWEEP_DELAY` | 4 weeks |

Safety rails (owner-only): `setPaused`, `setPerWeekCap`, `rotateOperator`,
`vetoSettlement` (during timelock), `sweepUnclaimed` (after 4 weeks),
two-step `transferOwnership`.

## Payout curve (top-100)

```
 1st   25.0%
 2nd   15.0%
 3rd   10.0%
 4–5th  6.0% each
 6–10th 3.0% each
11–25th 0.6% each
26–100  0.2% each
```

Sums to 100% of the pool. Any dust from integer division (and any prize
left unclaimed past 4 weeks) rolls into the next week.

## Deployment

### 1. Contract

```bash
cd contracts
cp .env.example .env
# Fill in DEPLOYER_PRIVATE_KEY and OPERATOR_ADDRESS.
# TREASURY_ADDRESS defaults to the configured treasury.
npm install
npm test                        # run unit tests (local network)
npm run deploy:mainnet          # deploy to Ink mainnet
```

The deploy script prints the deployed address. Save it — you'll need it
for both the backend (`ARCADE_ADDRESS`) and the frontend
(`data-arcade` attribute in `index.html`).

### 2. Backend

Runs a single Node process that indexes on-chain entries, issues play
sessions, validates score submissions, and publishes weekly settlement
manifests.

```bash
cd backend
cp .env.example .env
# Fill in ARCADE_ADDRESS, OPERATOR_PRIVATE_KEY, SESSION_SECRET.
npm install
npm start                       # listens on $PORT (default 8787)
```

Host it anywhere that can keep a long-lived process: Fly.io, Railway,
a small VPS, or your own box. The operator key signs `settleWeek`
transactions — guard it carefully; if it leaks, the owner can
`vetoSettlement` during the 24-hour timelock and `rotateOperator` to a
fresh key.

Weekly settlement is a separate command that should be run after each
week boundary (cron or manual):

```bash
cd backend
npm run settle -- <weekId>
# Writes week-<weekId>.json with per-player proofs. Publish that file
# publicly so winners can find their proof and call claim().
```

### 3. Frontend

In `index.html`, edit the arcade `<script>` tag:

```html
<script type="module" src="arcade.js"
        data-arcade="0xDEPLOYED_CONTRACT_ADDRESS"
        data-backend="https://your-backend-host"></script>
```

Serve the static files from anywhere (GitHub Pages, Cloudflare Pages, a
plain bucket). No build step.

## Playing

1. Connect wallet (MetaMask / Rabby). The page auto-prompts a switch to
   Ink mainnet, adding the network if needed.
2. Click **Pay 0.001 ETH · +100** — this is the only on-chain entry tx.
3. Click **Start Run** — signs a message, the backend issues a session
   token + RNG seed, and one credit is spent.
4. Play a single run. On death, the score submits to the backend.
5. Repeat until credits run out, then buy another entry.

### Claiming a prize

After a week is settled and the 24-hour timelock passes, winners find
their proof in `week-<weekId>.json` and call `claim(weekId, amount, proof)`
on the contract. A UI for this isn't included in v1 — use etherscan / a
cast/forge call, or add a small claim page.

## Anti-cheat (v1)

- Each run requires a wallet-signed session.
- The seed + recorded flap-frame input must hash to `inputsHash`.
- Score is bounded by `MAX_SCORE_PER_RUN` and by a minimum
  inputs-per-score ratio.
- Flaps are recorded and stored with the run for later audit.

**Known v1 gap:** the backend does not yet re-run the game deterministically
from the recorded inputs. A determined attacker can still fabricate an
`inputsHash` and score pair as long as the counts pass the sanity checks.
The frontend ships with a seeded, deterministic RNG (`gameRand`) exposed
from the arcade module, so adding a headless replay on the backend is
the clean next step.

## Operations checklist (weekly)

- [ ] Confirm the contract is not paused.
- [ ] Run `npm run settle -- <weekId>` shortly after the week ends.
- [ ] Publish `week-<weekId>.json` so winners can retrieve their proof.
- [ ] Monitor the timelock window (24h) — `vetoSettlement` is available.
- [ ] After 4 weeks, optionally `sweepUnclaimed` to roll dust forward.

## Risk disclosure

This software is provided as-is. Smart contracts holding ETH on mainnet
without a professional audit carry significant risk of permanent loss.
Players depositing 0.001 ETH should understand that bugs in the contract
or operational failure (lost operator key, misconfigured settlement)
could prevent payouts. Deploy at your own risk.
