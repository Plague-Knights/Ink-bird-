#!/usr/bin/env node
/**
 * Minimal Meshy AI text-to-3D generator.
 *
 * Usage:
 *   MESHY_API_KEY=... node scripts/meshy-generate.mjs \
 *     --prompt "a cartoon squid with iridescent mantle" \
 *     --slug squid \
 *     --output public/models/ \
 *     [--polycount 12000] [--ai-model latest] [--preview-only]
 *
 * Runs the full preview -> refine pipeline by default so the GLB has
 * textures. Pass --preview-only for a faster untextured geometry pass.
 */

import fs from "node:fs";
import path from "node:path";

const API_BASE = "https://api.meshy.ai/openapi";

function parseArgs(argv) {
  const args = { polycount: 12000, aiModel: "latest", previewOnly: false };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case "--prompt": args.prompt = next; i++; break;
      case "--slug": args.slug = next; i++; break;
      case "--output": args.output = next; i++; break;
      case "--polycount": args.polycount = Number(next); i++; break;
      case "--ai-model": args.aiModel = next; i++; break;
      case "--texture-prompt": args.texturePrompt = next; i++; break;
      case "--preview-only": args.previewOnly = true; break;
      default: break;
    }
  }
  if (!args.prompt || !args.slug || !args.output) {
    console.error("Missing required args: --prompt, --slug, --output");
    process.exit(1);
  }
  return args;
}

const key = process.env.MESHY_API_KEY;
if (!key) {
  console.error("MESHY_API_KEY env var required");
  process.exit(1);
}

const headers = {
  "Authorization": `Bearer ${key}`,
  "Content-Type": "application/json",
};

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${url} -> ${res.status}: ${text}`);
  }
  return res.json();
}

async function get(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${url} -> ${res.status}: ${text}`);
  }
  return res.json();
}

async function poll(endpoint, taskId, label) {
  const start = Date.now();
  let lastProgress = -1;
  // Meshy docs suggest 5s polls; most tasks finish in 30s-5min.
  while (true) {
    const res = await get(`${API_BASE}${endpoint}/${taskId}`);
    const status = res.status;
    if (status !== "PENDING" && status !== "IN_PROGRESS" && status !== "QUEUED") {
      console.log(`[${label}] terminal status: ${status} after ${Math.round((Date.now() - start) / 1000)}s`);
      return res;
    }
    if (typeof res.progress === "number" && res.progress !== lastProgress) {
      console.log(`[${label}] ${status} ${res.progress}%`);
      lastProgress = res.progress;
    }
    if (Date.now() - start > 15 * 60 * 1000) {
      throw new Error(`${label} timed out after 15m`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function download(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download ${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`Generating "${args.slug}" from prompt: "${args.prompt}"`);
  console.log(`Polycount target: ${args.polycount}, AI model: ${args.aiModel}`);

  // Preview pass: geometry only, no textures.
  const preview = await post(`${API_BASE}/v2/text-to-3d`, {
    mode: "preview",
    prompt: args.prompt,
    ai_model: args.aiModel,
    topology: "triangle",
    target_polycount: args.polycount,
  });
  console.log(`Preview task created: ${preview.result}`);
  const previewId = preview.result;
  const previewResult = await poll("/v2/text-to-3d", previewId, "preview");
  if (previewResult.status !== "SUCCEEDED") {
    console.error("Preview failed:", JSON.stringify(previewResult, null, 2));
    process.exit(1);
  }

  let finalUrl = previewResult.model_urls?.glb;
  let finalId = previewId;

  if (!args.previewOnly) {
    // Refine pass: adds PBR textures bound to the preview geometry.
    const refine = await post(`${API_BASE}/v2/text-to-3d`, {
      mode: "refine",
      preview_task_id: previewId,
      enable_pbr: true,
      ...(args.texturePrompt ? { texture_prompt: args.texturePrompt } : {}),
    });
    console.log(`Refine task created: ${refine.result}`);
    const refineId = refine.result;
    const refineResult = await poll("/v2/text-to-3d", refineId, "refine");
    if (refineResult.status !== "SUCCEEDED") {
      console.error("Refine failed:", JSON.stringify(refineResult, null, 2));
      process.exit(1);
    }
    finalUrl = refineResult.model_urls?.glb;
    finalId = refineId;
  }

  if (!finalUrl) {
    console.error("No GLB URL in result");
    process.exit(1);
  }

  const outPath = path.join(args.output, `${args.slug}.glb`);
  const bytes = await download(finalUrl, outPath);
  console.log(`Downloaded ${args.slug}.glb (${bytes} bytes) -> ${outPath}`);

  const metaPath = path.join(args.output, `${args.slug}.meta.json`);
  fs.writeFileSync(metaPath, JSON.stringify({
    slug: args.slug,
    prompt: args.prompt,
    polycount: args.polycount,
    aiModel: args.aiModel,
    previewTaskId: previewId,
    refineTaskId: args.previewOnly ? null : finalId,
    glbUrl: finalUrl,
    generatedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`Wrote meta: ${metaPath}`);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
