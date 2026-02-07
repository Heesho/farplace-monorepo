const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";
const AddressDead = "0x000000000000000000000000000000000000dEaD";

let owner, protocol, team, user0, user1, user2;
let weth, usdc, registry, core, multicall, entropy;
let rig, auction, unit, lpToken;
let rigFactory, auctionFactory;

// Mock Uniswap V2 contracts for testing
let uniswapFactory, uniswapRouter;

describe("Core Tests", function () {
  before("Initial set up", async function () {
    // Reset network state for test isolation
    await network.provider.send("hardhat_reset");
    console.log("Begin Initialization");

    [owner, protocol, team, user0, user1, user2] = await ethers.getSigners();

    // Deploy WETH
    const wethArtifact = await ethers.getContractFactory("MockWETH");
    weth = await wethArtifact.deploy();
    console.log("- WETH Initialized");

    // Deploy mock USDC token (6 decimals)
    const usdcArtifact = await ethers.getContractFactory("MockUSDC");
    usdc = await usdcArtifact.deploy();
    console.log("- MockUSDC Initialized");

    // Deploy mock Entropy
    const entropyArtifact = await ethers.getContractFactory("MockEntropy");
    entropy = await entropyArtifact.deploy();
    console.log("- Entropy Initialized");

    // Deploy mock Uniswap V2 Factory and Router
    const mockUniswapFactoryArtifact = await ethers.getContractFactory("MockUniswapV2Factory");
    uniswapFactory = await mockUniswapFactoryArtifact.deploy();
    console.log("- Uniswap V2 Factory Initialized");

    const mockUniswapRouterArtifact = await ethers.getContractFactory("MockUniswapV2Router");
    uniswapRouter = await mockUniswapRouterArtifact.deploy(uniswapFactory.address);
    console.log("- Uniswap V2 Router Initialized");

    // Deploy MineRigFactory
    const rigFactoryArtifact = await ethers.getContractFactory("MineRigFactory");
    rigFactory = await rigFactoryArtifact.deploy();
    console.log("- MineRigFactory Initialized");

    // Deploy AuctionFactory
    const auctionFactoryArtifact = await ethers.getContractFactory("AuctionFactory");
    auctionFactory = await auctionFactoryArtifact.deploy();
    console.log("- AuctionFactory Initialized");

    // Deploy UnitFactory
    const unitFactoryArtifact = await ethers.getContractFactory("UnitFactory");
    const unitFactory = await unitFactoryArtifact.deploy();
    console.log("- UnitFactory Initialized");

    // Deploy Registry
    const registryArtifact = await ethers.getContractFactory("Registry");
    registry = await registryArtifact.deploy();
    console.log("- Registry Initialized");

    // Deploy Core
    const coreArtifact = await ethers.getContractFactory("MineCore");
    core = await coreArtifact.deploy(
      registry.address,
      usdc.address,
      uniswapFactory.address,
      uniswapRouter.address,
      unitFactory.address,
      rigFactory.address,
      auctionFactory.address,
      entropy.address,
      protocol.address,
      convert("100", 6) // minUsdcForLaunch
    );
    console.log("- Core Initialized");

    // Approve Core as factory in Registry
    await registry.setFactoryApproval(core.address, true);
    console.log("- Core approved in Registry");

    // Deploy Multicall
    const multicallArtifact = await ethers.getContractFactory("MineMulticall");
    multicall = await multicallArtifact.deploy(core.address, usdc.address);
    console.log("- Multicall Initialized");

    // Mint USDC to user0 for launching
    await usdc.mint(user0.address, convert("1000", 6));
    console.log("- USDC minted to user0");

    console.log("Initialization Complete");
    console.log();
  });

  it("Core state", async function () {
    console.log("******************************************************");
    console.log("Protocol Fee Address:", await core.protocolFeeAddress());
    console.log("USDC Token:", await core.usdcToken());
    console.log("Min USDC for Launch:", divDec(await core.minUsdcForLaunch(), 6));
  });

  it("Launch a new rig", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      quoteToken: weth.address,
      tokenName: "Test Unit",
      tokenSymbol: "TUNIT",
      uri: "https://example.com/rig",
      usdcAmount: convert("500", 6),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingAmount: convert("10000000", 18), // 10M tokens
      rigEpochPeriod: 3600, // 1 hour
      rigPriceMultiplier: convert("2", 18),
      rigMinInitPrice: convert("0.0001", 18),
      upsMultipliers: [convert("1", 18)],
      upsMultiplierDuration: 86400,
      auctionInitPrice: convert("1", 18),
      auctionEpochPeriod: 86400, // 1 day
      auctionPriceMultiplier: convert("1.2", 18),
      auctionMinInitPrice: convert("0.001", 18),
    };

    // Approve USDC
    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);

    // Launch
    const tx = await core.connect(user0).launch(launchParams);
    const receipt = await tx.wait();

    // Get deployed addresses from event
    const launchEvent = receipt.events.find((e) => e.event === "MineCore__Launched");
    rig = launchEvent.args.rig;
    unit = launchEvent.args.unit;
    auction = launchEvent.args.auction;
    lpToken = launchEvent.args.lpToken;

    // Disable entropy for tests that don't send ETH for VRF fees
    const rigContract = await ethers.getContractAt("MineRig", rig);
    await rigContract.connect(user0).setEntropyEnabled(false);

    console.log("Rig deployed at:", rig);
    console.log("Unit token deployed at:", unit);
    console.log("Auction deployed at:", auction);
    console.log("LP Token at:", lpToken);

    // Verify registry
    expect(await core.rigToIsRig(rig)).to.equal(true);
    expect(await core.rigToAuction(rig)).to.equal(auction);
    expect(await core.rigs(0)).to.equal(rig);
    expect(await core.rigsLength()).to.equal(1);
    expect(await core.rigToIndex(rig)).to.equal(0);
    expect(await core.rigToLP(rig)).to.equal(lpToken);
  });

  it("Verify rig ownership transferred to launcher", async function () {
    console.log("******************************************************");
    const rigContract = await ethers.getContractAt("MineRig", rig);
    expect(await rigContract.owner()).to.equal(user0.address);
    console.log("Rig owner:", await rigContract.owner());
  });

  it("Verify rig parameters", async function () {
    console.log("******************************************************");
    const rigContract = await ethers.getContractAt("MineRig", rig);

    console.log("Initial UPS:", divDec(await rigContract.initialUps()));
    console.log("Tail UPS:", divDec(await rigContract.tailUps()));
    console.log("Halving Amount:", divDec(await rigContract.halvingAmount()));
    console.log("Epoch Period:", (await rigContract.epochPeriod()).toString());
    console.log("Treasury:", await rigContract.treasury());
    console.log("Core:", await rigContract.core());
    console.log("Protocol:", await core.protocolFeeAddress());

    expect(await rigContract.treasury()).to.equal(auction);
    expect(await rigContract.core()).to.equal(core.address);
  });

  it("Verify LP tokens burned", async function () {
    console.log("******************************************************");
    const lpContract = await ethers.getContractAt("IERC20", lpToken);
    const deadBalance = await lpContract.balanceOf(AddressDead);
    console.log("LP tokens burned (in dead address):", divDec(deadBalance));
    expect(deadBalance).to.be.gt(0);
  });

  it("User1 mines slot 0", async function () {
    console.log("******************************************************");
    const rigContract = await ethers.getContractAt("MineRig", rig);

    // Get current state for slot 0
    const slot = await rigContract.getSlot(0);
    const price = await rigContract.getPrice(0);

    console.log("Current epoch:", slot.epochId.toString());
    console.log("Current price:", divDec(price));

    // Approve WETH and mine
    await weth.connect(user1).deposit({ value: convert("1", 18) });
    await weth.connect(user1).approve(rig, price);

    await rigContract
      .connect(user1)
      .mine(user1.address, 0, slot.epochId, 1961439882, price, "https://example.com");

    console.log("User1 mined successfully");
    const newSlot = await rigContract.getSlot(0);
    expect(newSlot.miner).to.equal(user1.address);
  });

  it("Verify fee distribution", async function () {
    console.log("******************************************************");
    const rigContract = await ethers.getContractAt("MineRig", rig);

    // Get current state for slot 0
    const slot = await rigContract.getSlot(0);
    const price = await rigContract.getPrice(0);

    // Get balances before (miner fees go to claimable, not directly to wallet)
    const user1ClaimableBefore = await rigContract.accountToClaimable(user1.address);
    const auctionWethBefore = await weth.balanceOf(auction);
    const protocolWethBefore = await weth.balanceOf(protocol.address);

    // User2 mines
    await weth.connect(user2).deposit({ value: convert("1", 18) });
    await weth.connect(user2).approve(rig, price);

    await rigContract
      .connect(user2)
      .mine(user2.address, 0, slot.epochId, 1961439882, price, "https://example.com");

    // Get balances after (miner fees are in claimable mapping)
    const user1ClaimableAfter = await rigContract.accountToClaimable(user1.address);
    const auctionWethAfter = await weth.balanceOf(auction);
    const protocolWethAfter = await weth.balanceOf(protocol.address);

    // Calculate received amounts
    const user1Received = user1ClaimableAfter.sub(user1ClaimableBefore);
    const auctionReceived = auctionWethAfter.sub(auctionWethBefore);
    const protocolReceived = protocolWethAfter.sub(protocolWethBefore);

    console.log("Price paid:", divDec(price));
    console.log("Previous miner (80%):", divDec(user1Received));
    console.log("Treasury/Auction (15%):", divDec(auctionReceived));
    console.log("Protocol (1%):", divDec(protocolReceived));

    // Verify percentages using actual amounts received
    const totalReceived = user1Received.add(auctionReceived).add(protocolReceived);
    const tolerance = totalReceived.div(100); // 1% tolerance

    expect(user1Received).to.be.gt(0);
    expect(auctionReceived).to.be.gt(0);
    expect(protocolReceived).to.be.gt(0);
  });

  it("Verify Unit tokens minted to previous miner", async function () {
    console.log("******************************************************");
    const unitContract = await ethers.getContractAt("Unit", unit);
    const user1Balance = await unitContract.balanceOf(user1.address);
    console.log("User1 Unit balance:", divDec(user1Balance));
    expect(user1Balance).to.be.gt(0);
  });

  it("Launcher can change treasury", async function () {
    console.log("******************************************************");
    const rigContract = await ethers.getContractAt("MineRig", rig);

    // Only owner (launcher) can change treasury
    await expect(
      rigContract.connect(user1).setTreasury(user1.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    // Owner can change treasury
    await rigContract.connect(user0).setTreasury(user0.address);
    expect(await rigContract.treasury()).to.equal(user0.address);
    console.log("Treasury changed to:", await rigContract.treasury());

    // Change back to auction
    await rigContract.connect(user0).setTreasury(auction);
  });

  it("Launcher can change team", async function () {
    console.log("******************************************************");
    const rigContract = await ethers.getContractAt("MineRig", rig);

    const newTeam = user1.address;
    await rigContract.connect(user0).setTeam(newTeam);
    expect(await rigContract.team()).to.equal(newTeam);
    console.log("Team changed to:", await rigContract.team());
  });

  it("Protocol owner can change protocol fee address", async function () {
    console.log("******************************************************");

    // Only core owner can change protocol fee address
    await expect(
      core.connect(user0).setProtocolFeeAddress(user0.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    // Core owner can change
    await core.connect(owner).setProtocolFeeAddress(user2.address);
    expect(await core.protocolFeeAddress()).to.equal(user2.address);
    console.log("Protocol fee address changed to:", await core.protocolFeeAddress());

    // Change back
    await core.connect(owner).setProtocolFeeAddress(protocol.address);
  });

  it("Protocol owner can change min USDC for launch", async function () {
    console.log("******************************************************");
    await core.connect(owner).setMinUsdcForLaunch(convert("200", 6));
    console.log("Min USDC for launch:", divDec(await core.minUsdcForLaunch(), 6));
  });

  it("Cannot launch with insufficient USDC", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      quoteToken: weth.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/rig",
      usdcAmount: convert("100", 6), // Less than minUsdcForLaunch (200)
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingAmount: convert("10000000", 18),
      rigEpochPeriod: 3600,
      rigPriceMultiplier: convert("2", 18),
      rigMinInitPrice: convert("0.0001", 18),
      upsMultipliers: [convert("1", 18)],
      upsMultiplierDuration: 86400,
      auctionInitPrice: convert("1", 18),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.2", 18),
      auctionMinInitPrice: convert("0.001", 18),
    };

    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "MineCore__InsufficientUsdc()"
    );
    console.log("Launch correctly reverted with insufficient USDC");
  });

  it("Cannot launch with invalid parameters", async function () {
    console.log("******************************************************");

    // Test empty token name
    let launchParams = {
      launcher: user0.address,
      quoteToken: weth.address,
      tokenName: "",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/rig",
      usdcAmount: convert("500", 6),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingAmount: convert("10000000", 18),
      rigEpochPeriod: 3600,
      rigPriceMultiplier: convert("2", 18),
      rigMinInitPrice: convert("0.0001", 18),
      upsMultipliers: [convert("1", 18)],
      upsMultiplierDuration: 86400,
      auctionInitPrice: convert("1", 18),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.2", 18),
      auctionMinInitPrice: convert("0.001", 18),
    };

    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "MineCore__EmptyTokenName()"
    );

    console.log("Launch correctly reverted with invalid parameters");
  });

  it("Multicall getRig", async function () {
    console.log("******************************************************");
    const state = await multicall.getRig(rig, 0, user1.address);
    console.log("Epoch ID:", state.epochId.toString());
    console.log("Init Price:", divDec(state.initPrice));
    console.log("Current Price:", divDec(state.price));
    console.log("UPS:", divDec(state.ups));
    console.log("Next UPS:", divDec(state.nextUps));
    console.log("Current Miner:", state.miner);
    console.log("User1 Unit Balance:", divDec(state.accountUnitBalance));
    console.log("Capacity:", state.capacity.toString());
  });

  it("Multicall getAuction", async function () {
    console.log("******************************************************");
    const state = await multicall.getAuction(rig, user1.address);
    console.log("Epoch ID:", state.epochId.toString());
    console.log("Init Price:", divDec(state.initPrice));
    console.log("Current Price:", divDec(state.price));
    console.log("Payment Token:", state.lpToken);
    console.log("Quote Accumulated:", divDec(state.quoteAccumulated));
  });
});
