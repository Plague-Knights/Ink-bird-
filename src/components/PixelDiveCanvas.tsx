"use client";

import { useEffect, useRef } from "react";

// Pixel art dive scene. Everything is drawn into a tiny low-res offscreen
// canvas (SCENE_W x SCENE_H) and then scaled up with image-rendering:
// pixelated on the visible canvas, so individual pixels stay chunky at
// any display size. No external sprite assets — the squid is a hand-
// painted color grid and the ocean is dithered procedurally.

const SCENE_W = 120;   // internal logical width (pixels)
const SCENE_H = 140;   // internal logical height (pixels)
const MAX_DEPTH_M = 1000;

type Props = {
  distance: number | null;
  animating: boolean;
  onAnimDone: () => void;
};

// Color palette (iridescent squid vibes)
const P = {
  skyTop: "#1a3760",
  skyBot: "#2d6aa3",
  sea0: "#1a5b9a",
  sea1: "#0e3f78",
  sea2: "#061f4a",
  sea3: "#010720",
  sea4: "#000309",
  mantleHi: "#e3d5ff",
  mantleMid: "#9f7cff",
  mantleLo: "#6b53c7",
  fin: "#5fd8ff",
  finLo: "#3a96b5",
  tent: "#7a5fd6",
  tentHi: "#b196ff",
  tentLo: "#4d3a94",
  eye: "#021629",
  eyeIris: "#5fd8ff",
  eyeShine: "#ffffff",
  bubble: "#d0eaff",
  godray: "#a8d8ff",
  depthText: "#78b4d0",
} as const;

// Hand-painted squid, 24x34, indexed palette. Characters map to colors.
// Mantle pointing UP, tentacles hanging DOWN. Drawn in "idle" pose; we
// animate the tentacle rows by cycling through a few hand-painted
// frames below.
//
// . = transparent
// h = mantle hi / sheen
// m = mantle mid
// l = mantle lo
// f = fin
// F = fin lo (shadow)
// t = tentacle mid
// T = tentacle hi (outer feeding arms)
// d = tentacle lo (shadow)
// e = eye
// i = eye iris
// s = eye shine
const SQUID_IDLE = [
  "............mm..........",
  "..........mmmmmm........",
  ".........mmmmmmmm.......",
  "........hmmmmmmmml......",
  ".......hhmmmmmmmmll.....",
  "......fhhmmmmmmmmllF....",
  ".....ffhhmmmmmmmmllFF...",
  "....fffhhmmmmmmmmmllFF..",
  "....ffhmmmmmmmmmmmmllF..",
  "....fhmmmmmmmmmmmmmmlF..",
  "....hmmmmmmmmmmmmmmmmm..",
  "....mmmmmmmmmmmmmmmmmmm.",
  "....mmmmmeiiemmmmmmmmmm.",
  "....mmmmeiiseemmmmmmmmm.",
  "....mmmmeiiiiemmmmmmmmm.",
  "....mmmmeeiiemmmmmmmmmm.",
  "....mmmmmmeemmmmmmmmmmm.",
  "....mmmmmmmmmmmmmmmmmm..",
  "....lmmmmmmmmmmmmmmmll..",
  "....lllmmmmmmmmmmmlllll.",
  "....TddtdtdtdtdtdtdtTT..",
  "....TddtdtdtdtdtdtdtT...",
  ".....Tdtdtdtdtdtdtd.....",
  ".....Ttdtdtdtdtdt.......",
  "......Tdtdtdtdt.........",
  "......Tdtdtdt...........",
  "......Td.tdt............",
  "......T..dt.............",
  ".....T....t.............",
  ".....T..................",
];
const SQUID_SWAY = [
  "............mm..........",
  "..........mmmmmm........",
  ".........mmmmmmmm.......",
  "........hmmmmmmmml......",
  ".......hhmmmmmmmmll.....",
  "......fhhmmmmmmmmllF....",
  ".....ffhhmmmmmmmmllFF...",
  "....fffhhmmmmmmmmmllFF..",
  "....ffhmmmmmmmmmmmmllF..",
  "....fhmmmmmmmmmmmmmmlF..",
  "....hmmmmmmmmmmmmmmmmm..",
  "....mmmmmmmmmmmmmmmmmmm.",
  "....mmmmmeiiemmmmmmmmmm.",
  "....mmmmeiiseemmmmmmmmm.",
  "....mmmmeiiiiemmmmmmmmm.",
  "....mmmmeeiiemmmmmmmmmm.",
  "....mmmmmmeemmmmmmmmmmm.",
  "....mmmmmmmmmmmmmmmmmm..",
  "....lmmmmmmmmmmmmmmmll..",
  "....lllmmmmmmmmmmmlllll.",
  "...TdtdtdtdtdtdtdtdTT...",
  "...TdtdtdtdtdtdtdtdT....",
  "...Tdtdtdtdtdtdtdt......",
  "....tdtdtdtdtdtdt.......",
  ".....dtdtdtdtdt.........",
  ".....tdtdtdt............",
  ".....tdtdt..............",
  ".....tdt................",
  "....T.t.................",
  "...T....................",
];
const SQUID_PROPEL = [
  "............mm..........",
  "..........mmmmmm........",
  ".........mmmmmmmm.......",
  "........hmmmmmmmml......",
  ".......hhmmmmmmmmll.....",
  "......fhhmmmmmmmmllF....",
  ".....ffhhmmmmmmmmllFF...",
  "....fffhhmmmmmmmmmllFF..",
  "....ffhmmmmmmmmmmmmllF..",
  "....fhmmmmmmmmmmmmmmlF..",
  "....hmmmmmmmmmmmmmmmmm..",
  "....mmmmmmmmmmmmmmmmmmm.",
  "....mmmmmeiiemmmmmmmmmm.",
  "....mmmmeiisemmmmmmmmmm.",
  "....mmmmeiiiemmmmmmmmmm.",
  "....mmmmeeiiemmmmmmmmmm.",
  "....mmmmmmeemmmmmmmmmmm.",
  "....mmmmmmmmmmmmmmmmmm..",
  "....lmmmmmmmmmmmmmmmll..",
  "....lllmmmmmmmmmmmlllll.",
  ".....TdtdtdtdtdtdtdT....",
  "......TdtdtdtdtdtdT.....",
  "......tdtdtdtdtdt.......",
  ".......dtdtdtdtd........",
  ".......tdtdtdt..........",
  ".......dtdtd............",
  "........tdt.............",
  "........td..............",
  "........t...............",
  "........................",
];

const FRAMES = [SQUID_IDLE, SQUID_SWAY, SQUID_PROPEL, SQUID_SWAY];

function paletteColor(ch: string): string | null {
  switch (ch) {
    case "h": return P.mantleHi;
    case "m": return P.mantleMid;
    case "l": return P.mantleLo;
    case "f": return P.fin;
    case "F": return P.finLo;
    case "t": return P.tent;
    case "T": return P.tentHi;
    case "d": return P.tentLo;
    case "e": return P.eye;
    case "i": return P.eyeIris;
    case "s": return P.eyeShine;
    default: return null;
  }
}

function drawSquid(
  ctx: CanvasRenderingContext2D,
  frame: string[],
  originX: number,
  originY: number,
) {
  for (let y = 0; y < frame.length; y++) {
    const row = frame[y];
    for (let x = 0; x < row.length; x++) {
      const c = paletteColor(row[x]);
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(originX + x, originY + y, 1, 1);
    }
  }
}

export function PixelDiveCanvas({ distance, animating, onAnimDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bufferRef = useRef<HTMLCanvasElement | null>(null);
  const startRef = useRef<number>(0);
  const bubblesRef = useRef<
    Array<{ x: number; y: number; r: number; vy: number; life: number }>
  >([]);
  const flashRef = useRef<number>(0);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!bufferRef.current) {
      const off = document.createElement("canvas");
      off.width = SCENE_W;
      off.height = SCENE_H;
      bufferRef.current = off;
    }
    const canvas = canvasRef.current;
    const buffer = bufferRef.current!;
    if (!canvas) return;
    const display = canvas.getContext("2d");
    const ctx = buffer.getContext("2d");
    if (!display || !ctx) return;

    display.imageSmoothingEnabled = false;
    ctx.imageSmoothingEnabled = false;

    const surfaceY = 10;

    let raf = 0;
    const draw = (now: number) => {
      ctx.clearRect(0, 0, SCENE_W, SCENE_H);

      // Sky band
      ctx.fillStyle = P.skyBot;
      ctx.fillRect(0, 0, SCENE_W, surfaceY);

      // Ocean band — 5 discrete color bands so it reads as pixel art,
      // not a smooth gradient.
      const bandHeights = [14, 18, 28, 40];
      const colors = [P.sea0, P.sea1, P.sea2, P.sea3, P.sea4];
      let by = surfaceY;
      for (let i = 0; i < colors.length; i++) {
        const h = i < bandHeights.length ? bandHeights[i] : SCENE_H - by;
        ctx.fillStyle = colors[i];
        ctx.fillRect(0, by, SCENE_W, h);
        // Ordered 2x2 Bayer dither between this band and the next, on
        // the top 3 rows of the band below. Keeps the transitions pixel-
        // authentic instead of a gradient.
        if (i < colors.length - 1) {
          for (let dy = 0; dy < 3; dy++) {
            const y = by + h - 1 + dy;
            if (y >= SCENE_H) break;
            for (let x = 0; x < SCENE_W; x++) {
              if (((x + dy) % 2 === 0) && ((x + y) % (2 + dy) === 0)) {
                ctx.fillStyle = colors[i + 1];
                ctx.fillRect(x, y, 1, 1);
              }
            }
          }
        }
        by += h;
      }

      // Surface wave ripple — single-pixel-tall
      for (let x = 0; x < SCENE_W; x++) {
        const y = surfaceY - 1 + Math.round(Math.sin((x + now / 120) / 4) * 0.6);
        ctx.fillStyle = P.bubble;
        ctx.fillRect(x, y, 1, 1);
      }

      // God-ray shafts — 3 shafts, fade with depth
      for (let i = 0; i < 3; i++) {
        const gx = 20 + i * 38 + Math.round(Math.sin(now / 1400 + i) * 3);
        for (let dy = 0; dy < 90; dy++) {
          const y = surfaceY + dy;
          if (y >= SCENE_H) break;
          const alpha = (1 - dy / 90) * 0.22;
          if (Math.random() < alpha) {
            for (let dx = -2; dx <= 2; dx++) {
              const x = gx + dx + Math.round(dy / 20);
              if (x < 0 || x >= SCENE_W) continue;
              if (Math.random() < alpha * 1.4) {
                ctx.fillStyle = P.godray;
                ctx.fillRect(x, y, 1, 1);
              }
            }
          }
        }
      }

      // Depth labels on right edge, pixel-font rendered
      const markers = [100, 250, 500, 750, 1000];
      const depthRange = SCENE_H - surfaceY - 10;
      ctx.fillStyle = P.depthText;
      ctx.font = "6px monospace";
      ctx.textAlign = "right";
      for (const m of markers) {
        const y = surfaceY + (m / MAX_DEPTH_M) * depthRange;
        ctx.fillText(`${m}m`, SCENE_W - 2, Math.round(y) + 2);
      }
      ctx.textAlign = "start";

      // Figure out where the squid is right now
      const cx = SCENE_W / 2;
      const squidCX = Math.round(cx - 12); // sprite is 24 wide
      let squidY = surfaceY;
      let dispDepth = 0;
      if (distance != null) {
        const clamped = Math.min(distance, MAX_DEPTH_M);
        const target = surfaceY + (clamped / MAX_DEPTH_M) * depthRange;
        if (animating) {
          if (startRef.current === 0) startRef.current = now;
          const t = Math.min(1, (now - startRef.current) / 1800);
          const eased = 1 - Math.pow(1 - t, 3);
          squidY = surfaceY + eased * (target - surfaceY);
          dispDepth = Math.round(eased * clamped);
          if (t >= 1 && !doneRef.current) {
            doneRef.current = true;
            if (flashRef.current === 0) flashRef.current = 1;
            onAnimDone();
          }
        } else {
          squidY = target;
          dispDepth = clamped;
        }
      }

      // Bubble trail while diving
      if (animating && now - (bubblesRef.current.at(-1)?.life ?? 0) > 40) {
        bubblesRef.current.push({
          x: cx + (Math.random() - 0.5) * 8,
          y: squidY,
          r: 1 + Math.random(),
          vy: 0.3 + Math.random() * 0.4,
          life: now,
        });
      }
      for (let i = bubblesRef.current.length - 1; i >= 0; i--) {
        const b = bubblesRef.current[i];
        b.y -= b.vy;
        if (b.y < surfaceY - 1 || now - b.life > 4000) {
          bubblesRef.current.splice(i, 1);
          continue;
        }
        ctx.fillStyle = P.bubble;
        ctx.fillRect(Math.round(b.x), Math.round(b.y), Math.max(1, Math.round(b.r)), Math.max(1, Math.round(b.r)));
      }

      // Squid sprite with frame cycling
      const frameIdx = Math.floor(now / 160) % FRAMES.length;
      drawSquid(ctx, FRAMES[frameIdx], squidCX, Math.round(squidY) - 12);

      // Live depth chip while moving
      if (distance != null && animating) {
        const text = `${dispDepth}m`;
        ctx.font = "bold 7px monospace";
        const tw = ctx.measureText(text).width;
        const bx = Math.round(cx + 14);
        const by = Math.round(squidY) - 6;
        ctx.fillStyle = P.sea3;
        ctx.fillRect(bx - 1, by - 6, tw + 4, 8);
        ctx.fillStyle = P.eyeIris;
        ctx.fillText(text, bx, by);
      }

      // Reveal flash
      if (flashRef.current > 0) {
        const a = flashRef.current;
        const r = Math.round(14 + (1 - a) * 40);
        ctx.globalAlpha = a * 0.6;
        ctx.fillStyle = "#ffe38a";
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > r * r) continue;
            if (dx * dx + dy * dy < (r - 2) * (r - 2)) continue;
            const x = Math.round(cx + dx);
            const y = Math.round(squidY + dy);
            if (x < 0 || x >= SCENE_W || y < 0 || y >= SCENE_H) continue;
            ctx.fillRect(x, y, 1, 1);
          }
        }
        ctx.globalAlpha = 1;
        flashRef.current = Math.max(0, flashRef.current - 0.04);
      }

      // Settled gold depth stamp below the squid
      if (distance != null && !animating) {
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffe38a";
        ctx.fillText(`${distance} m`, Math.round(cx), Math.round(squidY) + 30);
        ctx.textAlign = "start";
      }

      // Blit upscaled to the visible canvas. image-rendering: pixelated
      // handles the crisp scaling without interpolation.
      display.clearRect(0, 0, canvas.width, canvas.height);
      display.drawImage(buffer, 0, 0, SCENE_W, SCENE_H, 0, 0, canvas.width, canvas.height);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [distance, animating, onAnimDone]);

  useEffect(() => {
    if (animating) {
      startRef.current = 0;
      bubblesRef.current = [];
      flashRef.current = 0;
      doneRef.current = false;
    }
  }, [animating]);

  return (
    <div className="dive-canvas-wrap">
      <canvas
        ref={canvasRef}
        width={SCENE_W * 4}
        height={SCENE_H * 4}
        className="dive-canvas pixel-canvas"
      />
    </div>
  );
}
