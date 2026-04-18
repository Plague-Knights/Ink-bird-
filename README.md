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

This project is fully automated via GitHub Actions. You set repository
secrets, push to `main`, and the frontend publishes itself. You stand
up the backend once on any Node host. The contract is a one-time
deploy.

### 1. Contract (one-time)

```bash
cd contracts
cp .env.example .env
# DEPLOYER_PRIVATE_KEY: fresh key with ~0.01 ETH on Ink for gas
# OPERATOR_ADDRESS:     separate key; backend will use it weekly
npm install
npm test                        # 9 unit tests, all must pass
npm run deploy:mainnet          # prints the deployed address
```

The `hardhat.config.js` uses a locally-installed `solc` so tests work
offline too.

### 2. Backend (one-time, then long-running)

Indexes on-chain entries, issues play sessions, validates submissions,
**automatically settles** each week once it ends, and serves claim
proofs.

```bash
cd backend
cp .env.example .env
# ARCADE_ADDRESS:        from step 1
# OPERATOR_PRIVATE_KEY:  matches OPERATOR_ADDRESS from step 1
# SESSION_SECRET:        strong random string, >= 32 chars
npm install
npm start                       # listens on $PORT (default 8787)
```

Host it on anything that keeps a Node process alive: Fly.io, Railway,
Render, a VPS. The autosettle loop runs every 10 minutes, detects
finished-but-unsettled weeks, builds the Merkle tree, writes
`manifests/week-<id>.json`, and submits `settleWeek` on-chain.

A one-shot manual settle is still available:
```bash
npm run settle -- <weekId>
```

### 3. Frontend (GitHub Pages, auto)

Configure repository secrets:

| Secret / Variable | Where | Value |
|---|---|---|
| `ARCADE_ADDRESS` | Secret | Deployed contract address |
| `BACKEND_URL` | Secret | Public URL of your backend |
| `EXPLORER_URL` | Variable | (optional) defaults to `https://explorer.inkonchain.com` |

Then enable Pages → Source: "GitHub Actions". Pushing to `main` triggers
`.github/workflows/pages.yml`, which writes `config.json` from your
secrets and publishes a site containing:

- `index.html` — the game
- `claim.html` — prize lookup + claim page

For local dev, copy `config.example.json` to `config.json` and edit it.

## Automation summary

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | push/PR | `npx hardhat test` + JS syntax check |
| `pages.yml` | push to `main` | Injects secrets → builds `_site/` → deploys to Pages |
| Backend autosettle | every 10 min (in-process) | Settles any finished, unsettled week |

## Playing

1. Connect wallet (MetaMask / Rabby). The page auto-prompts a switch to
   Ink mainnet, adding the network if needed.
2. Click **Pay 0.001 ETH · +100** — this is the only on-chain entry tx.
3. Click **Start Run** — signs a message, the backend issues a session
   token + RNG seed, and one credit is spent.
4. Play a single run. On death, the score submits to the backend.
5. Repeat until credits run out, then buy another entry.

### Claiming a prize

Visit `claim.html`, connect your wallet, enter the settled week's ID,
and click **Look up** to see your rank and amount. If the 24-hour
timelock has passed, click **Claim on-chain** to call `claim()` with
your Merkle proof — the backend serves the proof automatically from
the autosettle manifest.

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

## Operations (mostly automated)

- Weekly settlement runs automatically inside the backend; manifests are
  served at `/api/claim/:weekId/:player`.
- Monitor the operator wallet's ETH balance so it can keep paying gas
  for `settleWeek` txs.
- 24-hour veto window: if a bad root lands, owner calls
  `vetoSettlement(weekId)` to roll the pool forward.
- After 4 weeks, owner can call `sweepUnclaimed(weekId)` for any dust.
- Owner may `setPaused(true)` to halt new entries if something looks wrong.

## Risk disclosure

This software is provided as-is. Smart contracts holding ETH on mainnet
without a professional audit carry significant risk of permanent loss.
Players depositing 0.001 ETH should understand that bugs in the contract
or operational failure (lost operator key, misconfigured settlement)
could prevent payouts. Deploy at your own risk.
