const INK_MAINNET = {
  chainId: "0xDEF1",
  chainName: "Ink",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc-gel.inkonchain.com"],
  blockExplorerUrls: ["https://explorer.inkonchain.com"],
};

const ABI = [
  "function claim(uint256 weekId, uint256 amount, bytes32[] proof)",
  "function claimed(uint256, address) view returns (bool)",
  "function weekSettledAt(uint256) view returns (uint256)",
  "function CLAIM_TIMELOCK() view returns (uint256)",
];

let BACKEND = "";
let ARCADE = "";
let EXPLORER = "https://explorer.inkonchain.com";

async function loadConfig() {
  try {
    const res = await fetch("./config.json", { cache: "no-store" });
    if (res.ok) {
      const j = await res.json();
      BACKEND = j.backendUrl || "";
      ARCADE = j.arcadeAddress || "";
      EXPLORER = j.explorerUrl || EXPLORER;
    }
  } catch {}
}

function loadEthers() {
  return new Promise((resolve, reject) => {
    if (window.ethers) return resolve(window.ethers);
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/ethers@6.13.2/dist/ethers.umd.min.js";
    s.onload = () => resolve(window.ethers);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

const connectBtn = document.getElementById("connectWallet");
const addrEl = document.getElementById("walletAddress");
const lookupBtn = document.getElementById("lookupBtn");
const weekInput = document.getElementById("weekInput");
const resultEl = document.getElementById("result");

let account = null;
let provider = null;
let signer = null;

async function connect() {
  if (!window.ethereum) throw new Error("No wallet found.");
  const ethers = await loadEthers();
  await window.ethereum.request({ method: "eth_requestAccounts" });
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: INK_MAINNET.chainId }] });
  } catch (e) {
    if (e.code === 4902) {
      await window.ethereum.request({ method: "wallet_addEthereumChain", params: [INK_MAINNET] });
    } else throw e;
  }
  provider = new ethers.BrowserProvider(window.ethereum);
  signer = await provider.getSigner();
  account = await signer.getAddress();
  addrEl.textContent = `${account.slice(0, 6)}…${account.slice(-4)}`;
  addrEl.classList.remove("muted");
  connectBtn.textContent = "Connected";
  connectBtn.disabled = true;
  lookupBtn.disabled = false;
}

function fmtEth(wei) {
  const n = BigInt(wei);
  const whole = n / 10n ** 18n;
  const frac = (n % 10n ** 18n).toString().padStart(18, "0").slice(0, 6);
  return `${whole}.${frac}`;
}

async function lookup() {
  resultEl.textContent = "";
  const weekId = Number(weekInput.value);
  if (!Number.isFinite(weekId) || weekId < 0) {
    resultEl.innerHTML = `<p class="err">Invalid week ID.</p>`;
    return;
  }
  if (!BACKEND) {
    resultEl.innerHTML = `<p class="err">Backend not configured.</p>`;
    return;
  }
  try {
    const res = await fetch(`${BACKEND}/api/claim/${weekId}/${account}`);
    if (res.status === 404) {
      resultEl.innerHTML = `<p class="err">Week ${weekId} not settled yet.</p>`;
      return;
    }
    if (!res.ok) throw new Error(`lookup failed (${res.status})`);
    const j = await res.json();
    if (!j.entry) {
      resultEl.innerHTML = `<p>No prize recorded for ${account.slice(0, 6)}… in week ${weekId}.</p>`;
      return;
    }
    const { rank, amount, proof } = j.entry;

    const ethers = await loadEthers();
    const contract = new ethers.Contract(ARCADE, ABI, provider);
    const already = await contract.claimed(weekId, account);
    const settledAt = await contract.weekSettledAt(weekId);
    const timelock = await contract.CLAIM_TIMELOCK();
    const unlockAt = Number(settledAt) + Number(timelock);
    const now = Math.floor(Date.now() / 1000);
    const locked = now < unlockAt;

    resultEl.innerHTML = `
      <div class="claim-box">
        <div>Rank: <strong>#${rank}</strong></div>
        <div>Amount: <strong>${fmtEth(amount)} ETH</strong></div>
        <div>Status: <strong>${already ? "already claimed" : locked ? `timelocked until ${new Date(unlockAt * 1000).toLocaleString()}` : "ready to claim"}</strong></div>
        <button id="claimBtn" ${already || locked ? "disabled" : ""}>Claim on-chain</button>
      </div>
    `;
    if (!already && !locked) {
      document.getElementById("claimBtn").addEventListener("click", async () => {
        try {
          const c = new ethers.Contract(ARCADE, ABI, signer);
          const tx = await c.claim(weekId, amount, proof);
          resultEl.innerHTML += `<p>Submitted: <a href="${EXPLORER}/tx/${tx.hash}" target="_blank">${tx.hash.slice(0, 10)}…</a></p>`;
          await tx.wait();
          resultEl.innerHTML += `<p><strong>Claimed successfully.</strong></p>`;
        } catch (e) {
          resultEl.innerHTML += `<p class="err">Claim failed: ${e.shortMessage || e.message}</p>`;
        }
      });
    }
  } catch (e) {
    resultEl.innerHTML = `<p class="err">${e.message}</p>`;
  }
}

connectBtn.addEventListener("click", () => connect().catch((e) => alert(e.message)));
lookupBtn.addEventListener("click", lookup);

loadConfig();
