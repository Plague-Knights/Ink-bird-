(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const scoreEl = document.getElementById("score");
  const inkEl = document.getElementById("ink");
  const bestEl = document.getElementById("best");

  const GRAVITY = 0.45;
  const FLAP = -7.8;
  const PIPE_GAP = 160;
  const PIPE_WIDTH = 64;
  const PIPE_SPEED = 2.4;
  const PIPE_SPACING = 220;
  const GROUND_H = 72;

  const STATE = { READY: 0, PLAYING: 1, DEAD: 2 };

  let state;
  let bird;
  let pipes;
  let droplets;
  let score;
  let ink;
  let best = parseInt(localStorage.getItem("inkbird.best") || "0", 10);
  let frame;
  let groundX;

  bestEl.textContent = best;

  function reset() {
    state = STATE.READY;
    bird = {
      x: W * 0.28,
      y: H * 0.45,
      vy: 0,
      r: 16,
      rot: 0,
    };
    pipes = [];
    droplets = [];
    score = 0;
    ink = 0;
    frame = 0;
    groundX = 0;
    scoreEl.textContent = score;
    inkEl.textContent = ink;
    spawnPipe(W + 60);
    spawnPipe(W + 60 + PIPE_SPACING);
    spawnPipe(W + 60 + PIPE_SPACING * 2);
  }

  function spawnPipe(x) {
    const margin = 60;
    const minTop = margin;
    const maxTop = H - GROUND_H - PIPE_GAP - margin;
    const top = minTop + Math.random() * (maxTop - minTop);
    pipes.push({ x, top, passed: false });

    // Place an ink droplet in the gap, occasionally offset horizontally.
    if (Math.random() < 0.85) {
      const dropX = x + PIPE_WIDTH / 2 + (Math.random() * 40 - 20);
      const dropY = top + PIPE_GAP / 2 + (Math.random() * 40 - 20);
      droplets.push({ x: dropX, y: dropY, r: 9, collected: false, bob: Math.random() * Math.PI * 2 });
    }
  }

  function flap() {
    if (state === STATE.READY) state = STATE.PLAYING;
    if (state === STATE.PLAYING) {
      bird.vy = FLAP;
    } else if (state === STATE.DEAD) {
      reset();
    }
  }

  function update() {
    frame++;
    groundX = (groundX - PIPE_SPEED) % 24;

    if (state === STATE.READY) {
      bird.y = H * 0.45 + Math.sin(frame / 15) * 6;
      return;
    }

    if (state === STATE.PLAYING) {
      bird.vy += GRAVITY;
      bird.y += bird.vy;
      bird.rot = Math.max(-0.5, Math.min(1.2, bird.vy / 10));

      for (const p of pipes) p.x -= PIPE_SPEED;
      for (const d of droplets) {
        d.x -= PIPE_SPEED;
        d.bob += 0.15;
      }

      // Recycle pipes.
      while (pipes.length && pipes[0].x + PIPE_WIDTH < -20) pipes.shift();
      while (droplets.length && droplets[0].x < -20) droplets.shift();

      const last = pipes[pipes.length - 1];
      if (last && last.x < W - PIPE_SPACING) {
        spawnPipe(last.x + PIPE_SPACING);
      }

      // Score pipes passed.
      for (const p of pipes) {
        if (!p.passed && p.x + PIPE_WIDTH < bird.x - bird.r) {
          p.passed = true;
          score += 1;
          scoreEl.textContent = score;
        }
      }

      // Collect droplets.
      for (const d of droplets) {
        if (d.collected) continue;
        const dx = d.x - bird.x;
        const dy = d.y - bird.y;
        if (dx * dx + dy * dy < (d.r + bird.r) * (d.r + bird.r)) {
          d.collected = true;
          ink += 1;
          inkEl.textContent = ink;
        }
      }

      // Collision with ground/ceiling.
      if (bird.y + bird.r >= H - GROUND_H) {
        bird.y = H - GROUND_H - bird.r;
        die();
      }
      if (bird.y - bird.r <= 0) {
        bird.y = bird.r;
        bird.vy = 0;
      }

      // Collision with pipes.
      for (const p of pipes) {
        if (bird.x + bird.r > p.x && bird.x - bird.r < p.x + PIPE_WIDTH) {
          if (bird.y - bird.r < p.top || bird.y + bird.r > p.top + PIPE_GAP) {
            die();
            break;
          }
        }
      }
    } else if (state === STATE.DEAD) {
      bird.vy += GRAVITY;
      bird.y += bird.vy;
      bird.rot = Math.min(1.4, bird.rot + 0.05);
      if (bird.y + bird.r >= H - GROUND_H) {
        bird.y = H - GROUND_H - bird.r;
        bird.vy = 0;
      }
    }
  }

  function die() {
    if (state !== STATE.PLAYING) return;
    state = STATE.DEAD;
    const total = score + ink * 2;
    if (total > best) {
      best = total;
      localStorage.setItem("inkbird.best", String(best));
      bestEl.textContent = best;
    }
  }

  function drawBackground() {
    // Soft clouds.
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    for (let i = 0; i < 4; i++) {
      const cx = ((frame * 0.3 + i * 160) % (W + 120)) - 60;
      const cy = 70 + i * 40;
      ctx.beginPath();
      ctx.arc(cx, cy, 22, 0, Math.PI * 2);
      ctx.arc(cx + 22, cy + 6, 18, 0, Math.PI * 2);
      ctx.arc(cx - 20, cy + 6, 16, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPipes() {
    for (const p of pipes) {
      const grad = ctx.createLinearGradient(p.x, 0, p.x + PIPE_WIDTH, 0);
      grad.addColorStop(0, "#3a1a5c");
      grad.addColorStop(0.5, "#6c3bbd");
      grad.addColorStop(1, "#3a1a5c");
      ctx.fillStyle = grad;

      // Top pipe.
      ctx.fillRect(p.x, 0, PIPE_WIDTH, p.top);
      // Bottom pipe.
      ctx.fillRect(p.x, p.top + PIPE_GAP, PIPE_WIDTH, H - GROUND_H - (p.top + PIPE_GAP));

      // Rims.
      ctx.fillStyle = "#22103b";
      ctx.fillRect(p.x - 4, p.top - 14, PIPE_WIDTH + 8, 14);
      ctx.fillRect(p.x - 4, p.top + PIPE_GAP, PIPE_WIDTH + 8, 14);
    }
  }

  function drawDroplets() {
    for (const d of droplets) {
      if (d.collected) continue;
      const y = d.y + Math.sin(d.bob) * 3;
      // Ink droplet teardrop.
      ctx.save();
      ctx.translate(d.x, y);
      ctx.fillStyle = "#1a1030";
      ctx.beginPath();
      ctx.moveTo(0, -d.r * 1.2);
      ctx.bezierCurveTo(d.r, -d.r * 0.2, d.r, d.r, 0, d.r);
      ctx.bezierCurveTo(-d.r, d.r, -d.r, -d.r * 0.2, 0, -d.r * 1.2);
      ctx.fill();
      // Highlight.
      ctx.fillStyle = "rgba(200, 180, 255, 0.7)";
      ctx.beginPath();
      ctx.ellipse(-d.r * 0.3, -d.r * 0.2, d.r * 0.2, d.r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawGround() {
    ctx.fillStyle = "#2a1a3f";
    ctx.fillRect(0, H - GROUND_H, W, GROUND_H);
    ctx.fillStyle = "#432766";
    for (let x = groundX; x < W; x += 24) {
      ctx.fillRect(x, H - GROUND_H, 12, 6);
    }
    ctx.fillStyle = "#17092b";
    ctx.fillRect(0, H - GROUND_H, W, 4);
  }

  function drawBird() {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot);

    // Trailing ink drips while playing.
    if (state === STATE.PLAYING && frame % 4 === 0) {
      // handled in sparkles below
    }

    // Body.
    const bodyGrad = ctx.createRadialGradient(-4, -4, 2, 0, 0, bird.r + 4);
    bodyGrad.addColorStop(0, "#5a3aa0");
    bodyGrad.addColorStop(1, "#1a0b36");
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, bird.r + 2, bird.r, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wing.
    ctx.fillStyle = "#7a4fd1";
    const wingPhase = Math.sin(frame / 4) * 6;
    ctx.beginPath();
    ctx.ellipse(-2, 2 + wingPhase * 0.2, 8, 5, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // Eye.
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(7, -4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(8, -4, 2, 0, Math.PI * 2);
    ctx.fill();

    // Beak (like a nib).
    ctx.fillStyle = "#f5d76e";
    ctx.beginPath();
    ctx.moveTo(bird.r, -2);
    ctx.lineTo(bird.r + 10, 0);
    ctx.lineTo(bird.r, 4);
    ctx.closePath();
    ctx.fill();
    // Nib slit.
    ctx.strokeStyle = "#1a0b36";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bird.r + 2, 1);
    ctx.lineTo(bird.r + 9, 1);
    ctx.stroke();

    ctx.restore();
  }

  function drawOverlay() {
    ctx.fillStyle = "rgba(15, 18, 36, 0.55)";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "bold 36px sans-serif";
    if (state === STATE.READY) {
      ctx.fillText("Ink Bird", W / 2, H / 2 - 40);
      ctx.font = "16px sans-serif";
      ctx.fillText("Click / Tap / Space to flap", W / 2, H / 2);
      ctx.fillText("Collect ink droplets for bonus", W / 2, H / 2 + 24);
    } else if (state === STATE.DEAD) {
      ctx.fillText("Splat!", W / 2, H / 2 - 60);
      ctx.font = "18px sans-serif";
      ctx.fillText(`Pipes cleared: ${score}`, W / 2, H / 2 - 20);
      ctx.fillText(`Ink collected: ${ink}`, W / 2, H / 2 + 6);
      ctx.fillText(`Total: ${score + ink * 2}   Best: ${best}`, W / 2, H / 2 + 32);
      ctx.font = "14px sans-serif";
      ctx.fillText("Click or press R to retry", W / 2, H / 2 + 64);
    }
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawBackground();
    drawPipes();
    drawDroplets();
    drawGround();
    drawBird();
    if (state !== STATE.PLAYING) drawOverlay();
  }

  function loop() {
    update();
    render();
    requestAnimationFrame(loop);
  }

  // Input.
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "ArrowUp") {
      e.preventDefault();
      flap();
    } else if (e.key === "r" || e.key === "R") {
      reset();
    }
  });
  canvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    flap();
  });
  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    flap();
  }, { passive: false });

  reset();
  loop();
})();
