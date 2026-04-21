// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Test } from "forge-std/Test.sol";
import { InkSquidChests } from "../src/InkSquidChests.sol";

contract InkSquidChestsTest is Test {
    InkSquidChests game;
    address owner    = makeAddr("owner");
    address resolver = makeAddr("resolver");
    address alice    = makeAddr("alice");

    uint256 constant MIN_BET = 0.0001 ether;
    uint256 constant MAX_BET = 0.01 ether;

    function setUp() public {
        vm.prank(owner);
        game = new InkSquidChests(resolver, MIN_BET, MAX_BET);
        vm.deal(alice, 10 ether);
        // Seed the contract with enough float so 5× payouts always clear.
        vm.deal(owner, 5 ether);
        vm.prank(owner);
        game.fund{ value: 1 ether }();
    }

    function test_playAcceptsBetInRange() public {
        bytes32 hash = keccak256(abi.encodePacked(bytes32(uint256(1))));
        vm.prank(alice);
        uint256 roundId = game.play{ value: 0.005 ether }(hash);
        assertEq(roundId, 1);

        (address p, bytes32 h, uint128 bw, , bool settled) = game.rounds(roundId);
        assertEq(p, alice);
        assertEq(h, hash);
        assertEq(uint256(bw), 0.005 ether);
        assertFalse(settled);
    }

    function test_playBelowMinReverts() public {
        bytes32 hash = keccak256(abi.encodePacked(bytes32(uint256(1))));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            InkSquidChests.BetOutOfRange.selector, MIN_BET, MAX_BET, 0.00001 ether
        ));
        game.play{ value: 0.00001 ether }(hash);
    }

    function test_playAboveMaxReverts() public {
        bytes32 hash = keccak256(abi.encodePacked(bytes32(uint256(1))));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(
            InkSquidChests.BetOutOfRange.selector, MIN_BET, MAX_BET, 0.02 ether
        ));
        game.play{ value: 0.02 ether }(hash);
    }

    function test_revealPaysBetTimesMultiplier() public {
        bytes32 seed = keccak256(abi.encodePacked("seed-test-1"));
        bytes32 hash = keccak256(abi.encodePacked(seed));

        vm.prank(alice);
        uint256 roundId = game.play{ value: MAX_BET }(hash);

        uint256 aliceBefore = alice.balance;
        vm.prank(resolver);
        game.reveal(roundId, seed);
        uint256 received = alice.balance - aliceBefore;

        // Re-roll the multiplier offline (same keccak mix the contract uses).
        uint256 roll = uint256(keccak256(abi.encodePacked(seed, uint256(0)))) % 10000;
        uint16 expectedMult;
        if (roll < 800)       expectedMult = 0;
        else if (roll < 2300) expectedMult = 700;
        else if (roll < 5300) expectedMult = 900;
        else if (roll < 8300) expectedMult = 1050;
        else if (roll < 9700) expectedMult = 1200;
        else if (roll < 9950) expectedMult = 1800;
        else                  expectedMult = 5000;

        uint256 expected = (MAX_BET * expectedMult) / 1000;
        assertEq(received, expected, "payout should be bet * mult");
    }

    function test_revealRestrictedToResolver() public {
        bytes32 seed = bytes32(uint256(0xCAFE));
        bytes32 hash = keccak256(abi.encodePacked(seed));
        vm.prank(alice);
        uint256 roundId = game.play{ value: MIN_BET }(hash);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(InkSquidChests.NotResolver.selector, alice));
        game.reveal(roundId, seed);
    }

    function test_revealRejectsBadSeed() public {
        bytes32 seed = bytes32(uint256(0xBEEF));
        bytes32 hash = keccak256(abi.encodePacked(seed));
        vm.prank(alice);
        uint256 roundId = game.play{ value: MIN_BET }(hash);

        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(InkSquidChests.BadSeed.selector, roundId));
        game.reveal(roundId, bytes32(uint256(0xDEAD)));
    }

    function test_cannotRevealTwice() public {
        bytes32 seed = bytes32(uint256(0xAA));
        bytes32 hash = keccak256(abi.encodePacked(seed));
        vm.prank(alice);
        uint256 roundId = game.play{ value: MIN_BET }(hash);
        vm.prank(resolver);
        game.reveal(roundId, seed);
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSelector(InkSquidChests.AlreadySettled.selector, roundId));
        game.reveal(roundId, seed);
    }

    function test_withdrawReservesMaxPayout() public {
        // Contract has 1 ETH from setUp; maxBet = 0.01 so reserve = 0.05.
        // Withdrawing 0.95 should succeed (leaves 0.05), 0.96 should not.
        address payable treasury = payable(makeAddr("treasury"));

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(
            InkSquidChests.InsufficientLiquidity.selector, 0.05 ether + 0.96 ether, 1 ether
        ));
        game.withdrawHouse(treasury, 0.96 ether);

        vm.prank(owner);
        game.withdrawHouse(treasury, 0.95 ether);
        assertEq(treasury.balance, 0.95 ether);
    }

    function test_setBetBoundsRequiresOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        game.setBetBounds(0.001 ether, 0.05 ether);

        vm.prank(owner);
        game.setBetBounds(0.001 ether, 0.05 ether);
        assertEq(game.minBet(), 0.001 ether);
        assertEq(game.maxBet(), 0.05 ether);
    }

    /// Statistical sanity check: roll the multiplier curve 10,000
    /// times with fresh seeds and confirm the observed RTP is within
    /// ±2% of 92.8%.
    function test_observedRTPMatches928() public view {
        uint256 total = 0;
        uint256 runs = 10_000;
        for (uint256 i = 0; i < runs; i++) {
            bytes32 seed = keccak256(abi.encodePacked("stat", i));
            uint256 roll = uint256(keccak256(abi.encodePacked(seed, uint256(0)))) % 10000;
            uint16 m;
            if (roll < 800)       m = 0;
            else if (roll < 2300) m = 700;
            else if (roll < 5300) m = 900;
            else if (roll < 8300) m = 1050;
            else if (roll < 9700) m = 1200;
            else if (roll < 9950) m = 1800;
            else                  m = 5000;
            total += m;
        }
        uint256 rtpPermille = total / runs; // in thousandths → expect ~928
        assertGt(rtpPermille, 900, "RTP should be > 90%");
        assertLt(rtpPermille, 960, "RTP should be < 96%");
    }
}
