// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Ink Squid Cannon
/// @notice Commit-reveal cannon game: player fires a bet, backend
///         resolver reveals the seed, contract rolls a continuous
///         distance value and pays `bet × distance / 10000` atomically
///         from its own balance.
///
///         `distanceBp` is the multiplier in basis points (10_000 =
///         1.00×). Client treats it as both the visual distance the
///         squid flies AND the payout multiplier — one number, one
///         outcome.
///
///         Distance distribution (7 bands, matching the chest game's
///         probability shape but with within-band variation so the
///         number feels continuous instead of stair-stepped):
///
///           Band 0 |  8.0%  | distanceBp = 0           (bust)
///           Band 1 | 15.0%  | 5500–7500   (0.55–0.75×)
///           Band 2 | 30.0%  | 8000–10000  (0.80–1.00×)
///           Band 3 | 30.0%  | 10000–11000 (1.00–1.10×)
///           Band 4 | 14.0%  | 11500–13000 (1.15–1.30×)
///           Band 5 |  2.5%  | 16000–22000 (1.60–2.20×)
///           Band 6 |  0.5%  | 40000–50000 (4.00–5.00×)
///
///         E[distanceBp / 10000] ≈ 0.93 → 93% RTP, structural 7% edge.
///
///         Rocks + creatures in the frontend are cosmetic — the single
///         on-chain distance is the source of truth. The client
///         animates a matching flight path (direct for most rolls,
///         bouncing for rolls that visually traverse creature zones,
///         splat-into-rock for band-0 busts).
contract InkSquidCannon is Ownable, ReentrancyGuard {
    address public resolver;
    uint256 public minBet;
    uint256 public maxBet;

    uint256 public nextRoundId = 1;

    // Distance scale: 10_000 distanceBp = 1.00× = 100m in the visual.
    // Max possible = 50_000 (5.00× = 500m). Keeps payout math simple:
    //   payout = bet × distanceBp / DISTANCE_SCALE
    uint32 public constant DISTANCE_SCALE = 10_000;
    uint32 public constant MAX_DISTANCE_BP = 50_000; // 5× cap

    struct Round {
        address player;
        bytes32 seedHash;
        uint128 betWei;
        uint64  playedAt;
        bool    settled;
    }
    mapping(uint256 => Round) public rounds;

    event ResolverRotated(address indexed previousResolver, address indexed newResolver);
    event BetBoundsUpdated(uint256 minBet, uint256 maxBet);
    event Played(uint256 indexed roundId, address indexed player, bytes32 seedHash, uint256 betWei);
    event Resolved(uint256 indexed roundId, address indexed player, uint256 betWei, uint32 distanceBp, uint256 payoutWei);
    event HouseWithdrawn(address indexed to, uint256 amount);
    event Funded(address indexed from, uint256 amount);

    error BetOutOfRange(uint256 min, uint256 max, uint256 sent);
    error UnknownRound(uint256 roundId);
    error AlreadySettled(uint256 roundId);
    error BadSeed(uint256 roundId);
    error NotResolver(address caller);
    error TransferFailed();
    error InsufficientLiquidity(uint256 needed, uint256 available);
    error ZeroAddress();

    constructor(address initialResolver, uint256 initialMinBet, uint256 initialMaxBet) Ownable(msg.sender) {
        if (initialResolver == address(0)) revert ZeroAddress();
        require(initialMinBet > 0 && initialMinBet <= initialMaxBet, "bad bounds");
        resolver = initialResolver;
        minBet = initialMinBet;
        maxBet = initialMaxBet;
        emit ResolverRotated(address(0), initialResolver);
        emit BetBoundsUpdated(initialMinBet, initialMaxBet);
    }

    function fire(bytes32 seedHash) external payable returns (uint256 roundId) {
        if (msg.value < minBet || msg.value > maxBet) {
            revert BetOutOfRange(minBet, maxBet, msg.value);
        }
        roundId = nextRoundId++;
        rounds[roundId] = Round({
            player:   msg.sender,
            seedHash: seedHash,
            betWei:   uint128(msg.value),
            playedAt: uint64(block.timestamp),
            settled:  false
        });
        emit Played(roundId, msg.sender, seedHash, msg.value);
    }

    function reveal(uint256 roundId, bytes32 seed) external nonReentrant {
        if (msg.sender != resolver) revert NotResolver(msg.sender);
        Round storage r = rounds[roundId];
        if (r.player == address(0)) revert UnknownRound(roundId);
        if (r.settled) revert AlreadySettled(roundId);
        if (keccak256(abi.encodePacked(seed)) != r.seedHash) revert BadSeed(roundId);

        uint32 distanceBp = _rollDistance(seed);
        uint256 payout = (uint256(r.betWei) * uint256(distanceBp)) / DISTANCE_SCALE;

        r.settled = true;

        if (payout > 0) {
            if (address(this).balance < payout) {
                revert InsufficientLiquidity(payout, address(this).balance);
            }
            (bool ok, ) = r.player.call{ value: payout }("");
            if (!ok) revert TransferFailed();
        }

        emit Resolved(roundId, r.player, r.betWei, distanceBp, payout);
    }

    /// @dev Rolls a continuous distance from the 93% RTP curve. Uses the
    ///      high bits of keccak256(seed || 0) for the band choice and
    ///      the low bits for within-band jitter, so the same committed
    ///      seed always yields the same distance.
    function _rollDistance(bytes32 seed) internal pure returns (uint32) {
        uint256 h = uint256(keccak256(abi.encodePacked(seed, uint256(0))));
        uint256 band   = h % 10_000;           // 0–9999
        uint256 jitter = (h >> 40) % 1_000;    // 0–999, independent bits

        // Cumulative band thresholds: 800, 2300, 5300, 8300, 9700, 9950, 10000
        if (band < 800)  return 0;                                           //  8.0% bust
        if (band < 2300) return uint32(5500  + (jitter * 2000) / 1000);      // 15.0% 5500–7500
        if (band < 5300) return uint32(8000  + (jitter * 2000) / 1000);      // 30.0% 8000–10000
        if (band < 8300) return uint32(10000 + (jitter * 1000) / 1000);      // 30.0% 10000–11000
        if (band < 9700) return uint32(11500 + (jitter * 1500) / 1000);      // 14.0% 11500–13000
        if (band < 9950) return uint32(16000 + (jitter * 6000) / 1000);      //  2.5% 16000–22000
        return uint32(40000 + (jitter * 10000) / 1000);                      //  0.5% 40000–50000
    }

    function setBetBounds(uint256 newMin, uint256 newMax) external onlyOwner {
        require(newMin > 0 && newMin <= newMax, "bad bounds");
        minBet = newMin;
        maxBet = newMax;
        emit BetBoundsUpdated(newMin, newMax);
    }

    function setResolver(address newResolver) external onlyOwner {
        if (newResolver == address(0)) revert ZeroAddress();
        emit ResolverRotated(resolver, newResolver);
        resolver = newResolver;
    }

    /// Owner pulls profit out. Reserves max single payout (5× maxBet)
    /// before allowing a withdraw so the next jackpot hit can settle.
    function withdrawHouse(address payable to, uint256 amount) external onlyOwner {
        uint256 reserve = maxBet * 5;
        if (address(this).balance < reserve + amount) {
            revert InsufficientLiquidity(reserve + amount, address(this).balance);
        }
        (bool ok, ) = to.call{ value: amount }("");
        if (!ok) revert TransferFailed();
        emit HouseWithdrawn(to, amount);
    }

    function fund() external payable onlyOwner {
        emit Funded(msg.sender, msg.value);
    }

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }
}
