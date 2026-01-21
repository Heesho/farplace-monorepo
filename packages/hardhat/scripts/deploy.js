const { ethers } = require("hardhat");
const hre = require("hardhat");

// Constants
const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;

// =============================================================================
// CONFIGURATION - UPDATE THESE FOR YOUR DEPLOYMENT
// =============================================================================

// Base Mainnet addresses
const USDC_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Real USDC on Base
const DONUT_MAINNET = "0xae4a37d554c6d6f3e398546d8566b25052e0169c"; // Real DONUT on Base

// Mock Token addresses (for staging/testing on mainnet)
const MOCK_USDC = "0xe90495BE187d434e23A9B1FeC0B6Ce039700870e"; // Mock USDC for testing
const MOCK_DONUT = "0xD50B69581362C60Ce39596B237C71e07Fc4F6fdA"; // Mock DONUT for testing

// Toggle between mock and mainnet tokens
const USDC_ADDRESS = MOCK_USDC; // Switch to USDC_MAINNET for production
const DONUT_ADDRESS = MOCK_DONUT; // Switch to DONUT_MAINNET for production

const UNISWAP_V2_FACTORY = "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6";
const UNISWAP_V2_ROUTER = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24";
const ENTROPY_ADDRESS = "0x6e7d74fa7d5c90fef9f0512987605a6d546181bb"; // Pyth Entropy on Base

// Protocol settings
const PROTOCOL_FEE_ADDRESS = "0xbA366c82815983fF130C23CED78bD95E1F2c18EA"; // TODO: Set protocol fee recipient
const MULTISIG_ADDRESS = "0xeE0CB49D2805DA6bC0A979ddAd87bb793fbB765E";
const MIN_DONUT_FOR_LAUNCH = convert("1000", 18); // 1000 DONUT minimum

// Deployed Contract Addresses (paste after deployment)
const REGISTRY = ""; // Deploy first, then paste address here
const UNIT_FACTORY = "0xD7980Db9048d4d7411D8f3d236f200aE1519E3cc";
const RIG_FACTORY = "0xCcC0eb8E2809F0D03CBA12E3E0687298A2022fbd";
const AUCTION_FACTORY = "0x9F7dddaCF5f82d6A0D010584f06Bc1243E74DbE6";
const CORE = "0xF837F616Fe1fd33Cd8290759D3ae1FB09230d73b";
const MULTICALL = "0x9EEbEe08C3823290E7A17F27D4c644380E978cA8";

// Contract Variables
let usdc, donut, registry, unitFactory, rigFactory, auctionFactory, core, multicall;

// =============================================================================
// GET CONTRACTS
// =============================================================================

async function getContracts() {
  usdc = await ethers.getContractAt(
    "contracts/mocks/MockUSDC.sol:MockUSDC",
    USDC_ADDRESS
  );

  donut = await ethers.getContractAt(
    "contracts/mocks/MockDONUT.sol:MockDONUT",
    DONUT_ADDRESS
  );

  if (REGISTRY) {
    registry = await ethers.getContractAt(
      "contracts/Registry.sol:Registry",
      REGISTRY
    );
  }

  if (UNIT_FACTORY) {
    unitFactory = await ethers.getContractAt(
      "contracts/UnitFactory.sol:UnitFactory",
      UNIT_FACTORY
    );
  }

  if (RIG_FACTORY) {
    rigFactory = await ethers.getContractAt(
      "contracts/MineRigFactory.sol:MineRigFactory",
      RIG_FACTORY
    );
  }

  if (AUCTION_FACTORY) {
    auctionFactory = await ethers.getContractAt(
      "contracts/AuctionFactory.sol:AuctionFactory",
      AUCTION_FACTORY
    );
  }

  if (CORE) {
    core = await ethers.getContractAt("contracts/rigs/mine/MineCore.sol:MineCore", CORE);
  }

  if (MULTICALL) {
    multicall = await ethers.getContractAt(
      "contracts/Multicall.sol:Multicall",
      MULTICALL
    );
  }

  console.log("Contracts Retrieved");
}

// =============================================================================
// DEPLOY FUNCTIONS
// =============================================================================

async function deployRegistry() {
  console.log("Starting Registry Deployment");
  const artifact = await ethers.getContractFactory("Registry");
  const contract = await artifact.deploy({ gasPrice: ethers.gasPrice });
  registry = await contract.deployed();
  await sleep(5000);
  console.log("Registry Deployed at:", registry.address);
}

async function deployUnitFactory() {
  console.log("Starting UnitFactory Deployment");
  const artifact = await ethers.getContractFactory("UnitFactory");
  const contract = await artifact.deploy({ gasPrice: ethers.gasPrice });
  unitFactory = await contract.deployed();
  await sleep(5000);
  console.log("UnitFactory Deployed at:", unitFactory.address);
}

async function deployMineRigFactory() {
  console.log("Starting MineRigFactory Deployment");
  const artifact = await ethers.getContractFactory("MineRigFactory");
  const contract = await artifact.deploy({ gasPrice: ethers.gasPrice });
  rigFactory = await contract.deployed();
  await sleep(5000);
  console.log("MineRigFactory Deployed at:", rigFactory.address);
}

async function deployAuctionFactory() {
  console.log("Starting AuctionFactory Deployment");
  const artifact = await ethers.getContractFactory("AuctionFactory");
  const contract = await artifact.deploy({ gasPrice: ethers.gasPrice });
  auctionFactory = await contract.deployed();
  await sleep(5000);
  console.log("AuctionFactory Deployed at:", auctionFactory.address);
}

async function deployCore() {
  console.log("Starting Core Deployment");

  if (!PROTOCOL_FEE_ADDRESS) {
    throw new Error("PROTOCOL_FEE_ADDRESS must be set before deployment");
  }
  if (!DONUT_ADDRESS) {
    throw new Error("DONUT_ADDRESS must be set before deployment");
  }
  if (!registry?.address && !REGISTRY) {
    throw new Error("Registry must be deployed before Core");
  }

  const registryAddress = registry?.address || REGISTRY;

  const artifact = await ethers.getContractFactory("MineCore");
  const contract = await artifact.deploy(
    registryAddress,
    DONUT_ADDRESS,
    UNISWAP_V2_FACTORY,
    UNISWAP_V2_ROUTER,
    unitFactory.address,
    rigFactory.address,
    auctionFactory.address,
    ENTROPY_ADDRESS,
    PROTOCOL_FEE_ADDRESS,
    MIN_DONUT_FOR_LAUNCH,
    { gasPrice: ethers.gasPrice }
  );
  core = await contract.deployed();
  await sleep(5000);
  console.log("Core Deployed at:", core.address);
}

async function approveCore() {
  console.log("Approving Core as factory in Registry...");
  const coreAddress = core?.address || CORE;
  const tx = await registry.setFactoryApproval(coreAddress, true);
  await tx.wait();
  console.log("Core approved in Registry");
}

async function deployMulticall() {
  console.log("Starting Multicall Deployment");
  const artifact = await ethers.getContractFactory("Multicall");
  const contract = await artifact.deploy(core.address, DONUT_ADDRESS, {
    gasPrice: ethers.gasPrice,
  });
  multicall = await contract.deployed();
  await sleep(5000);
  console.log("Multicall Deployed at:", multicall.address);
}

// =============================================================================
// VERIFY FUNCTIONS
// =============================================================================

async function verifyRegistry() {
  console.log("Starting Registry Verification");
  await hre.run("verify:verify", {
    address: registry?.address || REGISTRY,
    contract: "contracts/Registry.sol:Registry",
    constructorArguments: [],
  });
  console.log("Registry Verified");
}

async function verifyUnitFactory() {
  console.log("Starting UnitFactory Verification");
  await hre.run("verify:verify", {
    address: unitFactory?.address || UNIT_FACTORY,
    contract: "contracts/UnitFactory.sol:UnitFactory",
    constructorArguments: [],
  });
  console.log("UnitFactory Verified");
}

async function verifyMineRigFactory() {
  console.log("Starting MineRigFactory Verification");
  await hre.run("verify:verify", {
    address: rigFactory?.address || RIG_FACTORY,
    contract: "contracts/MineRigFactory.sol:MineRigFactory",
    constructorArguments: [],
  });
  console.log("MineRigFactory Verified");
}

async function verifyAuctionFactory() {
  console.log("Starting AuctionFactory Verification");
  await hre.run("verify:verify", {
    address: auctionFactory?.address || AUCTION_FACTORY,
    contract: "contracts/AuctionFactory.sol:AuctionFactory",
    constructorArguments: [],
  });
  console.log("AuctionFactory Verified");
}

async function verifyCore() {
  console.log("Starting Core Verification");
  await hre.run("verify:verify", {
    address: core?.address || CORE,
    contract: "contracts/rigs/mine/MineCore.sol:MineCore",
    constructorArguments: [
      registry?.address || REGISTRY,
      DONUT_ADDRESS,
      UNISWAP_V2_FACTORY,
      UNISWAP_V2_ROUTER,
      unitFactory?.address || UNIT_FACTORY,
      rigFactory?.address || RIG_FACTORY,
      auctionFactory?.address || AUCTION_FACTORY,
      ENTROPY_ADDRESS,
      PROTOCOL_FEE_ADDRESS,
      MIN_DONUT_FOR_LAUNCH,
    ],
  });
  console.log("Core Verified");
}

async function verifyMulticall() {
  console.log("Starting Multicall Verification");
  await hre.run("verify:verify", {
    address: multicall?.address || MULTICALL,
    contract: "contracts/Multicall.sol:Multicall",
    constructorArguments: [core?.address || CORE, DONUT_ADDRESS],
  });
  console.log("Multicall Verified");
}

async function verifyUnitByRigIndex(rigIndex) {
  const rigAddress = await core.deployedRigs(rigIndex);
  const unitAddress = await core.rigToUnit(rigAddress);
  const unit = await ethers.getContractAt(
    "contracts/Unit.sol:Unit",
    unitAddress
  );

  const name = await unit.name();
  const symbol = await unit.symbol();

  console.log("Starting Unit Verification for:", unitAddress);
  console.log("  Name:", name);
  console.log("  Symbol:", symbol);

  await hre.run("verify:verify", {
    address: unitAddress,
    contract: "contracts/Unit.sol:Unit",
    constructorArguments: [name, symbol],
  });
  console.log("Unit Verified:", unitAddress);
}

async function getUnitVerificationInfo(rigIndex) {
  const rigAddress = await core.deployedRigs(rigIndex);
  const unitAddress = await core.rigToUnit(rigAddress);
  const unit = await ethers.getContractAt(
    "contracts/Unit.sol:Unit",
    unitAddress
  );

  const name = await unit.name();
  const symbol = await unit.symbol();

  // ABI encode the constructor arguments
  const abiCoder = new ethers.utils.AbiCoder();
  const encodedArgs = abiCoder.encode(["string", "string"], [name, symbol]);
  // Remove '0x' prefix for BaseScan
  const encodedArgsNoPrefix = encodedArgs.slice(2);

  console.log("\n=== Unit Verification Info ===\n");
  console.log("Unit Address:", unitAddress);
  console.log("Name:", name);
  console.log("Symbol:", symbol);
  console.log("\nABI-Encoded Constructor Arguments (for BaseScan):");
  console.log(encodedArgsNoPrefix);
  console.log("\n==============================\n");

  return { unitAddress, name, symbol, encodedArgs: encodedArgsNoPrefix };
}

async function verifyRigByIndex(rigIndex) {
  const rigAddress = await core.deployedRigs(rigIndex);
  const rig = await ethers.getContractAt("contracts/rigs/mine/MineRig.sol:MineRig", rigAddress);

  // Read all constructor args from the deployed contract
  const unitAddress = await rig.unit();
  const quoteAddress = await rig.quote();
  const entropyAddress = await rig.entropy();
  const protocolAddress = await rig.protocol();
  const treasury = await rig.treasury();

  // Config struct fields
  const epochPeriod = await rig.epochPeriod();
  const priceMultiplier = await rig.priceMultiplier();
  const minInitPrice = await rig.minInitPrice();
  const initialUps = await rig.initialUps();
  const halvingAmount = await rig.halvingAmount();
  const tailUps = await rig.tailUps();

  console.log("Starting Rig Verification for:", rigAddress);
  console.log("  Unit:", unitAddress);
  console.log("  Quote:", quoteAddress);
  console.log("  Entropy:", entropyAddress);
  console.log("  Protocol:", protocolAddress);
  console.log("  Treasury:", treasury);
  console.log("  Config:");
  console.log("    Epoch Period:", epochPeriod.toString());
  console.log("    Price Multiplier:", priceMultiplier.toString());
  console.log("    Min Init Price:", minInitPrice.toString());
  console.log("    Initial UPS:", initialUps.toString());
  console.log("    Halving Amount:", halvingAmount.toString());
  console.log("    Tail UPS:", tailUps.toString());

  await hre.run("verify:verify", {
    address: rigAddress,
    contract: "contracts/rigs/mine/MineRig.sol:MineRig",
    constructorArguments: [
      unitAddress,
      quoteAddress,
      entropyAddress,
      protocolAddress,
      treasury,
      {
        epochPeriod: epochPeriod,
        priceMultiplier: priceMultiplier,
        minInitPrice: minInitPrice,
        initialUps: initialUps,
        halvingAmount: halvingAmount,
        tailUps: tailUps,
      },
    ],
  });
  console.log("Rig Verified:", rigAddress);
}

async function verifyAuctionByRigIndex(rigIndex) {
  const rigAddress = await core.deployedRigs(rigIndex);
  const auctionAddress = await core.rigToAuction(rigAddress);
  const auction = await ethers.getContractAt(
    "contracts/Auction.sol:Auction",
    auctionAddress
  );

  // Read constructor args from the deployed contract
  const paymentToken = await auction.paymentToken();
  const paymentReceiver = await auction.paymentReceiver();
  const epochPeriod = await auction.epochPeriod();
  const priceMultiplier = await auction.priceMultiplier();
  const minInitPrice = await auction.minInitPrice();

  // Read current initPrice - this equals the constructor arg if epochId is still 0
  // If someone has already bought, you may need to pass the original initPrice manually
  const epochId = await auction.epochId();
  const currentInitPrice = await auction.initPrice();
  const initPrice = epochId.eq(0) ? currentInitPrice : minInitPrice;

  if (!epochId.eq(0)) {
    console.log(
      "  WARNING: Auction has been used (epochId > 0). Using minInitPrice as initPrice."
    );
    console.log(
      "  If verification fails, you may need to find the original auctionInitPrice from launch event."
    );
  }

  console.log("Starting Auction Verification for:", auctionAddress);
  console.log("  Init Price:", initPrice.toString());
  console.log("  Payment Token:", paymentToken);
  console.log("  Payment Receiver:", paymentReceiver);
  console.log("  Epoch Period:", epochPeriod.toString());
  console.log("  Price Multiplier:", priceMultiplier.toString());
  console.log("  Min Init Price:", minInitPrice.toString());

  await hre.run("verify:verify", {
    address: auctionAddress,
    contract: "contracts/Auction.sol:Auction",
    constructorArguments: [
      initPrice,
      paymentToken,
      paymentReceiver,
      epochPeriod,
      priceMultiplier,
      minInitPrice,
    ],
  });
  console.log("Auction Verified:", auctionAddress);
}

// =============================================================================
// CONFIGURATION FUNCTIONS
// =============================================================================

async function setProtocolFeeAddress(newAddress) {
  console.log("Setting Protocol Fee Address to:", newAddress);
  const tx = await core.setProtocolFeeAddress(newAddress);
  await tx.wait();
  console.log("Protocol Fee Address updated");
}

async function setMinDonutForLaunch(amount) {
  console.log("Setting Min DONUT for Launch to:", divDec(amount));
  const tx = await core.setMinDonutForLaunch(amount);
  await tx.wait();
  console.log("Min DONUT updated");
}

async function transferCoreOwnership(newOwner) {
  console.log("Transferring Core ownership to:", newOwner);
  const tx = await core.transferOwnership(newOwner);
  await tx.wait();
  console.log("Core ownership transferred");
}

// =============================================================================
// PRINT FUNCTIONS
// =============================================================================

async function printDeployment() {
  console.log("\n==================== DEPLOYMENT ====================\n");

  console.log("--- Configuration ---");
  console.log("USDC (Quote Token):  ", USDC_ADDRESS);
  console.log("DONUT:               ", DONUT_ADDRESS || "NOT SET");
  console.log("Uniswap V2 Factory:  ", UNISWAP_V2_FACTORY);
  console.log("Uniswap V2 Router:   ", UNISWAP_V2_ROUTER);
  console.log("Entropy:             ", ENTROPY_ADDRESS);
  console.log("Protocol Fee Address:", PROTOCOL_FEE_ADDRESS || "NOT SET");
  console.log("Min DONUT for Launch:", divDec(MIN_DONUT_FOR_LAUNCH));

  console.log("\n--- Deployed Contracts ---");
  console.log(
    "Registry:            ",
    registry?.address || REGISTRY || "NOT DEPLOYED"
  );
  console.log(
    "UnitFactory:         ",
    unitFactory?.address || UNIT_FACTORY || "NOT DEPLOYED"
  );
  console.log(
    "MineRigFactory:          ",
    rigFactory?.address || RIG_FACTORY || "NOT DEPLOYED"
  );
  console.log(
    "AuctionFactory:      ",
    auctionFactory?.address || AUCTION_FACTORY || "NOT DEPLOYED"
  );
  console.log("Core:                ", core?.address || CORE || "NOT DEPLOYED");
  console.log(
    "Multicall:           ",
    multicall?.address || MULTICALL || "NOT DEPLOYED"
  );

  if (core) {
    console.log("\n--- Core State ---");
    console.log("Owner:               ", await core.owner());
    console.log("Protocol Fee Address:", await core.protocolFeeAddress());
    console.log(
      "Min DONUT:           ",
      divDec(await core.minDonutForLaunch())
    );
    console.log(
      "Deployed Rigs:       ",
      (await core.deployedRigsLength()).toString()
    );
  }

  console.log("\n====================================================\n");
}

async function printCoreState() {
  console.log("\n--- Core State ---");
  console.log("Owner:               ", await core.owner());
  console.log("Protocol Fee Address:", await core.protocolFeeAddress());
  console.log("DONUT:               ", await core.donutToken());
  console.log("Entropy:             ", await core.entropy());
  console.log("Min DONUT:           ", divDec(await core.minDonutForLaunch()));
  console.log("Unit Factory:        ", await core.unitFactory());
  console.log("Rig Factory:         ", await core.rigFactory());
  console.log("Auction Factory:     ", await core.auctionFactory());
  console.log(
    "Deployed Rigs:       ",
    (await core.deployedRigsLength()).toString()
  );
  console.log("");
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const [wallet] = await ethers.getSigners();
  console.log("Using wallet:", wallet.address);
  console.log(
    "Account balance:",
    ethers.utils.formatEther(await wallet.getBalance()),
    "ETH"
  );
  console.log("");

  await getContracts();

  //===================================================================
  // 1. Deploy System
  //===================================================================

  // console.log("Starting Deployment...");
  // await deployRegistry();    // Deploy first - central registry for all rig types
  // await deployUnitFactory();
  // await deployMineRigFactory();
  // await deployAuctionFactory();
  // await deployCore();
  // await approveCore();       // Approve Core as a factory in Registry
  // await deployMulticall();

  //===================================================================
  // 2. Verify Contracts
  //===================================================================

  // console.log("Starting Verification...");
  // await verifyRegistry();
  // await sleep(5000);
  // await verifyUnitFactory();
  // await sleep(5000);
  // await verifyMineRigFactory();
  // await sleep(5000);
  // await verifyAuctionFactory();
  // await sleep(5000);
  // await verifyCore();
  // await sleep(5000);
  // await verifyMulticall();

  // Get Unit verification info for manual verification
  // await getUnitVerificationInfo(0);

  // await verifyUnitByRigIndex(0);
  // await sleep(5000);
  // await verifyRigByIndex(0);
  // await sleep(5000);
  // await verifyAuctionByRigIndex(0);
  // await sleep(5000);

  //===================================================================
  // 3. Configuration (optional)
  //===================================================================

  // await setProtocolFeeAddress(PROTOCOL_FEE_ADDRESS);
  // console.log("Protocol Fee Address updated");

  // await setMinDonutForLaunch(MIN_DONUT_FOR_LAUNCH);
  // console.log("Min DONUT for Launch updated");

  //===================================================================
  // 4. Transfer Ownership (optional)
  //===================================================================

  // await transferCoreOwnership(MULTISIG_ADDRESS);
  // console.log("Core ownership transferred to:", MULTISIG_ADDRESS);

  //===================================================================
  // Print Deployment
  //===================================================================

  await printDeployment();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
