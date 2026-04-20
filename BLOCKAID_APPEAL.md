# Blockaid / Zerion False-Positive Appeal — Ink Squid

Zerion Wallet (via its Blockaid integration) is flagging `squid.inkswap.io` as a
"Malicious DApp" and blocking wallet connections. This document is the
ready-to-submit appeal payload for both Blockaid's false-positive portal and
Zerion's security team.

---

## Where to submit

1. **Blockaid false-positive portal (primary):** https://report.blockaid.io/mistake
2. **Blockaid verified-project intake (secondary, for pre-emptive allowlisting):** https://report.blockaid.io/verifiedProject
3. **Blockaid general contact (fallback):** https://www.blockaid.io/contact
4. **Zerion security team:** security@zerion.io
   (Zerion's phishing protection is powered by Blockaid's dApp Scanning API, so
   the Blockaid submission is the root fix; email Zerion in parallel so they
   can clear any cached verdict.)

---

## Appeal payload (copy/paste into the forms)

**dApp name:** Ink Squid

**dApp URL:** https://squid.inkswap.io

**Parent domain:** inkswap.io (registered 2026-04-17 via NameCheap; newly-
registered domain age is the most likely heuristic trigger)

**Category:** Gaming / Skill game (Flappy-Bird-style arcade)

**Chain:** Ink (mainnet chainId 57073, https://inkonchain.com)

**Short description:**
Ink Squid is a wallet-gated skill game on the Ink L2. Players connect a
wallet, buy "attempts" in ETH from an on-chain Arcade contract, play a
deterministic Flappy-Bird-style canvas game, and the weekly leaderboard is
settled off-chain into a merkle root that winners claim from the same
contract. No token sales, no approvals of arbitrary ERC-20s, no permit
signatures, no proxy upgrades requested from users. The only wallet
interactions are (a) a SIWE Sign-In-With-Ethereum message for the
leaderboard session, (b) a direct ETH value transfer to buy attempts, and
(c) a merkle claim() call to withdraw prize payouts.

**Owner / primary contact:** crowderw16@gmail.com

**Security contact:** see https://squid.inkswap.io/.well-known/security.txt
(RFC 9116)

**GitHub source (public):** https://github.com/Plague-Knights/Ink-bird-
The entire front-end source — wagmi config, SIWE flow, API routes, game
simulation, merkle settlement — is open and auditable.

**On-chain Arcade contract (Ink mainnet):**
0x0EcE8596af427a45e19e4A4e5c7068BcF3d7B912
(Explorer: https://explorer.inkonchain.com/address/0x0EcE8596af427a45e19e4A4e5c7068BcF3d7B912)

**Contract source:** sibling repo under the same GitHub org
(Plague-Knights). Hardhat 3 + Ignition deploy. Source verified on the Ink
explorer.

**Hosting / deployment:** Railway (Nixpacks, Next.js 15 standalone output).
`squid.inkswap.io` CNAMEs to the Railway deployment; TLS via Cloudflare.

**Wallet stack:** RainbowKit v2 + wagmi v2 + viem v2. Connections go through
WalletConnect v2 and injected connectors only. No custom wallet popups, no
clipboard manipulation, no address-replacement, no transaction hiding.

---

## Why this is almost certainly a false positive

1. **Domain age.** `inkswap.io` was registered on 2026-04-17, ~48 hours
   before the flag appeared. New-domain age is the single strongest signal
   for generic phishing heuristics and is the most likely trigger here.
2. **No drainer patterns.** The site never requests `approve`,
   `setApprovalForAll`, `permit`, or `increaseAllowance` on any token.
   The only ETH-moving calls are (a) payable `buyAttempts()` with an ETH
   value the user enters, and (b) `claim(weekId, amount, proof)` which
   *pays out* to the user, never pulls from them.
3. **No admin-key signature prompts to end users.** Settlement is done on a
   separate admin laptop with a settler key that never touches the web
   tier.
4. **Public source code.** The entire stack is in a public GitHub repo
   owned by the Plague-Knights org.
5. **Standard auth.** SIWE (EIP-4361) with an iron-session cookie. The
   server verifies nonces and signatures — exactly the pattern Blockaid's
   own documentation recommends.

---

## Evidence bundle

Attach / link these in the submission:

- Live site: https://squid.inkswap.io
- security.txt: https://squid.inkswap.io/.well-known/security.txt
- GitHub repo: https://github.com/Plague-Knights/Ink-bird-
- Arcade contract on Ink mainnet: https://explorer.inkonchain.com/address/0x0EcE8596af427a45e19e4A4e5c7068BcF3d7B912
- Screenshot of the Zerion/Blockaid warning (user has this; attach to the form)
- Ink chain docs (for reviewer context): https://docs.inkonchain.com

---

## Suggested form message body

> Hi Blockaid team,
>
> `squid.inkswap.io` is being flagged as a Malicious DApp in Zerion Wallet
> (Blockaid-powered), which is blocking legitimate wallet connections. I
> believe this is a false positive driven by the parent domain
> (`inkswap.io`) being only two days old.
>
> Ink Squid is a wallet-gated skill game on the Ink L2. The front-end is
> open-source at https://github.com/Plague-Knights/Ink-bird- and the on-
> chain Arcade contract is deployed at
> 0x0EcE8596af427a45e19e4A4e5c7068BcF3d7B912 on Ink mainnet. The only
> wallet interactions are a SIWE sign-in, a payable `buyAttempts()` ETH
> transfer, and a merkle `claim()` for weekly leaderboard payouts — no
> ERC-20 approvals, no `permit`, no proxy upgrades, no approval scraping.
>
> security.txt: https://squid.inkswap.io/.well-known/security.txt
> Contact: crowderw16@gmail.com
>
> Please re-review and remove the malicious flag. Happy to provide any
> additional evidence needed.
>
> Thanks,
> Ink Squid team
