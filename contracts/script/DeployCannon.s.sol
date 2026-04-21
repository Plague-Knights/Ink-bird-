// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { InkSquidCannon } from "../src/InkSquidCannon.sol";

/// Deploys InkSquidCannon (continuous distance = multiplier, 93% RTP,
/// 5× cap) and funds it with enough float to cover a jackpot on play 1.
///
/// Usage:
///   RESOLVER=0x... \
///   forge script script/DeployCannon.s.sol:DeployCannon \
///     --rpc-url ink_sepolia --broadcast \
///     --private-key $DEPLOYER_PRIVATE_KEY
contract DeployCannon is Script {
    function run() external {
        address resolver = vm.envAddress("RESOLVER");
        uint256 minBet = 0.0001 ether;   // same bounds as chests so
        uint256 maxBet = 0.01 ether;     // bet-size UX stays identical
        // Seed float: ideally 5× maxBet (one full jackpot). Override
        // via env when the deployer EOA is low on a specific chain.
        uint256 seedFloat = vm.envOr("SEED_FLOAT", uint256(0.05 ether));

        vm.startBroadcast();
        InkSquidCannon game = new InkSquidCannon(resolver, minBet, maxBet);
        game.fund{ value: seedFloat }();
        vm.stopBroadcast();

        console2.log("InkSquidCannon deployed at", address(game));
        console2.log("minBet (wei)", minBet);
        console2.log("maxBet (wei)", maxBet);
        console2.log("Resolver", resolver);
        console2.log("Seeded float (wei)", seedFloat);
    }
}
