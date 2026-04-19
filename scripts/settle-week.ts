// Local CLI that completes weekly settlement. The production web server no
// longer holds SETTLER_PRIVATE_KEY — this script is the ONLY place that
// signs settleWeek() transactions, so the key stays on the admin's laptop.
//
// Usage:
//   export API_URL=https://ink-bird.up.railway.app
//   export ADMIN_SECRET=...          # same value as the web server
//   export SETTLER_PRIVATE_KEY=0x... # ink chain EOA with gas
//   export INK_NETWORK=sepolia       # or "mainnet"
//   pnpm exec tsx scripts/settle-week.ts --week 12
//
// Flow:
//   1. POST {API_URL}/api/admin/settle?week=N → DB writes Settlement +
//      ClaimProofs, returns { root, totalPayout, winners }.
//   2. Local wallet signs + broadcasts settleWeek(weekId, root).
//   3. POST {API_URL}/api/admin/settle/record with the tx hash to close
//      out the DB row.
//
// If step 2 or 3 fails the CLI is safe to re-run — the server returns the
// same stored root on step 1, and step 3 rejects a conflicting hash.

import { createWalletClient, createPublicClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ink, inkSepolia } from "../src/config/chains";
import { getContracts } from "../src/config/contracts";
import { InkSquidArcadeAbi } from "../src/config/abis/InkSquidArcade";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var ${name}`);
    process.exit(1);
  }
  return v;
}

function parseWeek(argv: string[]): number {
  const i = argv.indexOf("--week");
  if (i < 0 || !argv[i + 1]) {
    console.error("Usage: tsx scripts/settle-week.ts --week <id>");
    process.exit(1);
  }
  const week = Number(argv[i + 1]);
  if (!Number.isInteger(week) || week < 0) {
    console.error("Invalid --week value");
    process.exit(1);
  }
  return week;
}

async function main() {
  const week = parseWeek(process.argv.slice(2));
  const apiUrl = requireEnv("API_URL").replace(/\/$/, "");
  const adminSecret = requireEnv("ADMIN_SECRET");
  const settlerKey = requireEnv("SETTLER_PRIVATE_KEY") as Hex;
  const network = process.env.INK_NETWORK ?? "sepolia";
  const chain = network === "mainnet" ? ink : inkSepolia;
  const contracts = getContracts(chain.id);

  console.log(`[1/3] prepare settlement on server (week=${week})`);
  const prepRes = await fetch(`${apiUrl}/api/admin/settle?week=${week}`, {
    method: "POST",
    headers: { "x-admin-secret": adminSecret },
  });
  const prepBody = await prepRes.json();
  if (!prepRes.ok) {
    console.error(`server rejected prepare: ${prepRes.status}`, prepBody);
    process.exit(1);
  }
  if (prepBody.txHash) {
    console.log(`already settled: tx ${prepBody.txHash}`);
    process.exit(0);
  }
  const root = prepBody.root as Hex;
  const winners = prepBody.winners as number;
  const totalPayout = prepBody.totalPayout as string;
  console.log(`  root=${root}`);
  console.log(`  winners=${winners}  totalPayout=${totalPayout} wei`);
  if (prepBody.resumed) console.log("  (resumed — DB already had this settlement)");

  console.log(`[2/3] broadcast settleWeek on ${chain.name}`);
  const account = privateKeyToAccount(settlerKey);
  const wallet = createWalletClient({ account, chain, transport: http() });
  const pub = createPublicClient({ chain, transport: http() });
  const txHash = await wallet.writeContract({
    address: contracts.arcade,
    abi: InkSquidArcadeAbi,
    functionName: "settleWeek",
    args: [BigInt(week), root],
  });
  console.log(`  tx=${txHash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    console.error(`  tx reverted: ${txHash}`);
    process.exit(1);
  }
  console.log(`  mined in block ${receipt.blockNumber}`);

  console.log(`[3/3] record tx hash on server`);
  const recRes = await fetch(`${apiUrl}/api/admin/settle/record`, {
    method: "POST",
    headers: {
      "x-admin-secret": adminSecret,
      "content-type": "application/json",
    },
    body: JSON.stringify({ weekId: week, txHash }),
  });
  const recBody = await recRes.json();
  if (!recRes.ok) {
    console.error(`server rejected record: ${recRes.status}`, recBody);
    console.error(`tx is on-chain at ${txHash} — patch DB manually or rerun`);
    process.exit(1);
  }
  console.log(`  done — week ${week} settled`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
