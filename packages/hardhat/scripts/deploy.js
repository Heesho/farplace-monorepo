const { ethers } = require("hardhat");
const hre = require("hardhat");

// Constants
const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;

// Get the next pending nonce fresh from the node each time
async function getNextNonce() {
  const [wallet] = await ethers.getSigners();
  return await wallet.getTransactionCount("pending");
}

// =============================================================================
// CONFIGURATION - UPDATE THESE FOR YOUR DEPLOYMENT
// =============================================================================

// Base Mainnet addresses
const USDC_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Real USDC on Base

// Mock Token addresses (for staging/testing on mainnet)
const MOCK_USDC = "0xe90495BE187d434e23A9B1FeC0B6Ce039700870e"; // Mock USDC for testing

// Toggle between mock and mainnet tokens
const USDC_ADDRESS = MOCK_USDC; // Switch to USDC_MAINNET for production

const UNISWAP_V2_FACTORY = "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6";
const UNISWAP_V2_ROUTER = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24";
const ENTROPY_ADDRESS = "0x6e7d74fa7d5c90fef9f0512987605a6d546181bb"; // Pyth Entropy on Base

// Protocol settings
const PROTOCOL_FEE_ADDRESS = "0xbA366c82815983fF130C23CED78bD95E1F2c18EA"; // TODO: Set protocol fee recipient
const MULTISIG_ADDRESS = "0xeE0CB49D2805DA6bC0A979ddAd87bb793fbB765E";
const MIN_USDC_FOR_LAUNCH = convert("1", 6); // 1 USDC minimum

// Deployed Contract Addresses
const REGISTRY = "0x5BA6CBD2d504a0e20Bae733ecb076dF49FB641CF";
const UNIT_FACTORY = "0x1044760729b70a5A0639E82E3dc1937d0885ED20";
const AUCTION_FACTORY = "0xFC4B86BbD12a7599C90ced220d1A64dd36EbA3AE";
const MINE_CORE = "0x2744aD23F0Eb637a60eeEBeC9904BC68c899e057";
const SPIN_CORE = "0xa0293945C1b4D44debBD1d65cfa26E9B9e290328";
const FUND_CORE = "0x256565839afe074cD7998f707895dD14692F5a2c";
const MINE_MULTICALL = "0xF6D9cDF2B073cDcE04eDCaCc703e62a8A897e9D4";
const SPIN_MULTICALL = "0x7aA9D0709774BF2d6CBf264e873b011da36A6408";
const FUND_MULTICALL = "0xfFecd05f08A87ac4A3e655fF523e0452E469cD96";

// Contract Variables
let usdc,
  registry,
  unitFactory,
  auctionFactory,
  mineCore,
  spinCore,
  fundCore,
  mineMulticall,
  spinMulticall,
  fundMulticall;

// =============================================================================
// GET CONTRACTS
// =============================================================================

async function getContracts() {
  usdc = await ethers.getContractAt(
    "contracts/mocks/MockUSDC.sol:MockUSDC",
    USDC_ADDRESS
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

  if (AUCTION_FACTORY) {
    auctionFactory = await ethers.getContractAt(
      "contracts/AuctionFactory.sol:AuctionFactory",
      AUCTION_FACTORY
    );
  }

  if (MINE_CORE) {
    mineCore = await ethers.getContractAt(
      "contracts/rigs/mine/MineCore.sol:MineCore",
      MINE_CORE
    );
  }

  if (SPIN_CORE) {
    spinCore = await ethers.getContractAt(
      "contracts/rigs/spin/SpinCore.sol:SpinCore",
      SPIN_CORE
    );
  }

  if (FUND_CORE) {
    fundCore = await ethers.getContractAt(
      "contracts/rigs/fund/FundCore.sol:FundCore",
      FUND_CORE
    );
  }

  if (MINE_MULTICALL) {
    mineMulticall = await ethers.getContractAt(
      "contracts/rigs/mine/MineMulticall.sol:MineMulticall",
      MINE_MULTICALL
    );
  }

  if (SPIN_MULTICALL) {
    spinMulticall = await ethers.getContractAt(
      "contracts/rigs/spin/SpinMulticall.sol:SpinMulticall",
      SPIN_MULTICALL
    );
  }

  if (FUND_MULTICALL) {
    fundMulticall = await ethers.getContractAt(
      "contracts/rigs/fund/FundMulticall.sol:FundMulticall",
      FUND_MULTICALL
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
  const contract = await artifact.deploy({ gasPrice: ethers.gasPrice, nonce: await getNextNonce() });
  registry = await contract.deployed();
  await sleep(5000);
  console.log("Registry Deployed at:", registry.address);
}

async function deployUnitFactory() {
  console.log("Starting UnitFactory Deployment");
  const artifact = await ethers.getContractFactory("UnitFactory");
  const contract = await artifact.deploy({ gasPrice: ethers.gasPrice, nonce: await getNextNonce() });
  unitFactory = await contract.deployed();
  await sleep(5000);
  console.log("UnitFactory Deployed at:", unitFactory.address);
}

async function deployAuctionFactory() {
  console.log("Starting AuctionFactory Deployment");
  const artifact = await ethers.getContractFactory("AuctionFactory");
  const contract = await artifact.deploy({ gasPrice: ethers.gasPrice, nonce: await getNextNonce() });
  auctionFactory = await contract.deployed();
  await sleep(5000);
  console.log("AuctionFactory Deployed at:", auctionFactory.address);
}

async function deployMineCore() {
  console.log("Starting MineCore Deployment");

  if (!PROTOCOL_FEE_ADDRESS) {
    throw new Error("PROTOCOL_FEE_ADDRESS must be set before deployment");
  }
  if (!USDC_ADDRESS) {
    throw new Error("USDC_ADDRESS must be set before deployment");
  }
  if (!registry?.address && !REGISTRY) {
    throw new Error("Registry must be deployed before MineCore");
  }

  const registryAddress = registry?.address || REGISTRY;

  const artifact = await ethers.getContractFactory("MineCore");
  const contract = await artifact.deploy(
    registryAddress,
    USDC_ADDRESS,
    UNISWAP_V2_FACTORY,
    UNISWAP_V2_ROUTER,
    unitFactory.address,
    auctionFactory.address,
    ENTROPY_ADDRESS,
    PROTOCOL_FEE_ADDRESS,
    MIN_USDC_FOR_LAUNCH,
    { gasPrice: ethers.gasPrice, nonce: await getNextNonce() }
  );
  mineCore = await contract.deployed();
  await sleep(5000);
  console.log("MineCore Deployed at:", mineCore.address);
}

async function deploySpinCore() {
  console.log("Starting SpinCore Deployment");

  if (!PROTOCOL_FEE_ADDRESS) {
    throw new Error("PROTOCOL_FEE_ADDRESS must be set before deployment");
  }
  if (!USDC_ADDRESS) {
    throw new Error("USDC_ADDRESS must be set before deployment");
  }
  if (!registry?.address && !REGISTRY) {
    throw new Error("Registry must be deployed before SpinCore");
  }

  const registryAddress = registry?.address || REGISTRY;

  const artifact = await ethers.getContractFactory("SpinCore");
  const contract = await artifact.deploy(
    registryAddress,
    USDC_ADDRESS,
    UNISWAP_V2_FACTORY,
    UNISWAP_V2_ROUTER,
    unitFactory.address,
    auctionFactory.address,
    ENTROPY_ADDRESS,
    PROTOCOL_FEE_ADDRESS,
    MIN_USDC_FOR_LAUNCH,
    { gasPrice: ethers.gasPrice, nonce: await getNextNonce() }
  );
  spinCore = await contract.deployed();
  await sleep(5000);
  console.log("SpinCore Deployed at:", spinCore.address);
}

async function deployFundCore() {
  console.log("Starting FundCore Deployment");

  if (!PROTOCOL_FEE_ADDRESS) {
    throw new Error("PROTOCOL_FEE_ADDRESS must be set before deployment");
  }
  if (!USDC_ADDRESS) {
    throw new Error("USDC_ADDRESS must be set before deployment");
  }
  if (!registry?.address && !REGISTRY) {
    throw new Error("Registry must be deployed before FundCore");
  }

  const registryAddress = registry?.address || REGISTRY;

  const artifact = await ethers.getContractFactory("FundCore");
  const contract = await artifact.deploy(
    registryAddress,
    USDC_ADDRESS,
    UNISWAP_V2_FACTORY,
    UNISWAP_V2_ROUTER,
    unitFactory.address,
    auctionFactory.address,
    PROTOCOL_FEE_ADDRESS,
    MIN_USDC_FOR_LAUNCH,
    { gasPrice: ethers.gasPrice, nonce: await getNextNonce() }
  );
  fundCore = await contract.deployed();
  await sleep(5000);
  console.log("FundCore Deployed at:", fundCore.address);
}

async function approveMineCore() {
  console.log("Approving MineCore as factory in Registry...");
  const coreAddress = mineCore?.address || MINE_CORE;
  const tx = await registry.setFactoryApproval(coreAddress, true, { nonce: await getNextNonce() });
  await tx.wait();
  console.log("MineCore approved in Registry");
}

async function approveSpinCore() {
  console.log("Approving SpinCore as factory in Registry...");
  const coreAddress = spinCore?.address || SPIN_CORE;
  const tx = await registry.setFactoryApproval(coreAddress, true, { nonce: await getNextNonce() });
  await tx.wait();
  console.log("SpinCore approved in Registry");
}

async function approveFundCore() {
  console.log("Approving FundCore as factory in Registry...");
  const coreAddress = fundCore?.address || FUND_CORE;
  const tx = await registry.setFactoryApproval(coreAddress, true, { nonce: await getNextNonce() });
  await tx.wait();
  console.log("FundCore approved in Registry");
}

async function deployMineMulticall() {
  console.log("Starting MineMulticall Deployment");
  const artifact = await ethers.getContractFactory("MineMulticall");
  const contract = await artifact.deploy(mineCore.address, USDC_ADDRESS, {
    gasPrice: ethers.gasPrice,
  });
  mineMulticall = await contract.deployed();
  await sleep(5000);
  console.log("MineMulticall Deployed at:", mineMulticall.address);
}

async function deploySpinMulticall() {
  console.log("Starting SpinMulticall Deployment");
  const artifact = await ethers.getContractFactory("SpinMulticall");
  const contract = await artifact.deploy(spinCore.address, USDC_ADDRESS, {
    gasPrice: ethers.gasPrice,
  });
  spinMulticall = await contract.deployed();
  await sleep(5000);
  console.log("SpinMulticall Deployed at:", spinMulticall.address);
}

async function deployFundMulticall() {
  console.log("Starting FundMulticall Deployment");
  const artifact = await ethers.getContractFactory("FundMulticall");
  const contract = await artifact.deploy(fundCore.address, USDC_ADDRESS, {
    gasPrice: ethers.gasPrice,
  });
  fundMulticall = await contract.deployed();
  await sleep(5000);
  console.log("FundMulticall Deployed at:", fundMulticall.address);
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

async function verifyAuctionFactory() {
  console.log("Starting AuctionFactory Verification");
  await hre.run("verify:verify", {
    address: auctionFactory?.address || AUCTION_FACTORY,
    contract: "contracts/AuctionFactory.sol:AuctionFactory",
    constructorArguments: [],
  });
  console.log("AuctionFactory Verified");
}

async function verifyMineCore() {
  console.log("Starting MineCore Verification");
  await hre.run("verify:verify", {
    address: mineCore?.address || MINE_CORE,
    contract: "contracts/rigs/mine/MineCore.sol:MineCore",
    constructorArguments: [
      registry?.address || REGISTRY,
      USDC_ADDRESS,
      UNISWAP_V2_FACTORY,
      UNISWAP_V2_ROUTER,
      unitFactory?.address || UNIT_FACTORY,
      auctionFactory?.address || AUCTION_FACTORY,
      ENTROPY_ADDRESS,
      PROTOCOL_FEE_ADDRESS,
      MIN_USDC_FOR_LAUNCH,
    ],
  });
  console.log("MineCore Verified");
}

async function verifySpinCore() {
  console.log("Starting SpinCore Verification");
  await hre.run("verify:verify", {
    address: spinCore?.address || SPIN_CORE,
    contract: "contracts/rigs/spin/SpinCore.sol:SpinCore",
    constructorArguments: [
      registry?.address || REGISTRY,
      USDC_ADDRESS,
      UNISWAP_V2_FACTORY,
      UNISWAP_V2_ROUTER,
      unitFactory?.address || UNIT_FACTORY,
      auctionFactory?.address || AUCTION_FACTORY,
      ENTROPY_ADDRESS,
      PROTOCOL_FEE_ADDRESS,
      MIN_USDC_FOR_LAUNCH,
    ],
  });
  console.log("SpinCore Verified");
}

async function verifyFundCore() {
  console.log("Starting FundCore Verification");
  await hre.run("verify:verify", {
    address: fundCore?.address || FUND_CORE,
    contract: "contracts/rigs/fund/FundCore.sol:FundCore",
    constructorArguments: [
      registry?.address || REGISTRY,
      USDC_ADDRESS,
      UNISWAP_V2_FACTORY,
      UNISWAP_V2_ROUTER,
      unitFactory?.address || UNIT_FACTORY,
      auctionFactory?.address || AUCTION_FACTORY,
      PROTOCOL_FEE_ADDRESS,
      MIN_USDC_FOR_LAUNCH,
    ],
  });
  console.log("FundCore Verified");
}

async function verifyMineMulticall() {
  console.log("Starting MineMulticall Verification");
  await hre.run("verify:verify", {
    address: mineMulticall?.address || MINE_MULTICALL,
    contract: "contracts/rigs/mine/MineMulticall.sol:MineMulticall",
    constructorArguments: [mineCore?.address || MINE_CORE, USDC_ADDRESS],
  });
  console.log("MineMulticall Verified");
}

async function verifySpinMulticall() {
  console.log("Starting SpinMulticall Verification");
  await hre.run("verify:verify", {
    address: spinMulticall?.address || SPIN_MULTICALL,
    contract: "contracts/rigs/spin/SpinMulticall.sol:SpinMulticall",
    constructorArguments: [spinCore?.address || SPIN_CORE, USDC_ADDRESS],
  });
  console.log("SpinMulticall Verified");
}

async function verifyFundMulticall() {
  console.log("Starting FundMulticall Verification");
  await hre.run("verify:verify", {
    address: fundMulticall?.address || FUND_MULTICALL,
    contract: "contracts/rigs/fund/FundMulticall.sol:FundMulticall",
    constructorArguments: [fundCore?.address || FUND_CORE, USDC_ADDRESS],
  });
  console.log("FundMulticall Verified");
}

async function verifyUnitByRigAddress(rigAddress) {
  const rig = await ethers.getContractAt(
    "contracts/rigs/mine/MineRig.sol:MineRig",
    rigAddress
  );
  const unitAddress = await rig.unit();
  const unit = await ethers.getContractAt(
    "contracts/Unit.sol:Unit",
    unitAddress
  );

  const name = await unit.name();
  const symbol = await unit.symbol();
  // UnitFactory passes msg.sender (the Core) as _initialRig
  const coreAddress = mineCore?.address || MINE_CORE;

  console.log("Starting Unit Verification for:", unitAddress);
  console.log("  Name:", name);
  console.log("  Symbol:", symbol);
  console.log("  Initial Rig (Core):", coreAddress);

  await hre.run("verify:verify", {
    address: unitAddress,
    contract: "contracts/Unit.sol:Unit",
    constructorArguments: [name, symbol, coreAddress],
  });
  console.log("Unit Verified:", unitAddress);
}

async function getUnitVerificationInfo(rigAddress) {
  const rig = await ethers.getContractAt(
    "contracts/rigs/mine/MineRig.sol:MineRig",
    rigAddress
  );
  const unitAddress = await rig.unit();
  const unit = await ethers.getContractAt(
    "contracts/Unit.sol:Unit",
    unitAddress
  );

  const name = await unit.name();
  const symbol = await unit.symbol();
  // UnitFactory passes msg.sender (the Core) as _initialRig
  const coreAddress = mineCore?.address || MINE_CORE;

  // ABI encode the constructor arguments
  const abiCoder = new ethers.utils.AbiCoder();
  const encodedArgs = abiCoder.encode(
    ["string", "string", "address"],
    [name, symbol, coreAddress]
  );
  // Remove '0x' prefix for BaseScan
  const encodedArgsNoPrefix = encodedArgs.slice(2);

  console.log("\n=== Unit Verification Info ===\n");
  console.log("Unit Address:", unitAddress);
  console.log("Name:", name);
  console.log("Symbol:", symbol);
  console.log("Initial Rig (Core):", coreAddress);
  console.log("\nABI-Encoded Constructor Arguments (for BaseScan):");
  console.log(encodedArgsNoPrefix);
  console.log("\n==============================\n");

  return {
    unitAddress,
    name,
    symbol,
    coreAddress,
    encodedArgs: encodedArgsNoPrefix,
  };
}

async function verifyRigByAddress(rigAddress) {
  const rig = await ethers.getContractAt(
    "contracts/rigs/mine/MineRig.sol:MineRig",
    rigAddress
  );

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
  const upsMultiplierDuration = await rig.upsMultiplierDuration();

  // Read upsMultipliers array (public array requires index-based reads)
  const upsMultipliers = [];
  try {
    for (let i = 0; i < 100; i++) {
      const val = await rig.upsMultipliers(i);
      upsMultipliers.push(val);
    }
  } catch (e) {
    // Array bounds reached
  }

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
  console.log(
    "    UPS Multipliers:",
    upsMultipliers.map((m) => m.toString())
  );
  console.log("    UPS Multiplier Duration:", upsMultiplierDuration.toString());

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
        upsMultipliers: upsMultipliers,
        upsMultiplierDuration: upsMultiplierDuration,
      },
    ],
  });
  console.log("Rig Verified:", rigAddress);
}

async function verifyAuctionByRigAddress(rigAddress) {
  const auctionAddress = await mineCore.rigToAuction(rigAddress);
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

// --- SpinRig-specific verification ---

async function verifySpinUnitByRigAddress(rigAddress) {
  const rig = await ethers.getContractAt(
    "contracts/rigs/spin/SpinRig.sol:SpinRig",
    rigAddress
  );
  const unitAddress = await rig.unit();
  const unit = await ethers.getContractAt(
    "contracts/Unit.sol:Unit",
    unitAddress
  );

  const name = await unit.name();
  const symbol = await unit.symbol();
  const coreAddress = spinCore?.address || SPIN_CORE;

  console.log("Starting Unit Verification for:", unitAddress);
  console.log("  Name:", name);
  console.log("  Symbol:", symbol);
  console.log("  Initial Rig (Core):", coreAddress);

  await hre.run("verify:verify", {
    address: unitAddress,
    contract: "contracts/Unit.sol:Unit",
    constructorArguments: [name, symbol, coreAddress],
  });
  console.log("Unit Verified:", unitAddress);
}

async function getSpinUnitVerificationInfo(rigAddress) {
  const rig = await ethers.getContractAt(
    "contracts/rigs/spin/SpinRig.sol:SpinRig",
    rigAddress
  );
  const unitAddress = await rig.unit();
  const unit = await ethers.getContractAt(
    "contracts/Unit.sol:Unit",
    unitAddress
  );

  const name = await unit.name();
  const symbol = await unit.symbol();
  const coreAddress = spinCore?.address || SPIN_CORE;

  const abiCoder = new ethers.utils.AbiCoder();
  const encodedArgs = abiCoder.encode(
    ["string", "string", "address"],
    [name, symbol, coreAddress]
  );
  const encodedArgsNoPrefix = encodedArgs.slice(2);

  console.log("\n=== Spin Unit Verification Info ===\n");
  console.log("Unit Address:", unitAddress);
  console.log("Name:", name);
  console.log("Symbol:", symbol);
  console.log("Initial Rig (Core):", coreAddress);
  console.log("\nABI-Encoded Constructor Arguments (for BaseScan):");
  console.log(encodedArgsNoPrefix);
  console.log("\n==============================\n");

  return {
    unitAddress,
    name,
    symbol,
    coreAddress,
    encodedArgs: encodedArgsNoPrefix,
  };
}

async function verifySpinRigByAddress(rigAddress) {
  const rig = await ethers.getContractAt(
    "contracts/rigs/spin/SpinRig.sol:SpinRig",
    rigAddress
  );

  const unitAddress = await rig.unit();
  const quoteAddress = await rig.quote();
  const entropyAddress = await rig.entropy();
  const treasury = await rig.treasury();
  const coreAddress = await rig.core();

  const epochPeriod = await rig.epochPeriod();
  const priceMultiplier = await rig.priceMultiplier();
  const minInitPrice = await rig.minInitPrice();
  const initialUps = await rig.initialUps();
  const halvingPeriod = await rig.halvingPeriod();
  const tailUps = await rig.tailUps();

  const odds = [];
  try {
    for (let i = 0; i < 100; i++) {
      const val = await rig.odds(i);
      odds.push(val);
    }
  } catch (e) {
    // Array bounds reached
  }

  console.log("Starting SpinRig Verification for:", rigAddress);
  console.log("  Unit:", unitAddress);
  console.log("  Quote:", quoteAddress);
  console.log("  Entropy:", entropyAddress);
  console.log("  Treasury:", treasury);
  console.log("  Core:", coreAddress);
  console.log("  Config:");
  console.log("    Epoch Period:", epochPeriod.toString());
  console.log("    Price Multiplier:", priceMultiplier.toString());
  console.log("    Min Init Price:", minInitPrice.toString());
  console.log("    Initial UPS:", initialUps.toString());
  console.log("    Halving Period:", halvingPeriod.toString());
  console.log("    Tail UPS:", tailUps.toString());
  console.log(
    "    Odds:",
    odds.map((o) => o.toString())
  );

  await hre.run("verify:verify", {
    address: rigAddress,
    contract: "contracts/rigs/spin/SpinRig.sol:SpinRig",
    constructorArguments: [
      unitAddress,
      quoteAddress,
      entropyAddress,
      treasury,
      coreAddress,
      {
        epochPeriod: epochPeriod,
        priceMultiplier: priceMultiplier,
        minInitPrice: minInitPrice,
        initialUps: initialUps,
        halvingPeriod: halvingPeriod,
        tailUps: tailUps,
        odds: odds,
      },
    ],
  });
  console.log("SpinRig Verified:", rigAddress);
}

async function verifySpinAuctionByRigAddress(rigAddress) {
  const auctionAddress = await spinCore.rigToAuction(rigAddress);
  const auction = await ethers.getContractAt(
    "contracts/Auction.sol:Auction",
    auctionAddress
  );

  const paymentToken = await auction.paymentToken();
  const paymentReceiver = await auction.paymentReceiver();
  const epochPeriod = await auction.epochPeriod();
  const priceMultiplier = await auction.priceMultiplier();
  const minInitPrice = await auction.minInitPrice();

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

  console.log("Starting Spin Auction Verification for:", auctionAddress);
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
  console.log("Spin Auction Verified:", auctionAddress);
}

// --- FundRig-specific verification ---

async function verifyFundUnitByRigAddress(rigAddress) {
  const rig = await ethers.getContractAt(
    "contracts/rigs/fund/FundRig.sol:FundRig",
    rigAddress
  );
  const unitAddress = await rig.unit();
  const unit = await ethers.getContractAt(
    "contracts/Unit.sol:Unit",
    unitAddress
  );

  const name = await unit.name();
  const symbol = await unit.symbol();
  const coreAddress = fundCore?.address || FUND_CORE;

  console.log("Starting Unit Verification for:", unitAddress);
  console.log("  Name:", name);
  console.log("  Symbol:", symbol);
  console.log("  Initial Rig (Core):", coreAddress);

  await hre.run("verify:verify", {
    address: unitAddress,
    contract: "contracts/Unit.sol:Unit",
    constructorArguments: [name, symbol, coreAddress],
  });
  console.log("Unit Verified:", unitAddress);
}

async function getFundUnitVerificationInfo(rigAddress) {
  const rig = await ethers.getContractAt(
    "contracts/rigs/fund/FundRig.sol:FundRig",
    rigAddress
  );
  const unitAddress = await rig.unit();
  const unit = await ethers.getContractAt(
    "contracts/Unit.sol:Unit",
    unitAddress
  );

  const name = await unit.name();
  const symbol = await unit.symbol();
  const coreAddress = fundCore?.address || FUND_CORE;

  const abiCoder = new ethers.utils.AbiCoder();
  const encodedArgs = abiCoder.encode(
    ["string", "string", "address"],
    [name, symbol, coreAddress]
  );
  const encodedArgsNoPrefix = encodedArgs.slice(2);

  console.log("\n=== Fund Unit Verification Info ===\n");
  console.log("Unit Address:", unitAddress);
  console.log("Name:", name);
  console.log("Symbol:", symbol);
  console.log("Initial Rig (Core):", coreAddress);
  console.log("\nABI-Encoded Constructor Arguments (for BaseScan):");
  console.log(encodedArgsNoPrefix);
  console.log("\n==============================\n");

  return {
    unitAddress,
    name,
    symbol,
    coreAddress,
    encodedArgs: encodedArgsNoPrefix,
  };
}

async function verifyFundRigByAddress(rigAddress) {
  const rig = await ethers.getContractAt(
    "contracts/rigs/fund/FundRig.sol:FundRig",
    rigAddress
  );

  const unitAddress = await rig.unit();
  const quoteToken = await rig.quote();
  const coreAddress = await rig.core();
  const treasury = await rig.treasury();
  const team = await rig.team();
  const recipient = await rig.recipient();
  const initialEmission = await rig.initialEmission();
  const minEmission = await rig.minEmission();
  const halvingPeriod = await rig.halvingPeriod();

  console.log("Starting FundRig Verification for:", rigAddress);
  console.log("  Unit:", unitAddress);
  console.log("  Quote:", quoteToken);
  console.log("  Core:", coreAddress);
  console.log("  Treasury:", treasury);
  console.log("  Team:", team);
  console.log("  Recipient:", recipient);
  console.log("  Initial Emission:", initialEmission.toString());
  console.log("  Min Emission:", minEmission.toString());
  console.log("  Halving Period:", halvingPeriod.toString());

  await hre.run("verify:verify", {
    address: rigAddress,
    contract: "contracts/rigs/fund/FundRig.sol:FundRig",
    constructorArguments: [
      unitAddress,
      quoteToken,
      coreAddress,
      treasury,
      team,
      recipient,
      {
        initialEmission: initialEmission,
        minEmission: minEmission,
        halvingPeriod: halvingPeriod,
      },
    ],
  });
  console.log("FundRig Verified:", rigAddress);
}

async function verifyFundAuctionByRigAddress(rigAddress) {
  const auctionAddress = await fundCore.rigToAuction(rigAddress);
  const auction = await ethers.getContractAt(
    "contracts/Auction.sol:Auction",
    auctionAddress
  );

  const paymentToken = await auction.paymentToken();
  const paymentReceiver = await auction.paymentReceiver();
  const epochPeriod = await auction.epochPeriod();
  const priceMultiplier = await auction.priceMultiplier();
  const minInitPrice = await auction.minInitPrice();

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

  console.log("Starting Fund Auction Verification for:", auctionAddress);
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
  console.log("Fund Auction Verified:", auctionAddress);
}

// =============================================================================
// CONFIGURATION FUNCTIONS
// =============================================================================

async function setProtocolFeeAddress(coreContract, newAddress) {
  console.log("Setting Protocol Fee Address to:", newAddress);
  const tx = await coreContract.setProtocolFeeAddress(newAddress);
  await tx.wait();
  console.log("Protocol Fee Address updated");
}

async function setMinUsdcForLaunch(coreContract, amount) {
  console.log("Setting Min USDC for Launch to:", divDec(amount));
  const tx = await coreContract.setMinUsdcForLaunch(amount);
  await tx.wait();
  console.log("Min USDC updated");
}

async function transferMineCoreOwnership(newOwner) {
  console.log("Transferring MineCore ownership to:", newOwner);
  const tx = await mineCore.transferOwnership(newOwner);
  await tx.wait();
  console.log("MineCore ownership transferred");
}

async function transferSpinCoreOwnership(newOwner) {
  console.log("Transferring SpinCore ownership to:", newOwner);
  const tx = await spinCore.transferOwnership(newOwner);
  await tx.wait();
  console.log("SpinCore ownership transferred");
}

async function transferFundCoreOwnership(newOwner) {
  console.log("Transferring FundCore ownership to:", newOwner);
  const tx = await fundCore.transferOwnership(newOwner);
  await tx.wait();
  console.log("FundCore ownership transferred");
}

// =============================================================================
// PRINT FUNCTIONS
// =============================================================================

async function printDeployment() {
  console.log("\n==================== DEPLOYMENT ====================\n");

  console.log("--- Configuration ---");
  console.log("USDC:                ", USDC_ADDRESS);
  console.log("Uniswap V2 Factory:  ", UNISWAP_V2_FACTORY);
  console.log("Uniswap V2 Router:   ", UNISWAP_V2_ROUTER);
  console.log("Entropy:             ", ENTROPY_ADDRESS);
  console.log("Protocol Fee Address:", PROTOCOL_FEE_ADDRESS || "NOT SET");
  console.log("Min USDC for Launch:", divDec(MIN_USDC_FOR_LAUNCH));

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
    "AuctionFactory:      ",
    auctionFactory?.address || AUCTION_FACTORY || "NOT DEPLOYED"
  );
  console.log(
    "MineCore:            ",
    mineCore?.address || MINE_CORE || "NOT DEPLOYED"
  );
  console.log(
    "SpinCore:            ",
    spinCore?.address || SPIN_CORE || "NOT DEPLOYED"
  );
  console.log(
    "FundCore:            ",
    fundCore?.address || FUND_CORE || "NOT DEPLOYED"
  );
  console.log(
    "MineMulticall:       ",
    mineMulticall?.address || MINE_MULTICALL || "NOT DEPLOYED"
  );
  console.log(
    "SpinMulticall:       ",
    spinMulticall?.address || SPIN_MULTICALL || "NOT DEPLOYED"
  );
  console.log(
    "FundMulticall:       ",
    fundMulticall?.address || FUND_MULTICALL || "NOT DEPLOYED"
  );

  if (mineCore) {
    console.log("\n--- MineCore State ---");
    console.log("Owner:               ", await mineCore.owner());
    console.log("Protocol Fee Address:", await mineCore.protocolFeeAddress());
    console.log(
      "Min USDC:           ",
      divDec(await mineCore.minUsdcForLaunch())
    );
  }

  if (spinCore) {
    console.log("\n--- SpinCore State ---");
    console.log("Owner:               ", await spinCore.owner());
    console.log("Protocol Fee Address:", await spinCore.protocolFeeAddress());
    console.log(
      "Min USDC:           ",
      divDec(await spinCore.minUsdcForLaunch())
    );
  }

  if (fundCore) {
    console.log("\n--- FundCore State ---");
    console.log("Owner:               ", await fundCore.owner());
    console.log("Protocol Fee Address:", await fundCore.protocolFeeAddress());
    console.log(
      "Min USDC:           ",
      divDec(await fundCore.minUsdcForLaunch())
    );
  }

  console.log("\n====================================================\n");
}

async function printCoreState(coreContract, label) {
  console.log(`\n--- ${label} State ---`);
  console.log("Owner:               ", await coreContract.owner());
  console.log("Protocol Fee Address:", await coreContract.protocolFeeAddress());
  console.log("USDC:               ", await coreContract.usdcToken());
  console.log(
    "Min USDC:           ",
    divDec(await coreContract.minUsdcForLaunch())
  );
  console.log("Unit Factory:        ", await coreContract.unitFactory());
  console.log("Auction Factory:     ", await coreContract.auctionFactory());
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
  // 1. Deploy System (already deployed)
  //===================================================================

  // --- Shared infrastructure ---
  console.log("Starting Deployment...");
  await deployRegistry();
  await deployUnitFactory();
  await deployAuctionFactory();

  // --- MineCore ---
  await deployMineCore();
  await approveMineCore();
  await deployMineMulticall();

  // --- SpinCore ---
  await deploySpinCore();
  await approveSpinCore();
  await deploySpinMulticall();

  // --- FundCore ---
  await deployFundCore();
  await approveFundCore();
  await deployFundMulticall();

  //===================================================================
  // 2. Verify Contracts
  //===================================================================

  // --- Shared infrastructure ---
  // console.log("Starting Verification...");
  // await verifyRegistry();
  // await sleep(5000);
  // await verifyUnitFactory();
  // await sleep(5000);
  // await verifyAuctionFactory();
  // await sleep(5000);

  // // --- MineCore ---
  // await verifyMineCore();
  // await sleep(5000);
  // await verifyMineMulticall();
  // await sleep(5000);

  // // --- SpinCore ---
  // await verifySpinCore();
  // await sleep(5000);
  // await verifySpinMulticall();
  // await sleep(5000);

  // // --- FundCore ---
  // await verifyFundCore();
  // await sleep(5000);
  // await verifyFundMulticall();
  // await sleep(5000);

  // --- MineRig-specific verification (pass rig address) ---
  // await getUnitVerificationInfo("0xRIG_ADDRESS");
  // await verifyUnitByRigAddress("0xRIG_ADDRESS");
  // await sleep(5000);
  // await verifyRigByAddress("0xRIG_ADDRESS");
  // await sleep(5000);
  // await verifyAuctionByRigAddress("0xRIG_ADDRESS");
  // await sleep(5000);

  // --- SpinRig-specific verification (pass rig address) ---
  // await getSpinUnitVerificationInfo("0xRIG_ADDRESS");
  // await verifySpinUnitByRigAddress("0xRIG_ADDRESS");
  // await sleep(5000);
  // await verifySpinRigByAddress("0xRIG_ADDRESS");
  // await sleep(5000);
  // await verifySpinAuctionByRigAddress("0xRIG_ADDRESS");
  // await sleep(5000);

  // --- FundRig-specific verification (pass rig address) ---
  // await getFundUnitVerificationInfo("0xRIG_ADDRESS");
  // await verifyFundUnitByRigAddress("0xRIG_ADDRESS");
  // await sleep(5000);
  // await verifyFundRigByAddress("0xRIG_ADDRESS");
  // await sleep(5000);
  // await verifyFundAuctionByRigAddress("0xRIG_ADDRESS");
  // await sleep(5000);

  //===================================================================
  // 3. Configuration (optional)
  //===================================================================

  // await setProtocolFeeAddress(mineCore, PROTOCOL_FEE_ADDRESS);
  // await setProtocolFeeAddress(spinCore, PROTOCOL_FEE_ADDRESS);
  // await setProtocolFeeAddress(fundCore, PROTOCOL_FEE_ADDRESS);

  // await setMinUsdcForLaunch(mineCore, MIN_USDC_FOR_LAUNCH);
  // await setMinUsdcForLaunch(spinCore, MIN_USDC_FOR_LAUNCH);
  // await setMinUsdcForLaunch(fundCore, MIN_USDC_FOR_LAUNCH);

  //===================================================================
  // 4. Transfer Ownership (optional)
  //===================================================================

  // await transferMineCoreOwnership(MULTISIG_ADDRESS);
  // await transferSpinCoreOwnership(MULTISIG_ADDRESS);
  // await transferFundCoreOwnership(MULTISIG_ADDRESS);

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
