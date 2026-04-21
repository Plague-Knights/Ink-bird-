// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { Script, console2 } from "forge-std/Script.sol";
import { InkSquidChests } from "../src/InkSquidChests.sol";

/// Deploys InkSquidChests (variable-bet, 92.8% RTP) and funds the
/// contract with enough float to cover max-payout hits from day one.
///
/// Usage:
///   RESOLVER=0x... \
///   forge script script/DeployChests.s.sol:DeployChests \
///     --rpc-url ink_sepolia --broadcast \
///     --private-key $DEPLOYER_PRIVATE_KEY
contract DeployChests is Script {
    function run() external {
        address resolver = vm.envAddress("RESOLVER");
        uint256 minBet = 0.0001 ether;   // ~$0.30 at $3000/ETH
        uint256 maxBet = 0.01 ether;     // ~$30   at $3000/ETH
        // Seed float: ideally 5× maxBet (covers a jackpot on play 1).
        // SEED_FLOAT env can override when the deployer EOA is short
        // on gas on a specific chain.
        uint256 seedFloat = vm.envOr("SEED_FLOAT", uint256(0.05 ether));

        vm.startBroadcast();
        InkSquidChests game = new InkSquidChests(resolver, minBet, maxBet);
        game.fund{ value: seedFloat }();
        vm.stopBroadcast();

        console2.log("InkSquidChests v2 deployed at", address(game));
        console2.log("minBet (wei)", minBet);
        console2.log("maxBet (wei)", maxBet);
        console2.log("Resolver", resolver);
        console2.log("Seeded float (wei)", seedFloat);
    }
}
