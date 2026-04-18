import crypto from "node:crypto";

const MAX = Number(process.env.MAX_SCORE_PER_RUN || "1000");

/**
 * Verify a submitted run. v1 uses sanity + input-hash replay protection.
 * A future iteration should run a deterministic replay of the game with
 * the session's seed + recorded inputs and check the final score matches.
 */
export function validateRun({ session, score, inputs, inputsHash }) {
  if (typeof score !== "number" || !Number.isFinite(score)) return { ok: false, reason: "bad score" };
  if (score < 0 || score > MAX) return { ok: false, reason: "score out of range" };
  if (!Array.isArray(inputs)) return { ok: false, reason: "bad inputs" };
  if (inputs.length > 20000) return { ok: false, reason: "too many inputs" };
  if (inputs.some((t) => typeof t !== "number" || t < 0 || t > 10 * 60 * 60)) {
    return { ok: false, reason: "bad input value" };
  }

  const canonical = JSON.stringify({ seed: session.seed, inputs });
  const h = crypto.createHash("sha256").update(canonical).digest("hex");
  if (h !== inputsHash) return { ok: false, reason: "hash mismatch" };

  // Sanity: minimum input rate for score. A legitimate flap-per-pipe run
  // will have roughly >= score flaps. Reject bots submitting score with
  // zero inputs.
  if (score > 0 && inputs.length < score) {
    return { ok: false, reason: "insufficient inputs for score" };
  }

  return { ok: true };
}
