const hre = require("hardhat");

async function main() {
  const treasury = process.env.TREASURY_ADDRESS || "0xA35d18dc0B579a4e7f05cEf6847975572843a6F1";
  const operator = process.env.OPERATOR_ADDRESS;
  if (!operator) throw new Error("OPERATOR_ADDRESS env var required");
  if (!hre.ethers.isAddress(treasury)) throw new Error("invalid treasury");
  if (!hre.ethers.isAddress(operator)) throw new Error("invalid operator");

  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  console.log(`deployer:  ${deployer.address}`);
  console.log(`network:   ${network.name} (chainId ${network.chainId})`);
  console.log(`treasury:  ${treasury}`);
  console.log(`operator:  ${operator}`);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`balance:   ${hre.ethers.formatEther(balance)} ETH`);

  console.log("\nDeploying InkBirdArcade...");
  const Arcade = await hre.ethers.getContractFactory("InkBirdArcade");
  const arcade = await Arcade.deploy(treasury, operator);
  await arcade.waitForDeployment();
  const addr = await arcade.getAddress();
  console.log(`deployed:  ${addr}`);
  console.log(`tx:        ${arcade.deploymentTransaction().hash}`);
  console.log(`\nSet ARCADE_ADDRESS=${addr} in backend and frontend config.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
