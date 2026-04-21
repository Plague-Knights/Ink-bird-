// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Ink Squid Chests (v2 — Moonsheep-style)
/// @notice Variable-bet auto-flapper gambling. Player picks any bet in
///         `[minBet, maxBet]`, commits to a seed hash via `play`. The
///         backend resolver reveals the seed on-chain; the contract
///         rolls a multiplier from a fixed 92.8% RTP curve and pays
///         `bet × multiplier` atomically from the contract's balance.
///
///         No weekly pool, no rebate fund, no chest cap — per play is
///         self-funding. House edge is 7.2% in expectation, structural.
///         Contract balance = house float + profit over time.
///
///         Multiplier curve (7 buckets, sums to 100%):
///           8.0%  → 0.00×   (bust)
///          15.0%  → 0.70×   (loss)
///          30.0%  → 0.90×   (near-miss)
///          30.0%  → 1.05×   (small win)
///          14.0%  → 1.20×   (solid win)
///           2.5%  → 1.80×   (big win)
///           0.5%  → 5.00×   (jackpot)
///         E[multiplier] = 0.928 → 92.8% RTP
///
///         Per-chest animation in the frontend is purely cosmetic.
///         The single on-chain multiplier is the source of truth.
contract InkSquidChests is Ownable, ReentrancyGuard {
    address public resolver;
    uint256 public minBet;
    uint256 public maxBet;

    uint256 public nextRoundId = 1;

    // Multiplier expressed in thousandths (so 1000 = 1.00×).
    uint16 public constant MULT_SCALE = 1000;

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
    event Resolved(uint256 indexed roundId, address indexed player, uint256 betWei, uint16 multiplierThousandths, uint256 payoutWei);
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

    function play(bytes32 seedHash) external payable returns (uint256 roundId) {
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

        uint16 mult = _rollMultiplier(seed);
        uint256 payout = (uint256(r.betWei) * uint256(mult)) / MULT_SCALE;

        r.settled = true;

        if (payout > 0) {
            if (address(this).balance < payout) {
                revert InsufficientLiquidity(payout, address(this).balance);
            }
            (bool ok, ) = r.player.call{ value: payout }("");
            if (!ok) revert TransferFailed();
        }

        emit Resolved(roundId, r.player, r.betWei, mult, payout);
    }

    /// @dev Rolls a multiplier from the 92.8% RTP curve using
    ///      keccak256(seed || 0) mod 10000. Pure function of the
    ///      committed seed — same seed always yields the same multiplier.
    function _rollMultiplier(bytes32 seed) internal pure returns (uint16) {
        uint256 roll = uint256(keccak256(abi.encodePacked(seed, uint256(0)))) % 10000;
        // Cumulative thresholds: 800, 2300, 5300, 8300, 9700, 9950, 10000
        if (roll < 800)  return 0;      //  8.0%  bust
        if (roll < 2300) return 700;    // 15.0%  loss
        if (roll < 5300) return 900;    // 30.0%  near-miss
        if (roll < 8300) return 1050;   // 30.0%  small win
        if (roll < 9700) return 1200;   // 14.0%  solid win
        if (roll < 9950) return 1800;   //  2.5%  big win
        return 5000;                    //  0.5%  jackpot
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

    /// Owner pulls profit out. Reserves max-single-payout (5× maxBet)
    /// before allowing a withdraw so the next jackpot hit doesn't
    /// revert on the player.
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
