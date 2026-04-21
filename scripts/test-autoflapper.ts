// Quick stats: run N seeds through the auto-flapper plan, print the
// distribution of pipes survived and average drops collected.
import { planAutoFlapper } from "../src/lib/autoFlapper.ts";

const N = 200;
const buckets = new Map();
let totalPipes = 0;
let totalDrops = 0;
let livedPastPipe1 = 0;

for (let i = 0; i < N; i++) {
  const seed = (Math.random() * 0xffffffff) >>> 0;
  const plan = planAutoFlapper(seed);
  const p = plan.pipesPassed;
  buckets.set(p, (buckets.get(p) ?? 0) + 1);
  totalPipes += p;
  totalDrops += plan.dropletsCollected;
  if (p > 0) livedPastPipe1 += 1;
}

console.log(`N=${N}`);
console.log(`avg pipes: ${(totalPipes / N).toFixed(2)}`);
console.log(`avg drops: ${(totalDrops / N).toFixed(2)}`);
console.log(`survival past pipe 1: ${(livedPastPipe1 / N * 100).toFixed(1)}%`);
console.log("pipes histogram:");
for (const k of [...buckets.keys()].sort((a, b) => a - b)) {
  console.log(`  ${k.toString().padStart(3)} pipes: ${buckets.get(k)}`);
}
