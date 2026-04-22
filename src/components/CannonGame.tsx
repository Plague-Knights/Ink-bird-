"use client";

// Playable cannon game. One input (FIRE), the InkSquidCannon contract
// rolls a continuous distance, client animates the squid flying to
// that distance. Mirrors ChestsGame's commit-reveal plumbing but uses
// /api/fire/* instead of /api/chest/*.

import { useEffect, useMemo, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useAccount, useChainId, useSwitchChain,
  useWriteContract, useReadContract, useWaitForTransactionReceipt,
} from "wagmi";
import { formatEther, parseEther } from "viem";
import {
  CANNON_ABI, cannonAddressForChain, explorerForCannonChain,
  distanceBpToMeters, distanceBpToMultiplier,
} from "@/lib/cannonContract";
import { inkSepolia, soneiumMinato } from "@/config/chains";
import { GROUND_H, type Bird } from "@/lib/simulate";
import { drawBird } from "@/lib/gameArt";

const SUPPORTED_CHAINS = [inkSepolia, soneiumMinato] as const;
// Round-state polling cadence. Under 1s stresses the DB on Railway
// without meaningfully speeding up reveal; 1s is the useful floor.
const POLL_MS = 1000;

type RoundStatus =
  | { status: "idle" }
  | { status: "opening" }
  | { status: "awaiting_play" }
  | { status: "revealing" }
  | {
      status: "resolved";
      betWei: string;
      payoutWei: string;
      distanceBp: number;
      txReveal?: string;
    }
  | { status: "error"; error: string };

// World dimensions — the scene is bigger than any one viewport. The
// canvas shows a zoomed-in side-scroller window into this world and the
// camera pans as the squid flies, so nothing ever looks tiny.
const WORLD_W = 2400;
const WORLD_H = 1200;
// Scene content is placed between stripStart and stripEnd in world
// coordinates — the cannon sits at world x=92, the ground strip fills
// from 150 to WORLD_W-40.
const STRIP_START = 150;
const STRIP_END = WORLD_W - 40;
// Max visual distance = 500m maps to frac = 0.95 of the usable strip.
function fracFromMeters(m: number): number {
  const clamped = Math.max(0, Math.min(500, m));
  return 0.05 + (clamped / 500) * 0.9;
}

// Angle range (degrees) the player can pick before firing.
const MIN_ANGLE = 20;
const MAX_ANGLE = 75;
const DEFAULT_ANGLE = 45;
// Squid flight animation length, in rAF frames (~60fps). Long + slow so
// the squid has time to bounce off stuff and every round feels like a
// little journey rather than a snap-to-landing.
const FLIGHT_FRAMES = 200;
// After landing, the squid tumbles on the ground for these many frames
// before coming to rest. Adds drama without changing the payout spot.
const TUMBLE_FRAMES = 50;
// Zoom: how many world units tall the canvas shows. Smaller = tighter
// zoom. WORLD_H is 1200, so 850 gives roughly a 40% zoom-in over the
// fit-everything view.
const VISIBLE_WORLD_H = 850;

type Bubble = { x: number; y: number; r: number; tw: number; vy: number; wiggle: number };
type Weed = { x: number; w: number; h: number; layer: 0 | 1 };
type Rock = { x: number; w: number; h: number };
type ReefCoral = { x: number; h: number; color: string; sway: number };
type Reef = { x: number; wBase: number; corals: ReefCoral[] };
type Creature = { x: number; kind: "fish" | "squid"; color: string; size: number; flip: boolean };
type MidAirFish = { x: number; y: number; color: string; size: number; phase: number; flip: boolean };

export function CannonGame() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: switching } = useSwitchChain();
  const CANNON_ADDR = cannonAddressForChain(chainId);
  const unsupportedChain = isConnected && !CANNON_ADDR;

  const [round, setRound] = useState<RoundStatus>({ status: "idle" });
  const [seedHash, setSeedHash] = useState<string | null>(null);
  const [betInput, setBetInput] = useState<string>("");
  // Re-roll the seabed layout per round so the rocks/creatures change.
  const [layoutSeed, setLayoutSeed] = useState(() => (Date.now() & 0xffff) | 1);
  // Player-chosen firing angle in degrees. Cosmetic — the contract still
  // determines the final landing x — but the arc apex and cannon tilt
  // follow this value, and the arc's curve can pass through mid-air
  // fish based on how steep/shallow the angle is.
  const [angle, setAngle] = useState<number>(DEFAULT_ANGLE);
  // Result toast visibility — kept off during the flight animation so
  // the payout doesn't reveal before the squid has actually landed.
  const [showResult, setShowResult] = useState(false);

  useEffect(() => {
    if (round.status !== "resolved") {
      setShowResult(false);
      return;
    }
    // Show the toast just after the squid finishes tumbling. Convert
    // rAF frames (~60fps) to ms and add a small read buffer so the
    // canvas multi chip pops in first.
    const ms = ((FLIGHT_FRAMES + TUMBLE_FRAMES) * 1000) / 60 + 250;
    const id = setTimeout(() => setShowResult(true), ms);
    return () => clearTimeout(id);
  }, [round.status, seedHash]);

  const readAddress = CANNON_ADDR ?? undefined;
  const enabledRead = !!readAddress;
  const { data: minBet } = useReadContract({
    address: readAddress, abi: CANNON_ABI, functionName: "minBet",
    query: { enabled: enabledRead },
  });
  const { data: maxBet } = useReadContract({
    address: readAddress, abi: CANNON_ABI, functionName: "maxBet",
    query: { enabled: enabledRead },
  });

  const { writeContract, data: playTxHash, error: writeErr, isPending: writing, reset } = useWriteContract();
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash: playTxHash });

  useEffect(() => {
    if (!seedHash) return;
    if (round.status === "resolved" || round.status === "error" || round.status === "idle") return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/fire/round/${seedHash}?chain=${chainId}`);
        if (!res.ok) return;
        const body = await res.json();
        if (body.status === "resolved") {
          setRound({
            status: "resolved",
            betWei: body.betWei,
            payoutWei: body.payoutWei,
            distanceBp: Number(body.distanceBp),
            txReveal: body.txReveal,
          });
        } else if (body.status === "revealing") {
          setRound(prev => prev.status === "revealing" ? prev : { status: "revealing" });
        } else if (body.status === "stuck") {
          setRound({ status: "error", error: body.reason ?? "round stuck" });
        }
      } catch {}
    }, POLL_MS);
    return () => clearInterval(id);
  }, [seedHash, round.status, chainId]);

  const effectiveBetWei = useMemo(() => {
    if (minBet == null || maxBet == null) return null;
    const min = minBet as bigint;
    const max = maxBet as bigint;
    if (!betInput) return max;
    let parsed: bigint;
    try { parsed = parseEther(betInput); } catch { return null; }
    if (parsed < min) return min;
    if (parsed > max) return max;
    return parsed;
  }, [betInput, minBet, maxBet]);

  async function fire() {
    if (!isConnected || !CANNON_ADDR || effectiveBetWei == null) return;
    setLayoutSeed((Date.now() & 0xffff) | 1); // new seabed per round
    setRound({ status: "opening" });
    try {
      const res = await fetch(`/api/fire/open?chain=${chainId}`, { method: "POST" });
      if (!res.ok) throw new Error(`open: ${res.status}`);
      const body = await res.json();
      const hash = body.seedHash as `0x${string}`;
      setSeedHash(hash);
      setRound({ status: "awaiting_play" });
      writeContract({
        address: CANNON_ADDR,
        abi: CANNON_ABI,
        functionName: "fire",
        args: [hash],
        value: effectiveBetWei,
      });
    } catch (e) {
      setRound({ status: "error", error: (e as Error).message });
    }
  }

  useEffect(() => {
    if (writeErr) {
      setRound({ status: "error", error: writeErr.message });
      reset();
    }
  }, [writeErr, reset]);

  function resetForNextPlay() {
    setSeedHash(null);
    setRound({ status: "idle" });
    reset();
  }

  const minBetEth = minBet != null ? formatEther(minBet as bigint) : "—";
  const maxBetEth = maxBet != null ? formatEther(maxBet as bigint) : "—";
  const effectiveBetEth = effectiveBetWei != null ? formatEther(effectiveBetWei) : "—";

  const buttonLabel = (() => {
    if (writing)    return "Confirm in wallet…";
    if (confirming) return "Submitting fire…";
    switch (round.status) {
      case "opening":       return "Opening round…";
      case "awaiting_play": return "Awaiting fire tx…";
      case "revealing":     return "Resolving on-chain…";
      case "resolved":      return showResult ? "Fire again" : "Landing…";
      case "error":         return "Try again";
      default:              return `FIRE (${Number(effectiveBetEth).toFixed(4)} ETH)`;
    }
  })();

  const buttonDisabled = !isConnected || unsupportedChain || writing || confirming
    || round.status === "opening" || round.status === "awaiting_play" || round.status === "revealing"
    || (round.status === "resolved" && !showResult)
    || effectiveBetWei == null;

  const onButtonClick = round.status === "resolved" || round.status === "error"
    ? resetForNextPlay
    : fire;

  const sliderLocked = round.status !== "idle" && round.status !== "resolved" && round.status !== "error";

  return (
    <div style={{
      position: "fixed", inset: 0,
      display: "flex", flexDirection: "column",
      background: "#02122a",
    }}>
      {/* Game stage — edge-to-edge, no chrome. Only floating elements
          are result / error toast at top-center when applicable. */}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <CannonCanvas
          round={round}
          layoutSeed={layoutSeed}
          bet={effectiveBetWei}
          angle={angle}
        />

        {round.status === "resolved" && showResult && (() => {
          const mult = distanceBpToMultiplier(round.distanceBp);
          const meters = distanceBpToMeters(round.distanceBp);
          const won = BigInt(round.payoutWei) > BigInt(round.betWei);
          const bust = round.distanceBp === 0;
          return (
            <div style={{
              position: "absolute", left: "50%", top: 16, transform: "translateX(-50%)",
              padding: "10px 20px",
              background: "rgba(2,24,48,0.8)",
              border: "1px solid rgba(127,227,255,0.35)",
              borderRadius: 12, color: "#cfe7ff",
              fontFamily: "ui-monospace, monospace", textAlign: "center",
              backdropFilter: "blur(8px)", minWidth: 240, pointerEvents: "none",
            }}>
              <div style={{ fontSize: 11, opacity: 0.75 }}>
                {bust ? "BUST — hit a rock" : `${meters}m · ${mult.toFixed(2)}× multiplier`}
              </div>
              <div style={{
                fontSize: 22, fontWeight: 800, marginTop: 2,
                color: won ? "#7fe3ff" : bust ? "#ff8b8b" : "#ffb464",
              }}>
                {Number(formatEther(BigInt(round.payoutWei))).toFixed(6)} ETH
              </div>
              {round.txReveal && (
                <a href={`${explorerForCannonChain(chainId)}/tx/${round.txReveal}`}
                   target="_blank" rel="noopener noreferrer"
                   style={{ fontSize: 10, opacity: 0.7, color: "#7fe3ff", display: "block", marginTop: 2, pointerEvents: "auto" }}>
                  reveal tx ↗
                </a>
              )}
            </div>
          );
        })()}

        {round.status === "error" && (
          <div style={{
            position: "absolute", left: "50%", top: 16, transform: "translateX(-50%)",
            padding: "10px 18px",
            background: "rgba(40,0,0,0.85)",
            border: "1px solid rgba(255,116,116,0.45)",
            borderRadius: 10,
            color: "#ff8b8b", fontFamily: "ui-monospace, monospace", fontSize: 12,
            maxWidth: "80%", pointerEvents: "none",
          }}>
            {round.error.split("\n")[0]}
          </div>
        )}
      </div>

      {/* Control dock — a single clean bar below the stage with the
          bet, angle, and FIRE button. This is where all controls live;
          nothing is overlaid on the game itself. */}
      <div style={{
        background: "linear-gradient(180deg, rgba(2,24,48,0.95) 0%, #010a1e 100%)",
        borderTop: "1px solid rgba(127,227,255,0.18)",
        padding: "10px 14px 10px",
        display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
        color: "#cfe7ff", fontFamily: "system-ui, sans-serif",
      }}>
        {/* Bet block */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 140 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7b94b8" }}>
            <span>bet</span>
            <span style={{ color: "#cfe7ff" }}>{Number(effectiveBetEth).toFixed(5)}</span>
          </div>
          <input
            type="text"
            inputMode="decimal"
            placeholder={`max ${maxBetEth}`}
            value={betInput}
            onChange={e => setBetInput(e.target.value)}
            style={{
              background: "rgba(0,0,0,0.5)", border: "1px solid rgba(127,227,255,0.25)",
              color: "#cfe7ff", padding: "6px 8px", borderRadius: 6,
              fontFamily: "ui-monospace, monospace", fontSize: 12, outline: "none",
              width: "100%", boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 4 }}>
            {[0.1, 0.25, 0.5].map(frac => (
              <button key={frac}
                onClick={() => {
                  if (maxBet != null) setBetInput(formatEther(((maxBet as bigint) * BigInt(Math.round(frac * 1000))) / 1000n));
                }}
                style={presetBtnStyle}>
                {Math.round(frac * 100)}%
              </button>
            ))}
            <button onClick={() => setBetInput("")} style={presetBtnStyle}>MAX</button>
          </div>
        </div>

        {/* Angle slider */}
        <div style={{
          flex: "1 1 200px",
          display: "flex", alignItems: "center", gap: 10,
          padding: "8px 14px",
          background: "rgba(0,0,0,0.25)",
          border: "1px solid rgba(127,227,255,0.15)",
          borderRadius: 10,
        }}>
          <span style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7b94b8", minWidth: 38 }}>angle</span>
          <input
            type="range"
            min={MIN_ANGLE}
            max={MAX_ANGLE}
            step={1}
            value={angle}
            onChange={e => setAngle(Number(e.target.value))}
            disabled={sliderLocked}
            style={{ flex: 1, accentColor: "#7fe3ff" }}
          />
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, color: "#cfe7ff", minWidth: 36, textAlign: "right" }}>
            {angle}°
          </span>
        </div>

        {/* FIRE button */}
        <button
          onClick={onButtonClick}
          disabled={buttonDisabled}
          style={{
            ...btnStyle("#ffd76a"),
            padding: "12px 26px", fontSize: 14, fontWeight: 800, letterSpacing: "0.1em",
            minWidth: 170,
          }}
        >
          {buttonLabel}
        </button>

        {/* Wallet / chain row — hugs the right on wide screens, wraps
            to its own row on narrow screens. */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <ConnectButton chainStatus="icon" />
          {isConnected && SUPPORTED_CHAINS.map(c => (
            <button key={c.id}
              onClick={() => switchChain({ chainId: c.id })}
              disabled={switching || chainId === c.id}
              style={{
                ...btnStyle(chainId === c.id ? "#7fe3ff" : "rgba(127,227,255,0.18)"),
                color: chainId === c.id ? "#021830" : "#cfe7ff",
                minWidth: 0, padding: "6px 10px", fontSize: 11,
              }}>
              {chainId === c.id ? "✓ " : ""}{c.name}
            </button>
          ))}
        </div>
      </div>

      {unsupportedChain && (
        <div style={{ position: "absolute", left: 12, bottom: 96, fontSize: 11, color: "#ff9b5a", fontFamily: "ui-monospace, monospace" }}>
          switch to Ink Sepolia or Soneium Minato to play
        </div>
      )}
    </div>
  );
}

// ─── CANVAS — animates the cannon + squid flight ──
function CannonCanvas({
  round,
  layoutSeed,
  bet,
  angle,
}: {
  round: RoundStatus;
  layoutSeed: number;
  bet: bigint | null;
  angle: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resolvedAtFrameRef = useRef<number | null>(null);

  // Capture the state we need inside the animation loop without causing
  // it to tear down and restart on every parent re-render.
  const roundRef = useRef(round);
  const betRef = useRef(bet);
  const angleRef = useRef(angle);
  const lockedAngleRef = useRef<number>(angle);
  useEffect(() => { roundRef.current = round; }, [round]);
  useEffect(() => { betRef.current = bet; }, [bet]);
  useEffect(() => { angleRef.current = angle; }, [angle]);

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;

    // Keep the canvas's internal pixel grid in sync with its display
    // size (times devicePixelRatio for crisp rendering). The render
    // function reads canvas.width/height to know the viewport.
    const resizeCanvas = () => {
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      const cw = Math.max(1, c.clientWidth);
      const ch = Math.max(1, c.clientHeight);
      c.width = Math.round(cw * dpr);
      c.height = Math.round(ch * dpr);
    };
    resizeCanvas();
    const ro = new ResizeObserver(resizeCanvas);
    ro.observe(c);

    // Bubbles are scattered with a seeded PRNG so they look random (not
    // on a visible diagonal lattice) and each carries its own rise speed
    // + wiggle phase so they drift up convincingly.
    const bubbleRand = mulberry32(layoutSeed ^ 0xB0BB1E);
    const bubbles: Bubble[] = [];
    for (let i = 0; i < 170; i++) {
      bubbles.push({
        x: bubbleRand() * WORLD_W,
        y: 30 + bubbleRand() * (WORLD_H - GROUND_H - 60),
        r: 1.2 + bubbleRand() * 2.2,
        tw: bubbleRand() * Math.PI * 2,
        vy: 0.25 + bubbleRand() * 0.6, // rise speed, world units per frame
        wiggle: bubbleRand() * Math.PI * 2,
      });
    }
    const weeds: Weed[] = [];
    for (let i = 0; i < 24; i++) weeds.push({ layer: 0, x: i * 170 + 30, w: 150, h: 80 });
    for (let i = 0; i < 24; i++) weeds.push({ layer: 1, x: i * 200 + 80, w: 180, h: 120 });

    const rocks = generateRocks(layoutSeed);
    const reefs = generateReefs(layoutSeed * 7919);
    const creatures = generateCreatures(layoutSeed * 31337);
    const midAirFish = generateMidAirFish(layoutSeed * 11117);
    // Hit fish carry their knockback state (pos delta, velocity,
    // rotation) so we can animate them flying off while the squid
    // continues on its contract-determined arc.
    const fishHits = new Map<number, {
      hitFrame: number;
      ox: number; oy: number;    // accumulated offset from original position
      vx: number; vy: number;    // velocity in world units/frame
      rot: number; vrot: number;
    }>();
    // Smoothed camera — lerps toward a target each frame on both axes.
    const cameraRef = { x: 0, y: Math.max(0, WORLD_H - VISIBLE_WORLD_H) };
    // Physics-based squid kickback. Each fish collision adds a velocity
    // impulse; every frame the kick decays and its position offset is
    // added to the squid's bezier coordinates so the flight visibly
    // ricochets off the fish it clips.
    const squidKick = { vx: 0, vy: 0, ox: 0, oy: 0 };

    resolvedAtFrameRef.current = null;

    let raf = 0;
    let frame = 0;
    const tick = () => {
      frame++;
      // Track when we first saw the "resolved" state so animation
      // progress can be measured from that moment. Also lock the angle
      // at resolve time so mid-flight slider twiddles don't warp the arc.
      const r = roundRef.current;
      if (r.status === "resolved" && resolvedAtFrameRef.current == null) {
        resolvedAtFrameRef.current = frame;
        lockedAngleRef.current = angleRef.current;
        fishHits.clear();
        squidKick.vx = 0; squidKick.vy = 0; squidKick.ox = 0; squidKick.oy = 0;
      } else if (r.status !== "resolved") {
        resolvedAtFrameRef.current = null;
        fishHits.clear();
        squidKick.vx = 0; squidKick.vy = 0; squidKick.ox = 0; squidKick.oy = 0;
      }
      render(
        ctx, bubbles, weeds, rocks, reefs, creatures, midAirFish, fishHits,
        frame, r, resolvedAtFrameRef.current, betRef.current,
        r.status === "resolved" ? lockedAngleRef.current : angleRef.current,
        cameraRef, squidKick,
      );
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [layoutSeed]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        background: "#021830",
        display: "block",
      }}
    />
  );
}

// ─── PROCEDURAL GEN ──
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function generateRocks(seed: number): Rock[] {
  const rand = mulberry32(seed);
  const rocks: Rock[] = [];
  const count = 9 + Math.floor(rand() * 6);
  for (let i = 0; i < count; i++) {
    const band = rand();
    rocks.push({
      x: Math.min(0.98, Math.max(0.04, band + (rand() - 0.5) * 0.05)),
      w: 18 + rand() * 32,
      h: 9 + rand() * 18,
    });
  }
  return rocks.sort((a, b) => a.x - b.x);
}

function generateReefs(seed: number): Reef[] {
  const rand = mulberry32(seed);
  const reefs: Reef[] = [];
  const count = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const corals: ReefCoral[] = [];
    const coralCount = 4 + Math.floor(rand() * 5);
    for (let j = 0; j < coralCount; j++) {
      corals.push({
        x: (rand() - 0.5) * 60,
        h: 20 + rand() * 40,
        color: rand() < 0.5 ? "#ff7aa8" : rand() < 0.5 ? "#ff9b5a" : "#c88afe",
        sway: rand() * Math.PI * 2,
      });
    }
    reefs.push({
      x: 0.15 + rand() * 0.8,
      wBase: 50 + rand() * 40,
      corals,
    });
  }
  return reefs.sort((a, b) => a.x - b.x);
}

function generateCreatures(seed: number): Creature[] {
  const rand = mulberry32(seed);
  const creatures: Creature[] = [];
  const count = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const isSquid = rand() < 0.4;
    creatures.push({
      x: 0.1 + rand() * 0.85,
      kind: isSquid ? "squid" : "fish",
      color: rand() < 0.5 ? "#ff7aa8" : rand() < 0.5 ? "#ffb464" : "#7fe3ff",
      size: 0.8 + rand() * 0.5,
      flip: rand() < 0.5,
    });
  }
  return creatures.sort((a, b) => a.x - b.x);
}

function generateMidAirFish(seed: number): MidAirFish[] {
  const rand = mulberry32(seed);
  const fish: MidAirFish[] = [];
  // Dense enough that most arcs clip several fish on the way across.
  const count = 14 + Math.floor(rand() * 7);
  for (let i = 0; i < count; i++) {
    fish.push({
      x: 0.12 + rand() * 0.84,
      y: 0.2 + rand() * 0.55,
      color: rand() < 0.33 ? "#ff9b5a" : rand() < 0.5 ? "#7fe3ff" : rand() < 0.5 ? "#ff7aa8" : "#ffd76a",
      size: 0.7 + rand() * 0.5,
      phase: rand() * Math.PI * 2,
      flip: rand() < 0.5,
    });
  }
  return fish;
}

// ─── RENDER ──
// Camera-scrolling renderer. The canvas is a window into a wider world;
// everything is drawn in world coordinates, then the context is scaled
// and translated so the view stays zoomed in on the action. The world
// is WORLD_W×WORLD_H; world height fills the canvas height, and the
// camera x pans horizontally as the squid flies.
function render(
  ctx: CanvasRenderingContext2D,
  bubbles: Bubble[],
  weeds: Weed[],
  rocks: Rock[],
  reefs: Reef[],
  creatures: Creature[],
  midAirFish: MidAirFish[],
  fishHits: Map<number, {
    hitFrame: number;
    ox: number; oy: number;
    vx: number; vy: number;
    rot: number; vrot: number;
  }>,
  frame: number,
  round: RoundStatus,
  resolvedAtFrame: number | null,
  _bet: bigint | null,
  angleDeg: number,
  cameraRef: { x: number; y: number },
  squidKick: { vx: number; vy: number; ox: number; oy: number },
) {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  // Zoom — canvas shows VISIBLE_WORLD_H world units vertically (less
  // than WORLD_H, so it's cropped and zoomed in). The camera pans in
  // both axes to keep the squid framed.
  const scale = ch / VISIBLE_WORLD_H;
  const viewWorldW = cw / scale;
  const viewWorldH = VISIBLE_WORLD_H;
  const W2 = WORLD_W, H2 = WORLD_H;

  // Compute the squid's current world position (during flight), so
  // the camera can follow it in both axes. Mirrors the bezier that
  // draws the squid below.
  let squidWorldX: number | null = null;
  let squidWorldY: number | null = null;
  if (round.status === "resolved" && resolvedAtFrame != null) {
    const lt = Math.min(1, (frame - resolvedAtFrame) / FLIGHT_FRAMES);
    // Match the custom ease used below so camera and squid stay synced.
    const animProgress = lt < 0.8
      ? lt
      : 0.8 + 0.2 * (1 - Math.pow(1 - (lt - 0.8) / 0.2, 2.2));
    const meters = distanceBpToMeters(round.distanceBp);
    const bust = round.distanceBp === 0;
    const landFrac = bust ? 0.08 : fracFromMeters(meters);
    const landX = STRIP_START + (STRIP_END - STRIP_START) * landFrac;
    const landY = (H2 - GROUND_H + 4) - 4;
    const barrelRad_ = -(angleDeg * Math.PI) / 180;
    const mX_ = 92 + Math.cos(barrelRad_) * 72;
    const mY_ = (H2 - GROUND_H) - 20 + Math.sin(barrelRad_) * 72;
    const midX_ = (mX_ + landX) / 2;
    const angleT_ = (angleDeg - MIN_ANGLE) / (MAX_ANGLE - MIN_ANGLE);
    const apex_ = Math.min(mY_, landY) - (160 + angleT_ * 660);
    const t = animProgress;
    squidWorldX = (1 - t) * (1 - t) * mX_ + 2 * (1 - t) * t * midX_ + t * t * landX;
    squidWorldY = (1 - t) * (1 - t) * mY_ + 2 * (1 - t) * t * apex_ + t * t * landY;
  }

  // Camera targets — cannon at idle, squid during flight.
  const idleCamY = Math.max(0, H2 - viewWorldH); // show ground + cannon
  let targetCamX = 0;
  let targetCamY = idleCamY;
  if (squidWorldX != null && squidWorldY != null) {
    targetCamX = Math.max(0, Math.min(W2 - viewWorldW, squidWorldX - viewWorldW * 0.4));
    targetCamY = Math.max(0, Math.min(H2 - viewWorldH, squidWorldY - viewWorldH * 0.45));
  }
  cameraRef.x += (targetCamX - cameraRef.x) * 0.14;
  cameraRef.y += (targetCamY - cameraRef.y) * 0.16;
  const camX = cameraRef.x;
  const camY = cameraRef.y;

  // Apply world→screen transform. Everything below draws in world coords.
  ctx.setTransform(scale, 0, 0, scale, -camX * scale, -camY * scale);

  // Ocean gradient
  const sky = ctx.createLinearGradient(0, 0, 0, H2 - GROUND_H);
  sky.addColorStop(0, "#7ad3e0");
  sky.addColorStop(0.25, "#2a9ac2");
  sky.addColorStop(0.6, "#0e4a7c");
  sky.addColorStop(1, "#041a3a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W2, H2 - GROUND_H);

  const shimmer = ctx.createLinearGradient(0, 0, 0, 40);
  shimmer.addColorStop(0, "rgba(255,255,255,0.35)");
  shimmer.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shimmer;
  ctx.fillRect(0, 0, W2, 40);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 14; i++) {
    const baseX = ((i * 180 + frame * 0.4) % (W2 + 240)) - 120;
    ctx.fillStyle = "rgba(200, 230, 255, 0.05)";
    ctx.beginPath();
    ctx.moveTo(baseX, 0); ctx.lineTo(baseX + 50, 0);
    ctx.lineTo(baseX + 260, H2 - GROUND_H); ctx.lineTo(baseX + 210, H2 - GROUND_H);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  // Advance + draw bubbles. They rise with a gentle sideways wobble
  // and wrap back to the seabed when they pop out the top.
  for (const b of bubbles) {
    b.y -= b.vy;
    if (b.y < 20) {
      b.y = H2 - GROUND_H - 10;
      b.x = Math.random() * W2; // respawn across the world width
    }
    const wobble = Math.sin(b.wiggle + frame * 0.04) * 0.6;
    const drawX = b.x + wobble;
    const a = 0.35 + Math.sin(b.tw + frame * 0.03) * 0.15;
    ctx.strokeStyle = `rgba(220,240,255,${a + 0.35})`;
    ctx.lineWidth = 1;
    ctx.fillStyle = `rgba(180,220,255,${a * 0.35})`;
    ctx.beginPath();
    ctx.arc(drawX, b.y, b.r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }

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

  const ground = ctx.createLinearGradient(0, H2 - GROUND_H, 0, H2);
  ground.addColorStop(0, "#d5b47c");
  ground.addColorStop(1, "#6f4c22");
  ctx.fillStyle = ground;
  ctx.fillRect(0, H2 - GROUND_H, W2, GROUND_H);
  ctx.fillStyle = "rgba(40,25,8,0.4)";
  ctx.fillRect(0, H2 - GROUND_H, W2, 2);

  const stripStart = STRIP_START;
  const stripW = STRIP_END - STRIP_START;
  const sandLevel = H2 - GROUND_H + 4;

  // Multiplier zone bands on the sand — these visualize the payout
  // curve (1×, 2×, 3×, 4×, 5×) so the player can see what each landing
  // spot is worth. Colored stripes get hotter as multiplier rises.
  // During flight we highlight the zone the squid is CURRENTLY over so
  // you can feel the tension build as it drifts between bands.
  const MULTI_ZONES = [
    { mult: 1, color: "#6b8aa8" },
    { mult: 2, color: "#7fe3ff" },
    { mult: 3, color: "#7bff9b" },
    { mult: 4, color: "#ffd76a" },
    { mult: 5, color: "#ff9b5a" },
  ];
  for (let i = 0; i < MULTI_ZONES.length; i++) {
    const z = MULTI_ZONES[i]!;
    const prev = i === 0 ? 0 : MULTI_ZONES[i - 1]!.mult;
    // Zone covers the strip between prev×100m and this×100m.
    const fracFrom = fracFromMeters(prev * 100);
    const fracTo = fracFromMeters(z.mult * 100);
    const zoneX = stripStart + stripW * fracFrom;
    const zoneW = stripW * (fracTo - fracFrom);
    const intensity = 0.15 + (i / MULTI_ZONES.length) * 0.25;
    // Is the squid currently over this zone? If so, pulse the intensity.
    const overZone = squidWorldX != null && squidWorldY != null
      && squidWorldX >= zoneX && squidWorldX < zoneX + zoneW;
    const pulse = overZone ? 0.4 + Math.sin(frame * 0.2) * 0.15 : 0;
    // Colored horizontal stripe just below the sand line.
    ctx.fillStyle = `${z.color}${Math.round((intensity + pulse) * 255).toString(16).padStart(2, "0")}`;
    ctx.fillRect(zoneX, sandLevel - 1, zoneW, 5);
    // Marker post at the start of each zone (not the first).
    if (i > 0) {
      ctx.fillStyle = "rgba(40,25,8,0.8)";
      ctx.fillRect(zoneX - 2, sandLevel - 28, 4, 28);
      ctx.fillStyle = z.color;
      ctx.beginPath();
      ctx.moveTo(zoneX, sandLevel - 36);
      ctx.lineTo(zoneX + 22, sandLevel - 32);
      ctx.lineTo(zoneX + 22, sandLevel - 22);
      ctx.lineTo(zoneX, sandLevel - 26);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#06131e";
      ctx.font = 'bold 12px "Rubik", sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(`${z.mult}×`, zoneX + 11, sandLevel - 26);
      ctx.textAlign = "start";
    }
  }

  for (const reef of reefs) drawReef(ctx, stripStart + stripW * reef.x, sandLevel, reef, frame);
  for (const r of rocks)    drawRock(ctx, stripStart + stripW * r.x, sandLevel, r.w, r.h, r.x);
  for (const c of creatures) {
    const cx = stripStart + stripW * c.x;
    drawBottomCreature(ctx, cx, sandLevel - 6, c, frame);
  }
  // Positions of mid-air fish this frame — used for collision + render.
  // Unhit fish bob idly; hit fish get drawn below with their accumulated
  // knockback offset so they can visibly fly off when the squid slams
  // into them.
  const fishPositions: { fx: number; fy: number; f: MidAirFish; idx: number }[] = [];
  for (let i = 0; i < midAirFish.length; i++) {
    const f = midAirFish[i]!;
    const fx = stripStart + stripW * f.x + Math.sin(frame * 0.02 + f.phase) * 20;
    const fy = 60 + (H2 - GROUND_H - 120) * f.y + Math.sin(frame * 0.03 + f.phase) * 8;
    fishPositions.push({ fx, fy, f, idx: i });
    if (!fishHits.has(i)) {
      drawFishSprite(ctx, fx, fy, f.color, f.size, f.flip, frame + f.phase * 30);
    }
  }

  // Advance + draw hit fish — they tumble away, rotating, fading out,
  // and decelerate slightly as gravity-ish friction kicks in.
  for (const [idx, hit] of fishHits) {
    hit.ox += hit.vx;
    hit.oy += hit.vy;
    hit.vy += 0.18; // slight gravity so they arc downward when flung
    hit.vx *= 0.985;
    hit.rot += hit.vrot;
    const f = midAirFish[idx]!;
    const base = fishPositions.find(p => p.idx === idx)!;
    const drawX = base.fx + hit.ox;
    const drawY = base.fy + hit.oy;
    const age = frame - hit.hitFrame;
    const alpha = Math.max(0, 1 - age / 60);
    if (alpha <= 0) continue;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(drawX, drawY);
    ctx.rotate(hit.rot);
    drawFishSprite(ctx, 0, 0, f.color, f.size, f.flip, frame + f.phase * 30);
    ctx.restore();
  }

  // Cannon — tilt follows the player's chosen angle. angleDeg is the
  // elevation (0 = horizontal to the right, 90 = straight up); canvas y
  // grows downward, so the barrel's rotation is -radians(angleDeg).
  const cannonBaseX = 92;
  const cannonBaseY = H2 - GROUND_H;
  const puff = round.status === "awaiting_play" || round.status === "revealing";
  const barrelRad = -(angleDeg * Math.PI) / 180;
  drawDetailedCannon(ctx, cannonBaseX, cannonBaseY, frame, puff, barrelRad);

  // ── SQUID: either loaded in cannon (idle) or flying (resolved) ──
  // Muzzle tip follows the barrel tilt so the squid appears to exit the
  // mouth of the cannon, not from a fixed spot in space.
  const BARREL_LEN = 72;
  const PIVOT_Y_OFFSET = 20;
  const muzzleX = cannonBaseX + Math.cos(barrelRad) * BARREL_LEN;
  const muzzleY = cannonBaseY - PIVOT_Y_OFFSET + Math.sin(barrelRad) * BARREL_LEN;

  if (round.status === "resolved" && resolvedAtFrame != null) {
    // Flight: the squid flies along a bezier over FLIGHT_FRAMES, then
    // spends TUMBLE_FRAMES bouncing on the sand before coming to rest.
    // The last 20% of the flight is eased so the landing approach plays
    // in visible slow-motion — builds tension and lets the near-miss
    // read on payout zones.
    const sinceResolve = frame - resolvedAtFrame;
    const linearT = Math.min(1, sinceResolve / FLIGHT_FRAMES);
    // Custom ease: linear until 0.8, then quadratic stretch for last 20%.
    const animProgress = linearT < 0.8
      ? linearT
      : 0.8 + (1 - 0.8) * (1 - Math.pow(1 - (linearT - 0.8) / 0.2, 2.2));
    const tumbleT = Math.max(0, Math.min(1, (sinceResolve - FLIGHT_FRAMES) / TUMBLE_FRAMES));
    const distanceBp = round.distanceBp;
    const meters = distanceBpToMeters(distanceBp);
    const bust = distanceBp === 0;

    const landFrac = bust ? 0.08 : fracFromMeters(meters);
    const landX = stripStart + stripW * landFrac;
    const landY = sandLevel - 4;

    const midX = (muzzleX + landX) / 2;
    const angleT = (angleDeg - MIN_ANGLE) / (MAX_ANGLE - MIN_ANGLE); // 0..1
    const apexLift = 160 + angleT * 660; // 160..820 px above lower endpoint
    const apex = Math.min(muzzleY, landY) - apexLift;

    // Draw full dotted arc (faded) only while in flight — it's
    // distracting once the squid has landed.
    if (animProgress < 1) {
      ctx.save();
      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = "rgba(127,227,255,0.22)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let t = 0; t <= 1; t += 0.02) {
        const x = (1 - t) * (1 - t) * muzzleX + 2 * (1 - t) * t * midX + t * t * landX;
        const y = (1 - t) * (1 - t) * muzzleY + 2 * (1 - t) * t * apex   + t * t * landY;
        if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    const t = animProgress;
    const baseBx = (1 - t) * (1 - t) * muzzleX + 2 * (1 - t) * t * midX + t * t * landX;
    const baseBy = (1 - t) * (1 - t) * muzzleY + 2 * (1 - t) * t * apex   + t * t * landY;
    const slope = Math.atan2(
      2 * (1 - t) * (apex - muzzleY) + 2 * t * (landY - apex),
      2 * (1 - t) * (midX - muzzleX) + 2 * t * (landX - midX),
    );

    // Integrate kick each frame — decays under friction and gravity-ish
    // pull. The accumulated offset shifts the squid off its bezier so
    // fish bonks visibly deflect the flight.
    squidKick.vy += 0.18;                // a nudge of gravity on the offset
    squidKick.vx *= 0.92;
    squidKick.vy *= 0.92;
    squidKick.ox += squidKick.vx;
    squidKick.oy += squidKick.vy;
    // Pull the offset back toward zero so the squid still converges to
    // the contract-determined landing point.
    const convergence = 0.04 + animProgress * 0.1;
    squidKick.ox *= 1 - convergence;
    squidKick.oy *= 1 - convergence;

    // Final squid position this frame — bezier + kick offset, plus a
    // tumble bounce during the post-landing phase.
    let bx = baseBx + squidKick.ox;
    let by = baseBy + squidKick.oy;
    let drawRot = slope * 1.5;
    if (tumbleT > 0) {
      // Dampened hop sequence along the ground with a little forward
      // skid. Three bounces, each smaller than the last.
      const hopPhase = tumbleT * Math.PI * 3.2;
      const hops = Math.abs(Math.sin(hopPhase));
      const decay = Math.pow(1 - tumbleT, 1.8);
      const hopH = hops * decay * 68;
      const skidX = (1 - decay) * 40;
      bx = landX + skidX;
      by = landY - hopH;
      drawRot = tumbleT * Math.PI * 1.4; // squid tumbles as it rolls
      squidKick.ox = squidKick.oy = 0;
      squidKick.vx = squidKick.vy = 0;
      // Dust puff on each ground contact (sin phase crossing zero).
      // Draw at the squid's current x, fading in+out over a few frames.
      const contactPhase = hopPhase % Math.PI;
      if (contactPhase < 0.35 || contactPhase > Math.PI - 0.35) {
        const contactStrength = Math.max(0, 1 - Math.min(contactPhase, Math.PI - contactPhase) / 0.35) * decay;
        if (contactStrength > 0.05) {
          ctx.save();
          ctx.fillStyle = `rgba(220, 200, 150, ${0.35 * contactStrength})`;
          for (let p = 0; p < 5; p++) {
            const ang = Math.PI + (p - 2) * 0.4;
            const dist = 10 + p * 3;
            ctx.beginPath();
            ctx.arc(bx + Math.cos(ang) * dist, landY - 2 + Math.sin(ang) * 2, 6 + contactStrength * 4, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }
    }

    // Motion trail — only during flight, not during tumble.
    if (tumbleT === 0) {
      for (let i = 1; i <= 6; i++) {
        const tt = Math.max(0, t - i * 0.025);
        const tx = (1 - tt) * (1 - tt) * muzzleX + 2 * (1 - tt) * tt * midX + tt * tt * landX;
        const ty = (1 - tt) * (1 - tt) * muzzleY + 2 * (1 - tt) * tt * apex + tt * tt * landY;
        ctx.fillStyle = `rgba(127, 227, 255, ${0.25 - i * 0.035})`;
        ctx.beginPath();
        ctx.arc(tx, ty, 6 - i * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Muzzle flash — bright burst during the first few frames of flight
    // so the cannon firing reads as a real BOOM.
    if (sinceResolve < 10) {
      const flashT = sinceResolve / 10;
      const flashA = 1 - flashT;
      const flashR = 24 + flashT * 40;
      ctx.save();
      const flash = ctx.createRadialGradient(muzzleX, muzzleY, 2, muzzleX, muzzleY, flashR);
      flash.addColorStop(0, `rgba(255, 240, 190, ${flashA})`);
      flash.addColorStop(0.4, `rgba(255, 180, 80, ${flashA * 0.7})`);
      flash.addColorStop(1, "rgba(255, 120, 40, 0)");
      ctx.fillStyle = flash;
      ctx.beginPath();
      ctx.arc(muzzleX, muzzleY, flashR, 0, Math.PI * 2);
      ctx.fill();
      // Spokes
      ctx.strokeStyle = `rgba(255, 235, 160, ${flashA})`;
      ctx.lineWidth = 3;
      for (let s = 0; s < 6; s++) {
        const a = (s / 6) * Math.PI * 2 + flashT;
        ctx.beginPath();
        ctx.moveTo(muzzleX + Math.cos(a) * 8, muzzleY + Math.sin(a) * 8);
        ctx.lineTo(muzzleX + Math.cos(a) * (28 + flashT * 20), muzzleY + Math.sin(a) * (28 + flashT * 20));
        ctx.stroke();
      }
      ctx.restore();
    }

    const bird: Bird = { x: bx, y: by, vy: 0, r: 18 };
    drawBird(ctx, bird, drawRot, frame * 0.6, frame);

    // Mid-air fish hit detection — we check against the actual drawn
    // squid position (including kick offset) so collisions stay true
    // to what the player sees. On impact, the fish gets flung and the
    // squid receives a velocity kick up + slightly backward.
    if (animProgress > 0.03 && animProgress < 0.97 && tumbleT === 0) {
      for (const fp of fishPositions) {
        if (fishHits.has(fp.idx)) continue;
        const fishR = 22 * fp.f.size;
        const dx = bx - fp.fx;
        const dy = by - fp.fy;
        if (dx * dx + dy * dy < (18 + fishR) * (18 + fishR)) {
          // Fish is launched along squid's motion direction.
          const fvx = Math.cos(slope) * 9 + (Math.random() - 0.5) * 3;
          const fvy = Math.sin(slope) * 9 - 2 + (Math.random() - 0.5) * 3;
          fishHits.set(fp.idx, {
            hitFrame: frame,
            ox: 0, oy: 0,
            vx: fvx, vy: fvy,
            rot: 0, vrot: (Math.random() - 0.5) * 0.45,
          });
          // Squid gets a bounce — mostly up with a small backward
          // component, plus a random wobble so no two hits feel the same.
          squidKick.vy -= 5 + Math.random() * 2;
          squidKick.vx -= Math.cos(slope) * 2 + (Math.random() - 0.5) * 2;
        }
      }
    }
    // Impact flash — shock ring, star-burst spokes, and a "BONK!" pop
    // at the collision point for ~20 frames after each hit.
    for (const fp of fishPositions) {
      const hit = fishHits.get(fp.idx);
      if (!hit) continue;
      const age = frame - hit.hitFrame;
      if (age > 22) continue;
      const t = age / 22;
      const ringR = 14 + t * 48;
      const ringA = (1 - t) * 0.9;
      ctx.save();
      ctx.strokeStyle = `rgba(255, 240, 170, ${ringA})`;
      ctx.lineWidth = 3 - t * 2;
      ctx.beginPath();
      ctx.arc(fp.fx, fp.fy, ringR, 0, Math.PI * 2);
      ctx.stroke();
      // Star burst spokes
      ctx.strokeStyle = `rgba(255, 215, 106, ${ringA})`;
      ctx.lineWidth = 2.5;
      for (let s = 0; s < 8; s++) {
        const a = (s / 8) * Math.PI * 2;
        const r1 = 6 + t * 22;
        const r2 = r1 + 14;
        ctx.beginPath();
        ctx.moveTo(fp.fx + Math.cos(a) * r1, fp.fy + Math.sin(a) * r1);
        ctx.lineTo(fp.fx + Math.cos(a) * r2, fp.fy + Math.sin(a) * r2);
        ctx.stroke();
      }
      // "POW" text pops
      if (age < 14) {
        const popS = 1 + (1 - age / 14) * 0.6;
        ctx.translate(fp.fx, fp.fy - 28 - age * 0.6);
        ctx.scale(popS, popS);
        ctx.fillStyle = `rgba(255, 235, 130, ${ringA})`;
        ctx.strokeStyle = `rgba(30, 12, 0, ${ringA})`;
        ctx.lineWidth = 3;
        ctx.font = 'bold 14px "Rubik", sans-serif';
        ctx.textAlign = "center";
        ctx.strokeText("BONK!", 0, 0);
        ctx.fillText("BONK!", 0, 0);
        ctx.textAlign = "start";
      }
      ctx.restore();
    }

    // Landing reveal — waits until after the squid has finished
    // tumbling so the result doesn't pop in while it's still bouncing.
    if (tumbleT >= 1) {
      // Near-miss: if the squid landed within 20m of the next zone's
      // boundary (i.e. just short of a higher multiplier), show a
      // "SO CLOSE!" nudge. Builds the gambler's "I was right there"
      // feeling without changing payout math.
      if (!bust) {
        const landedM = meters;
        const nextBoundaryM = (Math.floor(landedM / 100) + 1) * 100;
        const gap = nextBoundaryM - landedM;
        if (gap > 0 && gap <= 20 && nextBoundaryM <= 500) {
          const nearPulse = 0.8 + Math.sin(frame * 0.25) * 0.2;
          ctx.save();
          ctx.fillStyle = `rgba(20, 10, 0, ${0.85 * nearPulse})`;
          roundRect(ctx, landX - 68, landY - 104, 136, 26, 8); ctx.fill();
          ctx.strokeStyle = `rgba(255, 200, 90, ${nearPulse})`;
          ctx.lineWidth = 2;
          roundRect(ctx, landX - 68, landY - 104, 136, 26, 8); ctx.stroke();
          ctx.fillStyle = `rgba(255, 220, 120, ${nearPulse})`;
          ctx.font = 'bold 13px "Rubik", sans-serif';
          ctx.textAlign = "center";
          ctx.fillText(`SO CLOSE · ${gap}m off ${nextBoundaryM / 100}×`, landX, landY - 86);
          ctx.textAlign = "start";
          ctx.restore();
        }
      }
      if (bust) {
        // Red splat
        const splatR = 30 + Math.sin(frame * 0.3) * 3;
        ctx.fillStyle = "rgba(255, 80, 80, 0.4)";
        ctx.beginPath();
        ctx.ellipse(landX, landY, splatR, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 80, 80, 0.9)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(landX - 14, landY - 14); ctx.lineTo(landX + 14, landY + 14);
        ctx.moveTo(landX + 14, landY - 14); ctx.lineTo(landX - 14, landY + 14);
        ctx.stroke();
        // BUST label
        ctx.fillStyle = "rgba(2,24,48,0.95)";
        roundRect(ctx, landX - 40, landY - 56, 80, 24, 6); ctx.fill();
        ctx.strokeStyle = "#ff5a5a";
        ctx.lineWidth = 2;
        roundRect(ctx, landX - 40, landY - 56, 80, 24, 6); ctx.stroke();
        ctx.fillStyle = "#ff5a5a";
        ctx.font = 'bold 14px "Rubik", sans-serif';
        ctx.textAlign = "center";
        ctx.fillText("BUST", landX, landY - 39);
        ctx.textAlign = "start";
      } else {
        // Gold landing glow + multi chip
        const glow = ctx.createRadialGradient(landX, landY, 2, landX, landY, 44);
        glow.addColorStop(0, "rgba(255, 215, 106, 0.75)");
        glow.addColorStop(1, "rgba(255, 215, 106, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.ellipse(landX, landY, 44, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        const mult = distanceBpToMultiplier(distanceBp);
        ctx.shadowColor = "rgba(255,215,106,0.7)";
        ctx.shadowBlur = 14;
        ctx.fillStyle = "rgba(255, 215, 106, 0.95)";
        roundRect(ctx, landX - 36, landY - 60, 72, 30, 8);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#1a0a00";
        ctx.font = 'bold 17px "Rubik", sans-serif';
        ctx.textAlign = "center";
        ctx.fillText(mult.toFixed(2) + "×", landX, landY - 40);
        ctx.textAlign = "start";
      }
    }
  }

  // Vignette — draw in screen space so it always wraps the viewport.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const vig = ctx.createRadialGradient(cw / 2, ch / 2, ch * 0.45, cw / 2, ch / 2, Math.max(cw, ch) * 0.9);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, cw, ch);
}

// ─── DRAW HELPERS (copied from LauncherPreview so this file stands alone) ──
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number) {
  const top = y - h;
  const points: [number, number][] = [];
  const bumps = 7;
  for (let i = 0; i <= bumps; i++) {
    const t = i / bumps;
    const px = x - w / 2 + t * w;
    const roughness = Math.sin((seed + i) * 91.7) * 0.5 + 0.5;
    const py = top + (Math.sin(i * 1.7 + seed * 17) * 0.25 + 0.15) * h * roughness;
    points.push([px, py]);
  }
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(x, y + 2, w * 0.55, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  const rockGrad = ctx.createLinearGradient(0, top, 0, y);
  rockGrad.addColorStop(0, "#4a4a52");
  rockGrad.addColorStop(0.5, "#2a2a32");
  rockGrad.addColorStop(1, "#181820");
  ctx.fillStyle = rockGrad;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  for (const [px, py] of points) ctx.lineTo(px, py);
  ctx.lineTo(x + w / 2, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(60, 120, 90, 0.55)";
  ctx.beginPath();
  ctx.moveTo(points[0]![0], points[0]![1]);
  for (const [px, py] of points) ctx.lineTo(px, py - 0.5);
  for (let i = points.length - 1; i >= 0; i--) {
    const [px, py] = points[i]!;
    ctx.lineTo(px, py + 2.2);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  for (let i = 0; i < 3; i++) {
    const sx = x - w / 3 + (i * w) / 4;
    const sy = top + h * 0.25 + Math.sin(seed * 11 + i) * 3;
    ctx.beginPath();
    ctx.arc(sx, sy, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawReef(ctx: CanvasRenderingContext2D, cx: number, baseY: number, reef: Reef, frame: number) {
  const moundH = 14;
  const moundGrad = ctx.createLinearGradient(0, baseY - moundH, 0, baseY);
  moundGrad.addColorStop(0, "#7a5a38");
  moundGrad.addColorStop(1, "#3a2410");
  ctx.fillStyle = moundGrad;
  ctx.beginPath();
  ctx.moveTo(cx - reef.wBase / 2, baseY);
  ctx.quadraticCurveTo(cx - reef.wBase / 3, baseY - moundH, cx, baseY - moundH);
  ctx.quadraticCurveTo(cx + reef.wBase / 3, baseY - moundH, cx + reef.wBase / 2, baseY);
  ctx.closePath();
  ctx.fill();
  for (const coral of reef.corals) {
    const kx = cx + coral.x;
    const sway = Math.sin(frame * 0.03 + coral.sway) * 3;
    ctx.strokeStyle = coral.color;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(kx, baseY - 2);
    ctx.quadraticCurveTo(kx + sway * 0.5, baseY - coral.h / 2, kx + sway, baseY - coral.h);
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const t = 0.35 + i * 0.2;
      const by = baseY - coral.h * t;
      const bxs = kx + sway * t * 0.5;
      const dir = i % 2 === 0 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(bxs, by);
      ctx.quadraticCurveTo(bxs + dir * 4, by - 2, bxs + dir * 8, by - coral.h * 0.15);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = coral.color;
    ctx.beginPath();
    ctx.arc(kx + sway, baseY - coral.h, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBottomCreature(ctx: CanvasRenderingContext2D, cx: number, cy: number, c: Creature, frame: number) {
  drawFishSprite(ctx, cx, cy, c.color, c.size, c.flip, frame + cx * 0.3);
}

function drawFishSprite(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, size: number, flip: boolean, frame: number) {
  const L = 26 * size;
  const H2 = 11 * size;
  ctx.save();
  ctx.translate(cx, cy);
  if (flip) ctx.scale(-1, 1);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.ellipse(0, H2 * 0.95, L * 0.45, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
  const tailFlick = Math.sin(frame * 0.25) * 3;
  ctx.fillStyle = darken(color, 0.35);
  ctx.beginPath();
  ctx.moveTo(-L * 0.38, 0);
  ctx.quadraticCurveTo(-L * 0.55, -H2 * 0.3, -L * 0.62, -H2 * 1.1 + tailFlick);
  ctx.quadraticCurveTo(-L * 0.5, -H2 * 0.3, -L * 0.4, -H2 * 0.1);
  ctx.quadraticCurveTo(-L * 0.5, H2 * 0.3, -L * 0.62, H2 * 1.1 - tailFlick);
  ctx.quadraticCurveTo(-L * 0.55, H2 * 0.3, -L * 0.38, 0);
  ctx.closePath();
  ctx.fill();
  const bodyGrad = ctx.createLinearGradient(0, -H2, 0, H2);
  bodyGrad.addColorStop(0, lighten(color, 0.35));
  bodyGrad.addColorStop(0.45, color);
  bodyGrad.addColorStop(0.85, darken(color, 0.2));
  bodyGrad.addColorStop(1, darken(color, 0.45));
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(L * 0.5, 0);
  ctx.bezierCurveTo(L * 0.5, -H2 * 0.85, L * 0.22, -H2 * 1.05, 0, -H2 * 0.95);
  ctx.bezierCurveTo(-L * 0.22, -H2 * 0.9, -L * 0.38, -H2 * 0.35, -L * 0.4, 0);
  ctx.bezierCurveTo(-L * 0.38, H2 * 0.35, -L * 0.22, H2 * 0.9, 0, H2 * 0.95);
  ctx.bezierCurveTo(L * 0.22, H2 * 1.05, L * 0.5, H2 * 0.85, L * 0.5, 0);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = darken(color, 0.35);
  for (let i = 0; i < 3; i++) {
    const sx = L * 0.2 - i * L * 0.2;
    const sw = L * 0.07;
    ctx.beginPath();
    ctx.moveTo(sx - sw / 2, -H2 * 0.8);
    ctx.quadraticCurveTo(sx, -H2 * 0.9, sx + sw / 2, -H2 * 0.8);
    ctx.lineTo(sx + sw / 2, H2 * 0.8);
    ctx.quadraticCurveTo(sx, H2 * 0.9, sx - sw / 2, H2 * 0.8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = darken(color, 0.25);
  ctx.beginPath();
  ctx.moveTo(-L * 0.1, -H2 * 0.9);
  ctx.lineTo(-L * 0.05, -H2 * 1.55);
  ctx.lineTo(L * 0.06, -H2 * 1.75);
  ctx.lineTo(L * 0.12, -H2 * 1.5);
  ctx.lineTo(L * 0.2, -H2 * 0.95);
  ctx.closePath();
  ctx.fill();
  const eyeX = L * 0.4, eyeY = -H2 * 0.3;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(eyeX, eyeY, H2 * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0a0a1a";
  ctx.beginPath();
  ctx.arc(eyeX + H2 * 0.05, eyeY + H2 * 0.02, H2 * 0.19, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(eyeX + H2 * 0.12, eyeY - H2 * 0.08, H2 * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function lighten(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}
function darken(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}
function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function rgbToHex(r: number, g: number, b: number) {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function drawDetailedCannon(ctx: CanvasRenderingContext2D, baseX: number, baseY: number, frame: number, extraSmoke: boolean, barrelRad: number) {
  const angle = barrelRad;

  // Carriage
  const carX = baseX - 18, carY = baseY - 26;
  const carW = 64, carH = 22;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(baseX + 10, baseY + 2, 62, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  const woodGrad = ctx.createLinearGradient(0, carY, 0, carY + carH);
  woodGrad.addColorStop(0, "#8b5a2b");
  woodGrad.addColorStop(0.6, "#5a3816");
  woodGrad.addColorStop(1, "#2e1a08");
  ctx.fillStyle = woodGrad;
  ctx.beginPath();
  ctx.moveTo(carX, carY + 4);
  ctx.lineTo(carX + carW, carY);
  ctx.lineTo(carX + carW, carY + carH);
  ctx.lineTo(carX, carY + carH);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#1a1410";
  for (const [bx, by] of [[carX + 6, carY + 8], [carX + carW - 6, carY + 6], [carX + 6, carY + carH - 5], [carX + carW - 6, carY + carH - 5]]) {
    ctx.beginPath();
    ctx.arc(bx!, by!, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Barrel
  ctx.save();
  ctx.translate(baseX, baseY - 20);
  ctx.rotate(angle);
  const barrelGrad = ctx.createLinearGradient(0, -16, 0, 16);
  barrelGrad.addColorStop(0, "#5a5048");
  barrelGrad.addColorStop(0.35, "#2a2218");
  barrelGrad.addColorStop(1, "#0a0804");
  ctx.fillStyle = barrelGrad;
  ctx.beginPath();
  ctx.moveTo(-12, -10); ctx.lineTo(68, -14); ctx.lineTo(72, -16);
  ctx.lineTo(72, 16); ctx.lineTo(68, 14); ctx.lineTo(-12, 10);
  ctx.lineTo(-18, 6); ctx.lineTo(-20, 0); ctx.lineTo(-18, -6);
  ctx.closePath(); ctx.fill();
  // Brass bands
  for (const bx of [0, 26, 58]) {
    const tb = (bx + 20) / 92;
    const bandH = 10 + (1 - tb) * 4;
    const brass = ctx.createLinearGradient(0, -bandH, 0, bandH);
    brass.addColorStop(0, "#f4d48a"); brass.addColorStop(0.5, "#c28e4a"); brass.addColorStop(1, "#6a4820");
    ctx.fillStyle = brass;
    ctx.fillRect(bx - 2, -bandH - 1, 5, bandH * 2 + 2);
  }
  // Muzzle lip
  const lipGrad = ctx.createLinearGradient(0, -16, 0, 16);
  lipGrad.addColorStop(0, "#f4d48a"); lipGrad.addColorStop(0.5, "#c28e4a"); lipGrad.addColorStop(1, "#6a4820");
  ctx.fillStyle = lipGrad;
  ctx.fillRect(68, -16, 4, 32);
  ctx.fillStyle = "#050302";
  ctx.beginPath();
  ctx.ellipse(71, 0, 2, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  // Smoke puffs — more when firing
  const smokeCount = extraSmoke ? 7 : 4;
  for (let i = 0; i < smokeCount; i++) {
    const sf = frame * 0.12 + i;
    const sx = 82 + i * 6 + Math.sin(sf) * 1.5;
    const sy = -2 + Math.cos(sf * 0.7) * 2 - i * 2;
    const sr = 10 - i * 1.2 + Math.sin(sf) * 1;
    const sa = (extraSmoke ? 0.7 : 0.5) - i * 0.08;
    ctx.fillStyle = `rgba(240, 240, 250, ${Math.max(0, sa)})`;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(2, sr), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Wheels
  for (const wx of [baseX - 10, baseX + 22]) {
    ctx.fillStyle = "#1a140a";
    ctx.beginPath();
    ctx.arc(wx, baseY - 6, 14, 0, Math.PI * 2);
    ctx.fill();
    const wheelGrad = ctx.createRadialGradient(wx, baseY - 6, 2, wx, baseY - 6, 12);
    wheelGrad.addColorStop(0, "#8b5a2b");
    wheelGrad.addColorStop(1, "#3a2310");
    ctx.fillStyle = wheelGrad;
    ctx.beginPath();
    ctx.arc(wx, baseY - 6, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#2a1a08";
    ctx.lineWidth = 2;
    for (let s = 0; s < 6; s++) {
      const a = (s / 6) * Math.PI * 2 + frame * 0.003;
      ctx.beginPath();
      ctx.moveTo(wx, baseY - 6);
      ctx.lineTo(wx + Math.cos(a) * 12, baseY - 6 + Math.sin(a) * 12);
      ctx.stroke();
    }
    ctx.fillStyle = "#c28e4a";
    ctx.beginPath();
    ctx.arc(wx, baseY - 6, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function btnStyle(accent: string): React.CSSProperties {
  return {
    background: accent,
    color: "#021830",
    border: "none",
    borderRadius: 10,
    padding: "11px 22px",
    fontWeight: 700,
    fontSize: 14,
    fontFamily: "system-ui, sans-serif",
    cursor: "pointer",
    minWidth: 220,
  };
}

const presetBtnStyle: React.CSSProperties = {
  background: "rgba(127,227,255,0.12)",
  color: "#cfe7ff",
  border: "1px solid rgba(127,227,255,0.22)",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 11,
  fontFamily: "ui-monospace, monospace",
  cursor: "pointer",
  flex: 1,
};
