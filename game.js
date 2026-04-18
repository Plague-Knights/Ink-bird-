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
  let particles;
  let trail;
  let stars;
  let hills;
  let score;
  let ink;
  let best = parseInt(localStorage.getItem("inkbird.best") || "0", 10);
  let frame;
  let groundX;
  let shake;

  bestEl.textContent = best;

  function rand(a, b) { return a + Math.random() * (b - a); }

  function initParallax() {
    stars = [];
    for (let i = 0; i < 40; i++) {
      stars.push({ x: Math.random() * W, y: Math.random() * (H - GROUND_H - 160), r: rand(0.4, 1.6), tw: Math.random() * Math.PI * 2 });
    }
    hills = [];
    // Far hills
    for (let i = 0; i < 6; i++) {
      hills.push({ layer: 0, x: i * 120, w: rand(140, 220), h: rand(60, 110) });
    }
    // Near hills
    for (let i = 0; i < 6; i++) {
      hills.push({ layer: 1, x: i * 160, w: rand(180, 260), h: rand(90, 150) });
    }
  }

  function reset() {
    state = STATE.READY;
    bird = {
      x: W * 0.28,
      y: H * 0.45,
      vy: 0,
      r: 16,
      rot: 0,
      flapPhase: 0,
    };
    pipes = [];
    droplets = [];
    particles = [];
    trail = [];
    score = 0;
    ink = 0;
    frame = 0;
    groundX = 0;
    shake = 0;
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

    if (Math.random() < 0.85) {
      const dropX = x + PIPE_WIDTH / 2 + (Math.random() * 40 - 20);
      const dropY = top + PIPE_GAP / 2 + (Math.random() * 40 - 20);
      droplets.push({ x: dropX, y: dropY, r: 10, collected: false, bob: Math.random() * Math.PI * 2 });
    }
  }

  function flap() {
    if (state === STATE.READY) state = STATE.PLAYING;
    if (state === STATE.PLAYING) {
      bird.vy = FLAP;
      bird.flapPhase = 0;
      // Puff particles.
      for (let i = 0; i < 5; i++) {
        particles.push({
          x: bird.x - 8,
          y: bird.y + 6,
          vx: rand(-1.6, -0.3),
          vy: rand(-0.5, 0.8),
          life: 20,
          max: 20,
          r: rand(2, 4),
          color: "rgba(255,255,255,0.7)",
          kind: "puff",
        });
      }
    } else if (state === STATE.DEAD) {
      reset();
    }
  }

  function splash(x, y, color) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(1.5, 4);
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1,
        life: 28 + Math.random() * 10,
        max: 36,
        r: rand(1.5, 3.5),
        color,
        kind: "splash",
        g: 0.2,
      });
    }
  }

  function update() {
    frame++;
    groundX = (groundX - PIPE_SPEED) % 32;
    shake *= 0.85;

    // Parallax movement.
    for (const s of stars) {
      s.x -= 0.15;
      s.tw += 0.05;
      if (s.x < -4) s.x = W + 4;
    }
    for (const h of hills) {
      h.x -= h.layer === 0 ? 0.3 : 0.7;
      if (h.x + h.w < 0) h.x = W + Math.random() * 40;
    }

    // Particles.
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.g) p.vy += p.g;
      p.life--;
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      if (particles[i].life <= 0) particles.splice(i, 1);
    }

    if (state === STATE.READY) {
      bird.y = H * 0.45 + Math.sin(frame / 15) * 6;
      bird.flapPhase += 0.25;
      return;
    }

    if (state === STATE.PLAYING) {
      bird.vy += GRAVITY;
      bird.y += bird.vy;
      bird.rot = Math.max(-0.5, Math.min(1.2, bird.vy / 10));
      bird.flapPhase += bird.vy < 0 ? 0.6 : 0.3;

      // Ink trail.
      if (frame % 3 === 0) {
        trail.push({ x: bird.x - 10, y: bird.y + 4, r: rand(3, 5), life: 30 });
      }
      for (const t of trail) t.life--;
      while (trail.length && trail[0].life <= 0) trail.shift();

      for (const p of pipes) p.x -= PIPE_SPEED;
      for (const d of droplets) {
        d.x -= PIPE_SPEED;
        d.bob += 0.15;
      }

      while (pipes.length && pipes[0].x + PIPE_WIDTH < -20) pipes.shift();
      while (droplets.length && droplets[0].x < -20) droplets.shift();

      const last = pipes[pipes.length - 1];
      if (last && last.x < W - PIPE_SPACING) {
        spawnPipe(last.x + PIPE_SPACING);
      }

      for (const p of pipes) {
        if (!p.passed && p.x + PIPE_WIDTH < bird.x - bird.r) {
          p.passed = true;
          score += 1;
          scoreEl.textContent = score;
        }
      }

      for (const d of droplets) {
        if (d.collected) continue;
        const dx = d.x - bird.x;
        const dy = d.y - bird.y;
        if (dx * dx + dy * dy < (d.r + bird.r) * (d.r + bird.r)) {
          d.collected = true;
          ink += 1;
          inkEl.textContent = ink;
          splash(d.x, d.y, "rgba(40, 20, 80, 0.9)");
        }
      }

      if (bird.y + bird.r >= H - GROUND_H) {
        bird.y = H - GROUND_H - bird.r;
        die();
      }
      if (bird.y - bird.r <= 0) {
        bird.y = bird.r;
        bird.vy = 0;
      }

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
    shake = 14;
    splash(bird.x, bird.y, "rgba(30, 10, 60, 0.9)");
    splash(bird.x, bird.y, "rgba(120, 60, 200, 0.8)");
    const total = score + ink * 2;
    if (total > best) {
      best = total;
      localStorage.setItem("inkbird.best", String(best));
      bestEl.textContent = best;
    }
  }

  // ---------- Rendering ----------

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, H - GROUND_H);
    g.addColorStop(0, "#1b1446");
    g.addColorStop(0.45, "#3a2c7a");
    g.addColorStop(0.8, "#c85a8a");
    g.addColorStop(1, "#f3c27a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H - GROUND_H);
  }

  function drawStars() {
    for (const s of stars) {
      const a = 0.5 + Math.sin(s.tw) * 0.3;
      ctx.fillStyle = `rgba(255,245,220,${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Moon.
    const mx = W - 80;
    const my = 90;
    ctx.fillStyle = "rgba(255, 240, 200, 0.95)";
    ctx.beginPath();
    ctx.arc(mx, my, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    ctx.beginPath();
    ctx.arc(mx - 6, my - 4, 5, 0, Math.PI * 2);
    ctx.arc(mx + 8, my + 6, 4, 0, Math.PI * 2);
    ctx.arc(mx - 2, my + 10, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHills() {
    // Far
    ctx.fillStyle = "rgba(50, 28, 90, 0.85)";
    for (const h of hills) if (h.layer === 0) {
      const baseY = H - GROUND_H;
      ctx.beginPath();
      ctx.moveTo(h.x, baseY);
      ctx.quadraticCurveTo(h.x + h.w / 2, baseY - h.h, h.x + h.w, baseY);
      ctx.closePath();
      ctx.fill();
    }
    // Near
    ctx.fillStyle = "rgba(30, 14, 60, 0.95)";
    for (const h of hills) if (h.layer === 1) {
      const baseY = H - GROUND_H;
      ctx.beginPath();
      ctx.moveTo(h.x, baseY);
      ctx.quadraticCurveTo(h.x + h.w / 2, baseY - h.h, h.x + h.w, baseY);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawPipe(x, topH, isTop) {
    // Pipe as an ink-glass column.
    const y = isTop ? 0 : topH + PIPE_GAP;
    const h = isTop ? topH : H - GROUND_H - (topH + PIPE_GAP);

    // Shadow stripe on the ground behind.
    const grad = ctx.createLinearGradient(x, 0, x + PIPE_WIDTH, 0);
    grad.addColorStop(0, "#1a0b36");
    grad.addColorStop(0.25, "#4a2790");
    grad.addColorStop(0.5, "#7c4fd6");
    grad.addColorStop(0.75, "#4a2790");
    grad.addColorStop(1, "#1a0b36");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, PIPE_WIDTH, h);

    // Glass highlight.
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(x + 8, y, 4, h);

    // Inner ink level (fills partway).
    const inkFillH = Math.min(h - 8, 90 + Math.sin((x + frame) * 0.02) * 6);
    const inkY = isTop ? y + h - inkFillH - 4 : y + 4;
    ctx.fillStyle = "#0b0420";
    ctx.fillRect(x + 6, inkY, PIPE_WIDTH - 12, inkFillH);
    // Ink meniscus.
    ctx.fillStyle = "#1a0b36";
    ctx.fillRect(x + 6, isTop ? inkY : inkY + inkFillH - 2, PIPE_WIDTH - 12, 2);

    // Cap (rim).
    const capH = 16;
    const capY = isTop ? y + h - capH : y;
    const capGrad = ctx.createLinearGradient(x, 0, x + PIPE_WIDTH, 0);
    capGrad.addColorStop(0, "#12062a");
    capGrad.addColorStop(0.5, "#5b31ae");
    capGrad.addColorStop(1, "#12062a");
    ctx.fillStyle = capGrad;
    ctx.fillRect(x - 5, capY, PIPE_WIDTH + 10, capH);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(x - 3, capY + 2, 6, capH - 4);
    // Cap edge.
    ctx.fillStyle = "#080218";
    ctx.fillRect(x - 5, isTop ? capY : capY + capH - 2, PIPE_WIDTH + 10, 2);
  }

  function drawPipes() {
    for (const p of pipes) {
      drawPipe(p.x, p.top, true);
      drawPipe(p.x, p.top, false);
    }
  }

  function drawDroplets() {
    for (const d of droplets) {
      if (d.collected) continue;
      const y = d.y + Math.sin(d.bob) * 3;

      // Glow halo.
      const halo = ctx.createRadialGradient(d.x, y, 2, d.x, y, d.r * 2.4);
      halo.addColorStop(0, "rgba(180, 140, 255, 0.55)");
      halo.addColorStop(1, "rgba(180, 140, 255, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(d.x, y, d.r * 2.4, 0, Math.PI * 2);
      ctx.fill();

      // Droplet body.
      ctx.save();
      ctx.translate(d.x, y);
      const bodyGrad = ctx.createRadialGradient(-3, -4, 1, 0, 0, d.r);
      bodyGrad.addColorStop(0, "#6a3fd0");
      bodyGrad.addColorStop(0.6, "#2a1060");
      bodyGrad.addColorStop(1, "#0a0224");
      ctx.fillStyle = bodyGrad;
      ctx.beginPath();
      ctx.moveTo(0, -d.r * 1.25);
      ctx.bezierCurveTo(d.r * 1.05, -d.r * 0.2, d.r, d.r, 0, d.r);
      ctx.bezierCurveTo(-d.r, d.r, -d.r * 1.05, -d.r * 0.2, 0, -d.r * 1.25);
      ctx.fill();
      // Highlight.
      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      ctx.beginPath();
      ctx.ellipse(-d.r * 0.3, -d.r * 0.3, d.r * 0.22, d.r * 0.38, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawGround() {
    // Base.
    const g = ctx.createLinearGradient(0, H - GROUND_H, 0, H);
    g.addColorStop(0, "#3a1e5f");
    g.addColorStop(1, "#150828");
    ctx.fillStyle = g;
    ctx.fillRect(0, H - GROUND_H, W, GROUND_H);

    // Top lip.
    ctx.fillStyle = "#5a2e94";
    ctx.fillRect(0, H - GROUND_H, W, 4);
    ctx.fillStyle = "#20103c";
    ctx.fillRect(0, H - GROUND_H + 4, W, 2);

    // Tufts / ink blots.
    for (let x = groundX; x < W + 32; x += 32) {
      ctx.fillStyle = "#2a1046";
      ctx.beginPath();
      ctx.arc(x + 8, H - GROUND_H + 10, 4, 0, Math.PI * 2);
      ctx.arc(x + 16, H - GROUND_H + 8, 2.5, 0, Math.PI * 2);
      ctx.arc(x + 22, H - GROUND_H + 12, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Scanlines / cracks.
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const yy = H - GROUND_H + 20 + i * 12;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(W, yy);
      ctx.stroke();
    }
  }

  function drawTrail() {
    for (const t of trail) {
      const a = Math.max(0, t.life / 30);
      ctx.fillStyle = `rgba(30, 10, 60, ${a * 0.5})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * a, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const a = p.life / p.max;
      if (p.kind === "puff") {
        ctx.fillStyle = `rgba(255,255,255,${a * 0.7})`;
      } else {
        ctx.fillStyle = p.color.replace(/[\d.]+\)$/g, `${a})`);
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBird() {
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot);

    // Soft shadow beneath.
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(2, bird.r + 2, bird.r, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tail feathers.
    ctx.fillStyle = "#2a1358";
    ctx.beginPath();
    ctx.moveTo(-bird.r - 2, -2);
    ctx.lineTo(-bird.r - 10, -8);
    ctx.lineTo(-bird.r - 12, 0);
    ctx.lineTo(-bird.r - 10, 8);
    ctx.closePath();
    ctx.fill();

    // Body.
    const bodyGrad = ctx.createRadialGradient(-5, -6, 2, 0, 0, bird.r + 6);
    bodyGrad.addColorStop(0, "#9a73e6");
    bodyGrad.addColorStop(0.5, "#5a33b5");
    bodyGrad.addColorStop(1, "#1a0b36");
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, bird.r + 3, bird.r, 0, 0, Math.PI * 2);
    ctx.fill();

    // Belly.
    ctx.fillStyle = "rgba(255, 230, 200, 0.75)";
    ctx.beginPath();
    ctx.ellipse(2, 5, bird.r * 0.65, bird.r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Wing (animated).
    const wing = Math.sin(bird.flapPhase);
    ctx.save();
    ctx.translate(-2, 2);
    ctx.rotate(wing * 0.7 - 0.2);
    const wingGrad = ctx.createLinearGradient(-10, -6, 10, 8);
    wingGrad.addColorStop(0, "#b79af0");
    wingGrad.addColorStop(1, "#3a1c7a");
    ctx.fillStyle = wingGrad;
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.beginPath();
    ctx.ellipse(-2, -2, 6, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Eye white.
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(8, -5, 5, 0, Math.PI * 2);
    ctx.fill();
    // Pupil.
    ctx.fillStyle = "#0a0320";
    ctx.beginPath();
    ctx.arc(9.5, -5, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(10.2, -6, 0.8, 0, Math.PI * 2);
    ctx.fill();

    // Beak (fountain-pen nib).
    const nibX = bird.r + 1;
    ctx.fillStyle = "#2a2a2a";
    ctx.beginPath();
    ctx.moveTo(nibX, -4);
    ctx.lineTo(nibX + 14, 0);
    ctx.lineTo(nibX, 5);
    ctx.closePath();
    ctx.fill();
    // Nib highlight.
    ctx.fillStyle = "#8a8a95";
    ctx.beginPath();
    ctx.moveTo(nibX + 1, -3);
    ctx.lineTo(nibX + 10, 0);
    ctx.lineTo(nibX + 1, 2);
    ctx.closePath();
    ctx.fill();
    // Nib slit.
    ctx.strokeStyle = "#0a0320";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(nibX + 2, 0);
    ctx.lineTo(nibX + 12, 0);
    ctx.stroke();
    // Nib breather hole.
    ctx.fillStyle = "#0a0320";
    ctx.beginPath();
    ctx.arc(nibX + 4, 0, 1.1, 0, Math.PI * 2);
    ctx.fill();
    // Ink bead at tip.
    ctx.fillStyle = "rgba(30, 10, 60, 0.9)";
    ctx.beginPath();
    ctx.arc(nibX + 14.5, 0.5, 1.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawScoreBig() {
    if (state !== STATE.PLAYING) return;
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "bold 52px sans-serif";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.strokeText(String(score), W / 2, 80);
    ctx.fillStyle = "#fff";
    ctx.fillText(String(score), W / 2, 80);
    ctx.restore();
  }

  function drawOverlay() {
    ctx.fillStyle = "rgba(10, 5, 25, 0.55)";
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";

    if (state === STATE.READY) {
      ctx.font = "bold 44px sans-serif";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.strokeText("Ink Bird", W / 2, H / 2 - 50);
      ctx.fillText("Ink Bird", W / 2, H / 2 - 50);
      ctx.font = "16px sans-serif";
      ctx.fillText("Click / Tap / Space to flap", W / 2, H / 2);
      ctx.fillText("Collect ink droplets for bonus", W / 2, H / 2 + 24);
    } else if (state === STATE.DEAD) {
      ctx.font = "bold 40px sans-serif";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.strokeText("Splat!", W / 2, H / 2 - 70);
      ctx.fillText("Splat!", W / 2, H / 2 - 70);

      // Scorecard box.
      const bx = W / 2 - 120;
      const by = H / 2 - 40;
      ctx.fillStyle = "rgba(20, 10, 40, 0.85)";
      ctx.strokeStyle = "rgba(180,140,255,0.7)";
      ctx.lineWidth = 2;
      ctx.fillRect(bx, by, 240, 120);
      ctx.strokeRect(bx, by, 240, 120);
      ctx.fillStyle = "#fff";
      ctx.font = "16px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`Pipes cleared`, bx + 14, by + 28);
      ctx.fillText(`Ink collected`, bx + 14, by + 52);
      ctx.fillText(`Total`, bx + 14, by + 82);
      ctx.fillText(`Best`, bx + 14, by + 106);
      ctx.textAlign = "right";
      ctx.fillText(String(score), bx + 226, by + 28);
      ctx.fillText(String(ink), bx + 226, by + 52);
      ctx.fillText(String(score + ink * 2), bx + 226, by + 82);
      ctx.fillText(String(best), bx + 226, by + 106);

      ctx.textAlign = "center";
      ctx.font = "14px sans-serif";
      ctx.fillText("Click or press R to retry", W / 2, H / 2 + 108);
    }
    ctx.restore();
  }

  function render() {
    ctx.save();
    if (shake > 0.3) {
      ctx.translate(rand(-shake, shake), rand(-shake, shake));
    }
    ctx.clearRect(0, 0, W, H);
    drawSky();
    drawStars();
    drawHills();
    drawTrail();
    drawPipes();
    drawDroplets();
    drawParticles();
    drawGround();
    drawBird();
    drawScoreBig();
    drawVignette();
    if (state !== STATE.PLAYING) drawOverlay();
    ctx.restore();
  }

  function loop() {
    update();
    render();
    requestAnimationFrame(loop);
  }

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

  initParallax();
  reset();
  loop();
})();
