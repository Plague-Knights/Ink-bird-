(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const leaderboardEl = document.getElementById("leaderboard");
  const clearBoardBtn = document.getElementById("clearBoard");
  const modal = document.getElementById("entryModal");
  const initialsInput = document.getElementById("initials");
  const entryScoreEl = document.getElementById("entryScore");
  const saveInitialsBtn = document.getElementById("saveInitials");
  const skipInitialsBtn = document.getElementById("skipInitials");

  const LEADERBOARD_KEY = "inkbird.leaderboard";
  const LEADERBOARD_MAX = 10;

  function loadLeaderboard() {
    try {
      const raw = localStorage.getItem(LEADERBOARD_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((e) => e && typeof e.name === "string" && Number.isFinite(e.score))
        .slice(0, LEADERBOARD_MAX);
    } catch {
      return [];
    }
  }

  function saveLeaderboard(list) {
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(list));
  }

  function renderLeaderboard() {
    const list = loadLeaderboard();
    leaderboardEl.innerHTML = "";
    if (!list.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No scores yet";
      leaderboardEl.appendChild(li);
      return;
    }
    list.forEach((entry, i) => {
      const li = document.createElement("li");
      li.className = `rank-${i + 1}`;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = `${i + 1}. ${entry.name}`;
      const score = document.createElement("span");
      score.className = "score";
      score.textContent = String(entry.score);
      li.appendChild(name);
      li.appendChild(score);
      leaderboardEl.appendChild(li);
    });
  }

  function qualifiesForLeaderboard(score) {
    if (score <= 0) return false;
    const list = loadLeaderboard();
    if (list.length < LEADERBOARD_MAX) return true;
    return score > list[list.length - 1].score;
  }

  function insertLeaderboardEntry(name, score) {
    const list = loadLeaderboard();
    list.push({ name, score, date: Date.now() });
    list.sort((a, b) => b.score - a.score);
    const trimmed = list.slice(0, LEADERBOARD_MAX);
    saveLeaderboard(trimmed);
    renderLeaderboard();
  }

  const GRAVITY = 0.5;
  const FLAP = -8.5;
  const PIPE_GAP = 130;
  const PIPE_WIDTH = 64;
  const PIPE_SPEED = 3.2;
  const PIPE_SPACING = 200;
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
  let best = parseInt(localStorage.getItem("inkbird.best") || "0", 10);
  let frame;
  let groundX;
  let shake;

  bestEl.textContent = best;

  function rand(a, b) { return a + Math.random() * (b - a); }

  function initParallax() {
    // "stars" are reused as rising bubbles.
    stars = [];
    for (let i = 0; i < 36; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * (H - GROUND_H),
        r: rand(1.2, 3.2),
        tw: Math.random() * Math.PI * 2,
        vy: rand(0.3, 0.9),
      });
    }
    // "hills" are reused as seaweed clumps along the seafloor.
    hills = [];
    for (let i = 0; i < 6; i++) {
      hills.push({ layer: 0, x: i * 120, w: rand(120, 180), h: rand(60, 110) });
    }
    for (let i = 0; i < 6; i++) {
      hills.push({ layer: 1, x: i * 160, w: rand(160, 220), h: rand(90, 150) });
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
    frame = 0;
    groundX = 0;
    shake = 0;
    scoreEl.textContent = score;
    spawnPipe(W + 60);
    spawnPipe(W + 60 + PIPE_SPACING);
    spawnPipe(W + 60 + PIPE_SPACING * 2);
  }

  function spawnPipe(x) {
    const margin = 60;
    const minTop = margin;
    const maxTop = H - GROUND_H - PIPE_GAP - margin;
    const top = minTop + Math.random() * (maxTop - minTop);
    // Always place a droplet centered in the gap — scoring is based on ink
    // collected, so every pipe must give the player a chance to score.
    const dropX = x + PIPE_WIDTH / 2;
    const dropY = top + PIPE_GAP / 2 + (Math.random() * 30 - 15);
    pipes.push({ x, top, passed: false });
    droplets.push({ x: dropX, y: dropY, r: 10, collected: false, bob: Math.random() * Math.PI * 2 });
  }

  function flap() {
    if (!modal.classList.contains("hidden")) return;
    if (state === STATE.READY) state = STATE.PLAYING;
    if (state === STATE.PLAYING) {
      bird.vy = FLAP;
      bird.flapPhase = 0;
      // Bubble burst from the squid's mantle when it jets.
      for (let i = 0; i < 6; i++) {
        particles.push({
          x: bird.x - 10,
          y: bird.y + rand(-3, 5),
          vx: rand(-1.8, -0.4),
          vy: rand(-1.2, -0.1),
          life: 26,
          max: 26,
          r: rand(1.5, 3.5),
          color: "rgba(200,230,255,0.85)",
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

    // Bubbles rise, with a gentle horizontal wobble, and recycle at the top.
    for (const s of stars) {
      s.y -= s.vy;
      s.x += Math.sin(s.tw) * 0.3 - 0.15;
      s.tw += 0.05;
      if (s.y < -6 || s.x < -6) {
        s.y = H - GROUND_H - rand(0, 40);
        s.x = Math.random() * W;
      }
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
      bird.rot = Math.max(-0.5, Math.min(1.4, bird.vy / 8));
      bird.flapPhase += bird.vy < 0 ? 0.6 : 0.3;

      // Ink trail.
      if (frame % 2 === 0) {
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

      // Track pipe passes only for stats (pipes don't score).
      for (const p of pipes) {
        if (!p.passed && p.x + PIPE_WIDTH < bird.x - bird.r) {
          p.passed = true;
        }
      }

      // Scoring: one point per ink droplet collected. Nothing else.
      for (const d of droplets) {
        if (d.collected) continue;
        const dx = d.x - bird.x;
        const dy = d.y - bird.y;
        if (dx * dx + dy * dy < (d.r + bird.r) * (d.r + bird.r)) {
          d.collected = true;
          score += 1;
          scoreEl.textContent = score;
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
    if (score > best) {
      best = score;
      localStorage.setItem("inkbird.best", String(best));
      bestEl.textContent = best;
    }
    if (qualifiesForLeaderboard(score)) {
      promptForInitials(score);
    }
  }

  function promptForInitials(finalScore) {
    entryScoreEl.textContent = String(finalScore);
    initialsInput.value = "";
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    setTimeout(() => initialsInput.focus(), 0);
  }

  function closeModal() {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }

  function commitInitials() {
    const raw = (initialsInput.value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const name = (raw || "???").slice(0, 3).padEnd(3, "?");
    insertLeaderboardEntry(name, score);
    closeModal();
  }

  // ---------- Rendering ----------

  function drawSky() {
    // Ocean gradient: sunlit teal at the surface, deep navy at depth.
    const g = ctx.createLinearGradient(0, 0, 0, H - GROUND_H);
    g.addColorStop(0, "#7ad3e0");
    g.addColorStop(0.25, "#2a9ac2");
    g.addColorStop(0.6, "#0e4a7c");
    g.addColorStop(1, "#041a3a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H - GROUND_H);

    // Surface shimmer band.
    const shimmer = ctx.createLinearGradient(0, 0, 0, 40);
    shimmer.addColorStop(0, "rgba(255,255,255,0.35)");
    shimmer.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = shimmer;
    ctx.fillRect(0, 0, W, 40);

    // Light rays slanting down from above.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 5; i++) {
      const baseX = ((i * 140 + frame * 0.4) % (W + 240)) - 120;
      ctx.fillStyle = "rgba(200, 230, 255, 0.05)";
      ctx.beginPath();
      ctx.moveTo(baseX, 0);
      ctx.lineTo(baseX + 50, 0);
      ctx.lineTo(baseX + 210, H - GROUND_H);
      ctx.lineTo(baseX + 170, H - GROUND_H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawStars() {
    // Rising bubbles.
    for (const s of stars) {
      const a = 0.35 + Math.sin(s.tw) * 0.15;
      ctx.strokeStyle = `rgba(220, 240, 255, ${a + 0.35})`;
      ctx.lineWidth = 1;
      ctx.fillStyle = `rgba(180, 220, 255, ${a * 0.35})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${a + 0.4})`;
      ctx.beginPath();
      ctx.arc(s.x - s.r * 0.4, s.y - s.r * 0.4, Math.max(0.6, s.r * 0.25), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHills() {
    // Seaweed clumps — thin wavy strands rooted in the seafloor.
    const baseY = H - GROUND_H;
    for (const h of hills) {
      const isFar = h.layer === 0;
      ctx.strokeStyle = isFar ? "rgba(25, 90, 80, 0.55)" : "rgba(10, 60, 45, 0.95)";
      ctx.lineWidth = isFar ? 3 : 5;
      ctx.lineCap = "round";
      const blades = isFar ? 3 : 4;
      for (let i = 0; i < blades; i++) {
        const bx = h.x + (i + 0.5) * (h.w / blades);
        const bladeH = h.h * 0.85;
        ctx.beginPath();
        ctx.moveTo(bx, baseY);
        const segs = 5;
        for (let s = 1; s <= segs; s++) {
          const t = s / segs;
          const wy = baseY - t * bladeH;
          const wx = bx + Math.sin(frame * 0.04 + i * 0.9 + h.x * 0.02 + t * 2) * 7 * t;
          ctx.lineTo(wx, wy);
        }
        ctx.stroke();
      }
    }
  }

  function drawPipe(x, topH, isTop) {
    // Rocky column with coral cap and anemone tendrils.
    const y = isTop ? 0 : topH + PIPE_GAP;
    const h = isTop ? topH : H - GROUND_H - (topH + PIPE_GAP);

    // Column body.
    const grad = ctx.createLinearGradient(x, 0, x + PIPE_WIDTH, 0);
    grad.addColorStop(0, "#10202f");
    grad.addColorStop(0.5, "#456680");
    grad.addColorStop(1, "#10202f");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, PIPE_WIDTH, h);

    // Rock speckles (seeded by x for stability).
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    const seed = (x | 0);
    for (let i = 0; i < 10; i++) {
      const rx = x + 4 + ((i * 13 + seed * 7) % (PIPE_WIDTH - 8));
      const ry = y + 8 + ((i * 29 + seed * 11) % Math.max(1, h - 16));
      ctx.beginPath();
      ctx.arc(rx, ry, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Highlight stripe.
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(x + 8, y, 3, h);

    // Coral-rock cap at the gap-facing end.
    const capH = 14;
    const capY = isTop ? y + h - capH : y;
    const capGrad = ctx.createLinearGradient(x, 0, x + PIPE_WIDTH, 0);
    capGrad.addColorStop(0, "#18344a");
    capGrad.addColorStop(0.5, "#5d87a8");
    capGrad.addColorStop(1, "#18344a");
    ctx.fillStyle = capGrad;
    ctx.fillRect(x - 5, capY, PIPE_WIDTH + 10, capH);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(x - 5, isTop ? capY : capY + capH - 2, PIPE_WIDTH + 10, 2);

    // Anemone tendrils protruding into the gap.
    const edgeY = isTop ? capY + capH : capY;
    const dir = isTop ? 1 : -1;
    const tendrils = 11;
    for (let i = 0; i < tendrils; i++) {
      const tx = x + 2 + i * ((PIPE_WIDTH - 4) / (tendrils - 1));
      const wave = Math.sin(frame * 0.08 + i * 0.7 + x * 0.02);
      const tipX = tx + wave * 3;
      const tipY = edgeY + dir * (6 + (i % 3) * 3);
      ctx.strokeStyle = i % 2 === 0 ? "#ff7aa8" : "#ff4f8b";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(tx, edgeY);
      ctx.quadraticCurveTo(tx + wave * 2, edgeY + dir * 4, tipX, tipY);
      ctx.stroke();
      ctx.fillStyle = "#ffc2d7";
      ctx.beginPath();
      ctx.arc(tipX, tipY, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
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
    // Sandy seafloor.
    const g = ctx.createLinearGradient(0, H - GROUND_H, 0, H);
    g.addColorStop(0, "#d5b47c");
    g.addColorStop(1, "#6f4c22");
    ctx.fillStyle = g;
    ctx.fillRect(0, H - GROUND_H, W, GROUND_H);

    // Dark sand line.
    ctx.fillStyle = "rgba(40, 25, 8, 0.4)";
    ctx.fillRect(0, H - GROUND_H, W, 2);

    // Pebbles and shells scrolling.
    for (let x = groundX; x < W + 32; x += 32) {
      ctx.fillStyle = "rgba(60, 38, 14, 0.55)";
      ctx.beginPath();
      ctx.arc(x + 8, H - GROUND_H + 14, 3, 0, Math.PI * 2);
      ctx.arc(x + 18, H - GROUND_H + 10, 2, 0, Math.PI * 2);
      ctx.arc(x + 24, H - GROUND_H + 18, 2.6, 0, Math.PI * 2);
      ctx.fill();
      // Tiny shell (arc).
      ctx.strokeStyle = "rgba(255, 230, 200, 0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x + 14, H - GROUND_H + 22, 2.4, Math.PI, 0);
      ctx.stroke();
    }

    // Subtle sand ripples.
    ctx.strokeStyle = "rgba(60, 30, 10, 0.18)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const yy = H - GROUND_H + 30 + i * 10;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      for (let x = 0; x <= W; x += 16) {
        ctx.lineTo(x, yy + Math.sin((x + groundX) * 0.08) * 1.2);
      }
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
        // Bubble: outlined circle with highlight.
        ctx.strokeStyle = `rgba(220,240,255,${a * 0.9})`;
        ctx.fillStyle = `rgba(180,220,255,${a * 0.25})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color.replace(/[\d.]+\)$/g, `${a})`);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawBird() {
    // Cartoony squid: mantle pointing forward (right), tentacles trailing left,
    // two side fins, two big cute eyes. Uses the same physics entity (`bird`).
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rot * 0.55);

    // Soft shadow.
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.ellipse(0, bird.r + 3, bird.r + 2, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    const mantleLen = bird.r + 9;
    const mantleH = bird.r - 2;
    const waveT = frame * 0.2 + bird.flapPhase * 0.5;

    // Eight trailing arms.
    const armBaseX = -mantleLen * 0.38;
    const arms = 8;
    for (let i = 0; i < arms; i++) {
      const row = (i - (arms - 1) / 2) / arms;
      const yStart = row * (mantleH * 1.1);
      const len = 18 + Math.abs(row) * 5;
      ctx.strokeStyle = "#4a2a9c";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(armBaseX, yStart);
      const segs = 5;
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        const ax = armBaseX - t * len;
        const ay = yStart + Math.sin(waveT + i * 0.7 + t * 3) * 4 * t;
        ctx.lineTo(ax, ay);
      }
      ctx.stroke();
      // Inner lighter stripe for depth.
      ctx.strokeStyle = "#8e67e0";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(armBaseX, yStart);
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        const ax = armBaseX - t * len;
        const ay = yStart + Math.sin(waveT + i * 0.7 + t * 3) * 4 * t;
        ctx.lineTo(ax, ay);
      }
      ctx.stroke();
    }

    // Two longer feeding tentacles with clubs.
    for (const sign of [-1, 1]) {
      const y0 = sign * mantleH * 0.5;
      ctx.strokeStyle = "#2a1358";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(armBaseX, y0);
      const segs = 6;
      const len = 28;
      let lx = armBaseX, ly = y0;
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        lx = armBaseX - t * len;
        ly = y0 + Math.sin(waveT * 1.1 + t * 4 + sign) * 5 * t;
        ctx.lineTo(lx, ly);
      }
      ctx.stroke();
      ctx.fillStyle = "#7c4fd6";
      ctx.beginPath();
      ctx.ellipse(lx, ly, 3.2, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Side fins behind the mantle (small triangles).
    ctx.fillStyle = "#4a2a9c";
    ctx.beginPath();
    ctx.moveTo(-mantleLen * 0.15, -mantleH * 0.9);
    ctx.quadraticCurveTo(-mantleLen * 0.55, -mantleH - 6, -mantleLen * 0.45, -mantleH * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-mantleLen * 0.15, mantleH * 0.9);
    ctx.quadraticCurveTo(-mantleLen * 0.55, mantleH + 6, -mantleLen * 0.45, mantleH * 0.6);
    ctx.closePath();
    ctx.fill();

    // Mantle (teardrop, pointed end forward-right).
    const mantleGrad = ctx.createLinearGradient(0, -mantleH, 0, mantleH);
    mantleGrad.addColorStop(0, "#c8aef5");
    mantleGrad.addColorStop(0.55, "#7c4fd6");
    mantleGrad.addColorStop(1, "#311766");
    ctx.fillStyle = mantleGrad;
    ctx.beginPath();
    ctx.moveTo(mantleLen, 0);
    ctx.bezierCurveTo(mantleLen * 0.6, -mantleH, -mantleLen * 0.3, -mantleH, -mantleLen * 0.4, 0);
    ctx.bezierCurveTo(-mantleLen * 0.3, mantleH, mantleLen * 0.6, mantleH, mantleLen, 0);
    ctx.closePath();
    ctx.fill();

    // Top-side glossy highlight.
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.ellipse(mantleLen * 0.1, -mantleH * 0.55, mantleLen * 0.45, mantleH * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();

    // Belly spots for character.
    ctx.fillStyle = "rgba(255, 210, 230, 0.45)";
    ctx.beginPath();
    ctx.arc(mantleLen * 0.1, mantleH * 0.5, 2.5, 0, Math.PI * 2);
    ctx.arc(-mantleLen * 0.15, mantleH * 0.45, 2, 0, Math.PI * 2);
    ctx.fill();

    // Two eyes.
    const eyeY = -mantleH * 0.15;
    for (const ex of [mantleLen * 0.4, mantleLen * 0.15]) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(ex, eyeY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0a0320";
      ctx.beginPath();
      ctx.arc(ex + 1, eyeY + 0.5, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(ex + 1.8, eyeY - 0.8, 1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Blush.
    ctx.fillStyle = "rgba(255, 150, 180, 0.4)";
    ctx.beginPath();
    ctx.ellipse(mantleLen * 0.3, mantleH * 0.25, 3.5, 1.8, 0, 0, Math.PI * 2);
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
      ctx.strokeText("Ink Squid", W / 2, H / 2 - 50);
      ctx.fillText("Ink Squid", W / 2, H / 2 - 50);
      ctx.font = "16px sans-serif";
      ctx.fillText("Click / Tap / Space to jet", W / 2, H / 2);
      ctx.fillText("Collect ink droplets!", W / 2, H / 2 + 24);
    } else if (state === STATE.DEAD) {
      ctx.font = "bold 40px sans-serif";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.strokeText("Caught!", W / 2, H / 2 - 70);
      ctx.fillText("Caught!", W / 2, H / 2 - 70);

      // Scorecard box.
      const bx = W / 2 - 110;
      const by = H / 2 - 30;
      ctx.fillStyle = "rgba(20, 10, 40, 0.85)";
      ctx.strokeStyle = "rgba(180,140,255,0.7)";
      ctx.lineWidth = 2;
      ctx.fillRect(bx, by, 220, 80);
      ctx.strokeRect(bx, by, 220, 80);
      ctx.fillStyle = "#fff";
      ctx.font = "16px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`Ink collected`, bx + 14, by + 32);
      ctx.fillText(`Best`, bx + 14, by + 60);
      ctx.textAlign = "right";
      ctx.fillText(String(score), bx + 206, by + 32);
      ctx.fillText(String(best), bx + 206, by + 60);

      ctx.textAlign = "center";
      ctx.font = "14px sans-serif";
      ctx.fillText("Click or press R to retry", W / 2, H / 2 + 80);
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
    if (!modal.classList.contains("hidden")) {
      if (e.key === "Enter") { e.preventDefault(); commitInitials(); }
      else if (e.key === "Escape") { e.preventDefault(); closeModal(); }
      return;
    }
    if (e.code === "Space" || e.code === "ArrowUp") {
      e.preventDefault();
      flap();
    } else if (e.key === "r" || e.key === "R") {
      reset();
    }
  });

  saveInitialsBtn.addEventListener("click", commitInitials);
  skipInitialsBtn.addEventListener("click", closeModal);
  initialsInput.addEventListener("input", () => {
    initialsInput.value = initialsInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
  });
  clearBoardBtn.addEventListener("click", () => {
    if (confirm("Clear the leaderboard?")) {
      saveLeaderboard([]);
      renderLeaderboard();
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
  renderLeaderboard();
  reset();
  loop();
})();
