// Connects the arcade-bar buttons to window.inkArcade.
(() => {
  const connectBtn = document.getElementById("connectWallet");
  const buyBtn = document.getElementById("buyEntry");
  const runBtn = document.getElementById("startRun");
  const addrEl = document.getElementById("walletAddress");
  const creditsEl = document.getElementById("creditBalance");
  const weekEl = document.getElementById("weekId");
  const poolEl = document.getElementById("poolAmount");

  function fmtEth(wei) {
    if (wei == null) return "0";
    const n = typeof wei === "bigint" ? wei : BigInt(wei);
    const whole = n / 10n ** 18n;
    const frac = n % 10n ** 18n;
    const fracStr = frac.toString().padStart(18, "0").slice(0, 4);
    return `${whole}.${fracStr}`;
  }

  function render(s) {
    addrEl.textContent = s.account ? `${s.account.slice(0, 6)}…${s.account.slice(-4)}` : "not connected";
    addrEl.classList.toggle("muted", !s.account);
    creditsEl.textContent = s.credits || 0;
    weekEl.textContent = s.weekId ?? "—";
    poolEl.textContent = fmtEth(s.pool);
    connectBtn.textContent = s.account ? "Connected" : "Connect Wallet";
    connectBtn.disabled = !!s.account;
    buyBtn.disabled = !s.account;
    runBtn.disabled = !s.account || s.credits <= 0 || !!s.session;
  }

  async function waitForArcade() {
    while (!window.inkArcade) await new Promise((r) => setTimeout(r, 50));
    return window.inkArcade;
  }

  waitForArcade().then((arcade) => {
    arcade.onChange = render;
    render(arcade.state);
    connectBtn.addEventListener("click", async () => {
      try { await arcade.connect(); } catch (e) { alert(e.message); }
    });
    buyBtn.addEventListener("click", async () => {
      buyBtn.disabled = true;
      buyBtn.textContent = "Confirm in wallet…";
      try {
        await arcade.buyEntry();
        buyBtn.textContent = "Pay 0.001 ETH · +100";
      } catch (e) {
        alert(e.message);
        buyBtn.textContent = "Pay 0.001 ETH · +100";
      } finally {
        buyBtn.disabled = !arcade.state.account;
      }
    });
    runBtn.addEventListener("click", async () => {
      runBtn.disabled = true;
      try {
        await arcade.startSession();
        // Nudge the game to restart fresh with the new seed.
        window.dispatchEvent(new CustomEvent("inkarcade:session"));
      } catch (e) {
        alert(e.message);
        runBtn.disabled = false;
      }
    });
  });
})();
