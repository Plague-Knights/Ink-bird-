"use client";

// Static preview of the "pick your target" mechanic — player chooses a
// target multiplier from a vertical ladder of chests. Hit = paid at the
// target, miss = lose the bet. Reuses the pipes-game ocean atmosphere
// (teal → deep-blue gradient, shimmer, light shafts, kelp, bubbles) so
// it matches the current squid game we're deploying.

import { useEffect, useRef, useState } from "react";
import { GROUND_H } from "@/lib/simulate";
import { drawChest, drawDroplet } from "@/lib/gameArt";

const PREVIEW_W = 960;
const PREVIEW_H = 620;

type Bubble = { x: number; y: number; r: number; tw: number };
type Weed = { x: number; w: number; h: number; layer: 0 | 1 };

// 92.8% RTP target ladder — hit_prob = 0.928 / target. The top rung
// (100×) is low probability but included so the ladder has a true
// "moonshot" tier that mirrors the original jackpot rung.
const TARGETS = [
  { mult: 1.05, hit: 0.884, tier: 0 as const },
  { mult: 1.20, hit: 0.773, tier: 0 as const },
  { mult: 1.50, hit: 0.619, tier: 1 as const },
  { mult: 2.00, hit: 0.464, tier: 1 as const },
  { mult: 3.00, hit: 0.309, tier: 2 as const },
  { mult: 5.00, hit: 0.186, tier: 2 as const },
  { mult: 10.0, hit: 0.093, tier: 3 as const },
  { mult: 25.0, hit: 0.037, tier: 3 as const },
];

export function TargetPickPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedIdx, setSelectedIdx] = useState(3); // default on 2.00×
  const [bet, setBet] = useState(0.01);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;

    const bubbles: Bubble[] = [];
    for (let i = 0; i < 48; i++) {
      bubbles.push({
        x: (i * 97) % PREVIEW_W,
        y: 30 + ((i * 173) % (PREVIEW_H - GROUND_H - 60)),
        r: 1.2 + ((i * 7) % 20) / 10,
        tw: i,
      });
    }
    const weeds: Weed[] = [];
    for (let i = 0; i < 6; i++) weeds.push({ layer: 0, x: i * 170 + 30, w: 150, h: 80 });
    for (let i = 0; i < 6; i++) weeds.push({ layer: 1, x: i * 200 + 100, w: 180, h: 120 });

    let raf = 0;
    let frame = 0;
    const tick = () => {
      frame++;
      render(ctx, bubbles, weeds, frame, selectedIdx);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [selectedIdx]);

  const selected = TARGETS[selectedIdx]!;
  const potential = bet * selected.mult;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: 16 }}>
      <div style={{ position: "relative" }}>
        <canvas
          ref={canvasRef}
          width={PREVIEW_W}
          height={PREVIEW_H}
          style={{
            width: "100%",
            height: "auto",
            aspectRatio: `${PREVIEW_W} / ${PREVIEW_H}`,
            background: "#021830",
            border: "1px solid rgba(120, 200, 255, 0.18)",
            borderRadius: 14,
            display: "block",
          }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={panelCss}>
          <div style={labelCss}>your bet</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <input
              type="number"
              step={0.001}
              min={0.001}
              max={0.1}
              value={bet}
              onChange={e => setBet(Math.max(0.001, Math.min(0.1, parseFloat(e.target.value) || 0.001)))}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                color: "#cfe7ff",
                fontSize: 22,
                fontWeight: 700,
                outline: "none",
                fontFamily: "inherit",
                width: 0,
              }}
            />
            <span style={{ color: "#7b94b8", fontSize: 12 }}>ETH</span>
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
            {[0.001, 0.005, 0.01, 0.025].map(v => (
              <button key={v} onClick={() => setBet(v)} style={{
                flex: 1, padding: "4px 0", fontSize: 10,
                background: bet === v ? "rgba(127,227,255,0.2)" : "rgba(127,227,255,0.06)",
                border: `1px solid ${bet === v ? "#7fe3ff" : "rgba(127,227,255,0.2)"}`,
                color: "#cfe7ff", borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
              }}>{v}</button>
            ))}
          </div>
        </div>

        <div style={{ ...labelCss, padding: "0 2px" }}>pick your target</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {TARGETS.map((t, i) => {
            const sel = i === selectedIdx;
            return (
              <button
                key={t.mult}
                onClick={() => setSelectedIdx(i)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "60px 1fr 64px",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  background: sel ? "linear-gradient(90deg, rgba(255,215,106,0.18), rgba(127,227,255,0.12))" : "rgba(2,24,48,0.6)",
                  border: `1px solid ${sel ? "#ffd76a" : "rgba(127,227,255,0.2)"}`,
                  borderRadius: 8,
                  color: "#cfe7ff",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  boxShadow: sel ? "0 0 0 1px rgba(255,215,106,0.25), 0 6px 16px rgba(255,215,106,0.12)" : "none",
                  transition: "all 0.12s ease",
                }}
              >
                <span style={{ fontWeight: 800, fontSize: 15, color: sel ? "#ffd76a" : "#cfe7ff", textAlign: "left" }}>
                  {t.mult.toFixed(t.mult < 10 ? 2 : 0)}×
                </span>
                <div style={{ position: "relative", height: 5, background: "rgba(127,227,255,0.1)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{
                    position: "absolute", left: 0, top: 0, bottom: 0,
                    width: `${t.hit * 100}%`,
                    background: sel ? "linear-gradient(90deg,#ffd76a,#fff6c8)" : "linear-gradient(90deg,#2a9ac2,#7fe3ff)",
                  }} />
                </div>
                <span style={{ textAlign: "right", fontSize: 11, fontFamily: "ui-monospace, monospace", color: sel ? "#fff" : "#7b94b8" }}>
                  {(t.hit * 100).toFixed(1)}%
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <div style={panelCss}>
            <div style={labelCss}>if hit</div>
            <div style={{ color: "#7fe3ff", fontWeight: 700, fontSize: 16 }}>+{potential.toFixed(4)}</div>
          </div>
          <div style={panelCss}>
            <div style={labelCss}>if miss</div>
            <div style={{ color: "#ff8a9a", fontWeight: 700, fontSize: 16 }}>−{bet.toFixed(4)}</div>
          </div>
        </div>

        <button style={{
          padding: 14,
          background: "linear-gradient(180deg,#ffd76a 0%,#e0a020 100%)",
          color: "#1a0a00",
          border: "none",
          borderRadius: 10,
          fontWeight: 800,
          fontSize: 13,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          cursor: "pointer",
          boxShadow: "0 8px 22px rgba(255,215,106,0.25)",
          fontFamily: "inherit",
        }}>
          launch for {selected.mult.toFixed(selected.mult < 10 ? 2 : 0)}×
        </button>

        <div style={{ fontSize: 11, color: "#7b94b8", lineHeight: 1.5, padding: "0 2px" }}>
          Pick a target multiplier. If the seeded roll lands on or above your target, you hit — paid at the target, not the roll. One decision, one result. RTP 92.8%.
        </div>
      </div>
    </div>
  );
}

const panelCss: React.CSSProperties = {
  background: "rgba(2,24,48,0.6)",
  border: "1px solid rgba(127,227,255,0.22)",
  borderRadius: 10,
  padding: "10px 12px",
};
const labelCss: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: "0.18em",
  color: "#7b94b8",
  textTransform: "uppercase",
  marginBottom: 4,
};

// ─── scene render ───────────────────────────────────────────────────
function render(
  ctx: CanvasRenderingContext2D,
  bubbles: Bubble[],
  weeds: Weed[],
  frame: number,
  selectedIdx: number,
) {
  const W2 = PREVIEW_W, H2 = PREVIEW_H;
  ctx.clearRect(0, 0, W2, H2);

  // Pipes-game ocean gradient (exact colors from Game.tsx / LauncherPreview)
  const sky = ctx.createLinearGradient(0, 0, 0, H2 - GROUND_H);
  sky.addColorStop(0, "#7ad3e0");
  sky.addColorStop(0.25, "#2a9ac2");
  sky.addColorStop(0.6, "#0e4a7c");
  sky.addColorStop(1, "#041a3a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W2, H2 - GROUND_H);

  // Surface shimmer
  const shimmer = ctx.createLinearGradient(0, 0, 0, 40);
  shimmer.addColorStop(0, "rgba(255,255,255,0.35)");
  shimmer.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shimmer;
  ctx.fillRect(0, 0, W2, 40);

  // Light shafts
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 7; i++) {
    const baseX = ((i * 160 + frame * 0.4) % (W2 + 240)) - 120;
    ctx.fillStyle = "rgba(200, 230, 255, 0.05)";
    ctx.beginPath();
    ctx.moveTo(baseX, 0);
    ctx.lineTo(baseX + 50, 0);
    ctx.lineTo(baseX + 260, H2 - GROUND_H);
    ctx.lineTo(baseX + 210, H2 - GROUND_H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // Bubbles
  for (const b of bubbles) {
    const a = 0.35 + Math.sin(b.tw + frame * 0.03) * 0.15;
    ctx.strokeStyle = `rgba(220,240,255,${a + 0.35})`;
    ctx.lineWidth = 1;
    ctx.fillStyle = `rgba(180,220,255,${a * 0.35})`;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Kelp
  const baseY = H2 - GROUND_H;
  for (const h of weeds) {
    const isFar = h.layer === 0;
    ctx.strokeStyle = isFar ? "rgba(25,90,80,0.55)" : "rgba(10,60,45,0.95)";
    ctx.lineWidth = isFar ? 3 : 5;
    ctx.lineCap = "round";
    const blades = isFar ? 3 : 4;
    for (let i = 0; i < blades; i++) {
      const bx = h.x + (i + 0.5) * (h.w / blades);
      const bladeH = h.h * 0.85;
      ctx.beginPath();
      ctx.moveTo(bx, baseY);
      for (let st = 1; st <= 5; st++) {
        const t = st / 5;
        const wy = baseY - t * bladeH;
        const wx = bx + Math.sin(frame * 0.04 + i * 0.9 + h.x * 0.02 + t * 2) * 7 * t;
        ctx.lineTo(wx, wy);
      }
      ctx.stroke();
    }
  }

  // Ground
  const ground = ctx.createLinearGradient(0, H2 - GROUND_H, 0, H2);
  ground.addColorStop(0, "#d5b47c");
  ground.addColorStop(1, "#6f4c22");
  ctx.fillStyle = ground;
  ctx.fillRect(0, H2 - GROUND_H, W2, GROUND_H);
  ctx.fillStyle = "rgba(40,25,8,0.4)";
  ctx.fillRect(0, H2 - GROUND_H, W2, 2);

  // ── Chest ladder — vertical stack, selected chest highlighted ──
  const chestX = W2 * 0.72;
  const topY = 80;
  const bottomY = H2 - GROUND_H - 50;
  const spacing = (bottomY - topY) / (TARGETS.length - 1);

  // Draw faint guide line down the ladder
  ctx.strokeStyle = "rgba(127, 227, 255, 0.15)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.moveTo(chestX, topY - 10);
  ctx.lineTo(chestX, bottomY + 10);
  ctx.stroke();
  ctx.setLineDash([]);

  TARGETS.forEach((t, i) => {
    // Array index 0 = easiest (1.05×), we want it at the bottom
    const y = bottomY - i * spacing;
    drawChest(ctx, chestX, y, frame, t.tier);
    const isSel = i === selectedIdx;
    // label
    if (isSel) {
      // highlight ring
      ctx.strokeStyle = "#ffd76a";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      ctx.shadowColor = "rgba(255, 215, 106, 0.8)";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(chestX, y, 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // gold badge above chest
      const bx = chestX - 50, by = y - 38;
      ctx.fillStyle = "#ffd76a";
      roundRect(ctx, bx, by, 100, 20, 5); ctx.fill();
      ctx.fillStyle = "#1a0a00";
      ctx.font = 'bold 11px "Rubik", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText("YOUR TARGET", chestX, by + 13);
      // arrow
      ctx.fillStyle = "#ffd76a";
      ctx.beginPath();
      ctx.moveTo(chestX - 5, by + 20);
      ctx.lineTo(chestX + 5, by + 20);
      ctx.lineTo(chestX, by + 26);
      ctx.closePath();
      ctx.fill();
    }
    ctx.font = isSel ? 'bold 16px "Rubik", sans-serif' : '600 13px "Rubik", sans-serif';
    ctx.fillStyle = isSel ? "#ffd76a" : "#cfe7ff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(t.mult.toFixed(t.mult < 10 ? 2 : 0) + "×", chestX + 22, y);
    ctx.font = "500 10px ui-monospace, monospace";
    ctx.fillStyle = isSel ? "rgba(255,215,106,0.8)" : "rgba(127,227,255,0.55)";
    ctx.fillText((t.hit * 100).toFixed(1) + "% hit", chestX + 22, y + 13);
  });
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";

  // ── Decorative ink drops scattered left side ──
  drawDroplet(ctx, 180, 180, 7, frame);
  drawDroplet(ctx, 120, 360, 6, frame + 20);
  drawDroplet(ctx, 280, 480, 8, frame + 10);
  drawDroplet(ctx, 440, 180, 6, frame + 33);
  drawDroplet(ctx, 560, 340, 7, frame + 15);

  // ── Squid on launch pad (bottom left), drawn with LauncherPreview-style position ──
  drawSquidStatic(ctx, 200, H2 - GROUND_H - 46, frame);

  // Launch pad hint under squid
  ctx.strokeStyle = "rgba(255, 215, 106, 0.45)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.ellipse(200, H2 - GROUND_H - 8, 38, 6, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Angle/aim line from squid up to selected chest
  const targetY = bottomY - selectedIdx * spacing;
  ctx.strokeStyle = "rgba(255, 215, 106, 0.6)";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(210, H2 - GROUND_H - 46);
  ctx.bezierCurveTo(420, H2 - GROUND_H - 100, 600, targetY + 30, chestX - 24, targetY);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── HUD overlays (top) ──
  ctx.fillStyle = "rgba(2,24,48,0.78)";
  roundRect(ctx, 24, 24, 180, 36, 10); ctx.fill();
  ctx.strokeStyle = "rgba(127,227,255,0.35)";
  ctx.lineWidth = 1;
  roundRect(ctx, 24, 24, 180, 36, 10); ctx.stroke();
  ctx.fillStyle = "#7b94b8";
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText("INK SQUID", 38, 42);
  ctx.fillStyle = "#cfe7ff";
  ctx.font = '600 12px "Rubik", sans-serif';
  ctx.fillText("ink sepolia", 38, 54);

  // RTP pill
  ctx.fillStyle = "rgba(2,24,48,0.78)";
  roundRect(ctx, W2 - 220, 24, 196, 36, 10); ctx.fill();
  ctx.strokeStyle = "rgba(127,227,255,0.35)";
  roundRect(ctx, W2 - 220, 24, 196, 36, 10); ctx.stroke();
  ctx.fillStyle = "#7b94b8";
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText("RTP", W2 - 206, 42);
  ctx.fillStyle = "#7fe3ff";
  ctx.font = 'bold 14px "Rubik", sans-serif';
  ctx.fillText("92.8%", W2 - 180, 44);
  ctx.fillStyle = "#7b94b8";
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillText("provably fair", W2 - 134, 44);

  // Vignette
  const vig = ctx.createRadialGradient(W2 / 2, H2 / 2, H2 * 0.45, W2 / 2, H2 / 2, H2 * 0.9);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W2, H2);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// A compact static squid, matching drawBird but positioned + scaled
// for the launch-pad pose. Uses the same mantle/eye/arm primitives.
function drawSquidStatic(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number) {
  ctx.save();
  ctx.translate(cx, cy);
  const r = 20;
  const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, r * 2.6);
  glow.addColorStop(0, "rgba(120, 200, 255, 0.22)");
  glow.addColorStop(1, "rgba(120, 200, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(0, 0, r * 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(-0.2);
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath(); ctx.ellipse(0, r + 3, r + 2, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  const mantleLen = r + 9, mantleH = r - 2;
  const waveT = frame * 0.2;
  const armBaseX = -mantleLen * 0.38;
  for (let i = 0; i < 8; i++) {
    const row = (i - 3.5) / 8;
    const yStart = row * (mantleH * 1.1);
    const len = 18 + Math.abs(row) * 5;
    ctx.strokeStyle = "#4a2a9c"; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(armBaseX, yStart);
    for (let s = 1; s <= 5; s++) {
      const t = s / 5;
      ctx.lineTo(armBaseX - t * len, yStart + Math.sin(waveT + i * 0.7 + t * 3) * 4 * t);
    }
    ctx.stroke();
  }
  for (const sign of [-1, 1]) {
    const y0 = sign * mantleH * 0.5;
    ctx.strokeStyle = "#2a1358"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(armBaseX, y0);
    let lx = armBaseX, ly = y0;
    for (let s = 1; s <= 6; s++) {
      const t = s / 6;
      lx = armBaseX - t * 28;
      ly = y0 + Math.sin(waveT * 1.1 + t * 4 + sign) * 5 * t;
      ctx.lineTo(lx, ly);
    }
    ctx.stroke();
    ctx.fillStyle = "#7c4fd6";
    ctx.beginPath(); ctx.ellipse(lx, ly, 3.2, 2.2, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = "#4a2a9c";
  ctx.beginPath();
  ctx.moveTo(-mantleLen * 0.15, -mantleH * 0.9);
  ctx.quadraticCurveTo(-mantleLen * 0.55, -mantleH - 6, -mantleLen * 0.45, -mantleH * 0.6);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-mantleLen * 0.15, mantleH * 0.9);
  ctx.quadraticCurveTo(-mantleLen * 0.55, mantleH + 6, -mantleLen * 0.45, mantleH * 0.6);
  ctx.closePath(); ctx.fill();
  const mantle = ctx.createLinearGradient(0, -mantleH, 0, mantleH);
  mantle.addColorStop(0, "#c8aef5");
  mantle.addColorStop(0.55, "#7c4fd6");
  mantle.addColorStop(1, "#311766");
  ctx.fillStyle = mantle;
  ctx.beginPath();
  ctx.moveTo(mantleLen, 0);
  ctx.bezierCurveTo(mantleLen * 0.6, -mantleH, -mantleLen * 0.3, -mantleH, -mantleLen * 0.4, 0);
  ctx.bezierCurveTo(-mantleLen * 0.3, mantleH, mantleLen * 0.6, mantleH, mantleLen, 0);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath(); ctx.ellipse(mantleLen * 0.1, -mantleH * 0.55, mantleLen * 0.45, mantleH * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  const eyeY = -mantleH * 0.15;
  for (const ex of [mantleLen * 0.4, mantleLen * 0.15]) {
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(ex, eyeY, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#0a0320";
    ctx.beginPath(); ctx.arc(ex + 1, eyeY + 0.5, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(ex + 1.8, eyeY - 0.8, 1, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
