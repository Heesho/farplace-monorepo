const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";
const AddressDead = "0x000000000000000000000000000000000000dEaD";

let owner, protocol, user0, user1, user2;
let usdc, registry, core;
let spinRig, auction, unit, lpToken;
let unitFactory, auctionFactory;
let uniswapFactory, uniswapRouter;
let mockEntropy;

describe("SpinCore Launch Tests", function () {
  before("Initial set up", async function () {
    await network.provider.send("hardhat_reset");
    console.log("Begin Initialization");

    [owner, protocol, user0, user1, user2] = await ethers.getSigners();

    // Deploy USDC (6 decimals) as quote token
    const usdcArtifact = await ethers.getContractFactory("MockUSDC");
    usdc = await usdcArtifact.deploy();
    console.log("- USDC Initialized");

    // Deploy mock Entropy
    const mockEntropyArtifact = await ethers.getContractFactory("MockEntropy");
    mockEntropy = await mockEntropyArtifact.deploy();
    console.log("- MockEntropy Initialized");

    // Deploy mock Uniswap V2 Factory and Router
    const mockUniswapFactoryArtifact = await ethers.getContractFactory("MockUniswapV2Factory");
    uniswapFactory = await mockUniswapFactoryArtifact.deploy();
    console.log("- Uniswap V2 Factory Initialized");

    const mockUniswapRouterArtifact = await ethers.getContractFactory("MockUniswapV2Router");
    uniswapRouter = await mockUniswapRouterArtifact.deploy(uniswapFactory.address);
    console.log("- Uniswap V2 Router Initialized");

    // Deploy Registry
    const registryArtifact = await ethers.getContractFactory("Registry");
    registry = await registryArtifact.deploy();
    console.log("- Registry Initialized");

    // Deploy factories
    const unitFactoryArtifact = await ethers.getContractFactory("UnitFactory");
    unitFactory = await unitFactoryArtifact.deploy();
    console.log("- UnitFactory Initialized");

    const auctionFactoryArtifact = await ethers.getContractFactory("AuctionFactory");
    auctionFactory = await auctionFactoryArtifact.deploy();
    console.log("- AuctionFactory Initialized");

    // Deploy SpinCore
    const coreArtifact = await ethers.getContractFactory("SpinCore");
    core = await coreArtifact.deploy(
      registry.address,
      usdc.address,
      uniswapFactory.address,
      uniswapRouter.address,
      unitFactory.address,
      auctionFactory.address,
      mockEntropy.address,
      protocol.address,
      convert("100", 6) // minUsdcForLaunch
    );
    console.log("- SpinCore Initialized");

    // Approve SpinCore as factory in Registry
    await registry.setFactoryApproval(core.address, true);
    console.log("- SpinCore approved in Registry");

    // Mint USDC to user0 for launching
    await usdc.mint(user0.address, convert("1000", 6));
    console.log("- USDC minted to user0");

    console.log("Initialization Complete\n");
  });

  it("Core state is correct", async function () {
    console.log("******************************************************");
    expect(await core.protocolFeeAddress()).to.equal(protocol.address);
    expect(await core.usdcToken()).to.equal(usdc.address);
    expect(await core.entropy()).to.equal(mockEntropy.address);
    expect(await core.minUsdcForLaunch()).to.equal(convert("100", 6));
    expect(await core.RIG_TYPE()).to.equal("spin");
    console.log("Core state verified");
  });

  it("Launch a new spin rig", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      quoteToken: usdc.address,
      tokenName: "Test Unit",
      tokenSymbol: "TUNIT",
      uri: "https://example.com/rig",
      usdcAmount: convert("500", 6),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18), // 4 tokens per second
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 30, // 30 days
      rigEpochPeriod: 3600, // 1 hour
      rigPriceMultiplier: convert("2", 18),
      rigMinInitPrice: convert("1", 6),
      odds: [10],
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400, // 1 day
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    // Approve USDC
    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);

    // Launch
    const tx = await core.connect(user0).launch(launchParams);
    const receipt = await tx.wait();

    // Get deployed addresses from event
    const launchEvent = receipt.events.find((e) => e.event === "SpinCore__Launched");
    spinRig = launchEvent.args.rig;
    unit = launchEvent.args.unit;
    auction = launchEvent.args.auction;
    lpToken = launchEvent.args.lpToken;

    console.log("SpinRig deployed at:", spinRig);
    console.log("Unit token deployed at:", unit);
    console.log("Auction deployed at:", auction);
    console.log("LP Token at:", lpToken);

    // Verify registry
    expect(await core.rigToIsRig(spinRig)).to.equal(true);
    expect(await core.rigToAuction(spinRig)).to.equal(auction);
    expect(await core.rigs(0)).to.equal(spinRig);
    expect(await core.rigsLength()).to.equal(1);
    expect(await core.rigToIndex(spinRig)).to.equal(0);
    expect(await core.rigToLP(spinRig)).to.equal(lpToken);
  });

  it("SpinRig ownership transferred to launcher", async function () {
    console.log("******************************************************");
    const rigContract = await ethers.getContractAt("SpinRig", spinRig);
    expect(await rigContract.owner()).to.equal(user0.address);
    console.log("SpinRig owner:", await rigContract.owner());
  });

  it("Unit minting rights transferred to SpinRig", async function () {
    console.log("******************************************************");
    const unitContract = await ethers.getContractAt("Unit", unit);
    expect(await unitContract.rig()).to.equal(spinRig);
    console.log("Unit rig:", await unitContract.rig());
  });

  it("LP tokens burned", async function () {
    console.log("******************************************************");
    const lpContract = await ethers.getContractAt("IERC20", lpToken);
    const deadBalance = await lpContract.balanceOf(AddressDead);
    console.log("LP tokens burned (in dead address):", divDec(deadBalance));
    expect(deadBalance).to.be.gt(0);
  });

  it("SpinRig parameters correct", async function () {
    console.log("******************************************************");
    const rigContract = await ethers.getContractAt("SpinRig", spinRig);

    expect(await rigContract.unit()).to.equal(unit);
    expect(await rigContract.quote()).to.equal(usdc.address);
    expect(await rigContract.treasury()).to.equal(auction); // treasury = auction
    expect(await rigContract.core()).to.equal(core.address);
    expect(await rigContract.initialUps()).to.equal(convert("4", 18));
    expect(await rigContract.tailUps()).to.equal(convert("0.01", 18));
    expect(await rigContract.halvingPeriod()).to.equal(86400 * 30);
    expect(await rigContract.epochPeriod()).to.equal(3600);
    expect(await rigContract.priceMultiplier()).to.equal(convert("2", 18));
    expect(await rigContract.minInitPrice()).to.equal(convert("1", 6));

    console.log("SpinRig parameters verified");
  });

  it("Cannot launch with insufficient USDC", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      quoteToken: usdc.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/rig2",
      usdcAmount: convert("50", 6), // Less than minUsdcForLaunch (100)
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 30,
      rigEpochPeriod: 3600,
      rigPriceMultiplier: convert("2", 18),
      rigMinInitPrice: convert("1", 6),
      odds: [10],
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "SpinCore__InsufficientUsdc()"
    );
    console.log("Launch correctly reverted with insufficient USDC");
  });

  it("Cannot launch with zero launcher address", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: AddressZero,
      quoteToken: usdc.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/rig2",
      usdcAmount: convert("500", 6),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 30,
      rigEpochPeriod: 3600,
      rigPriceMultiplier: convert("2", 18),
      rigMinInitPrice: convert("1", 6),
      odds: [10],
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "SpinCore__ZeroAddress()"
    );
    console.log("Launch correctly reverted with zero launcher address");
  });

  it("Cannot launch with invalid halving period", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      quoteToken: usdc.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/rig2",
      usdcAmount: convert("500", 6),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400, // 1 day - below minimum of 7 days
      rigEpochPeriod: 3600,
      rigPriceMultiplier: convert("2", 18),
      rigMinInitPrice: convert("1", 6),
      odds: [10],
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "SpinRig__HalvingPeriodOutOfRange()"
    );
    console.log("Launch correctly reverted with invalid halving period");
  });

  it("Protocol owner can change protocol fee address", async function () {
    console.log("******************************************************");

    await expect(
      core.connect(user0).setProtocolFeeAddress(user0.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await core.connect(owner).setProtocolFeeAddress(user2.address);
    expect(await core.protocolFeeAddress()).to.equal(user2.address);
    console.log("Protocol fee address changed to:", await core.protocolFeeAddress());

    // Change back
    await core.connect(owner).setProtocolFeeAddress(protocol.address);
  });

  it("Protocol owner can change min USDC for launch", async function () {
    console.log("******************************************************");

    await expect(
      core.connect(user0).setMinUsdcForLaunch(convert("200", 6))
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await core.connect(owner).setMinUsdcForLaunch(convert("200", 6));
    expect(await core.minUsdcForLaunch()).to.equal(convert("200", 6));
    console.log("Min USDC for launch:", divDec(await core.minUsdcForLaunch(), 6));

    // Change back
    await core.connect(owner).setMinUsdcForLaunch(convert("100", 6));
  });

  it("Can launch multiple spin rigs", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user1.address,
      quoteToken: usdc.address,
      tokenName: "Second Unit",
      tokenSymbol: "SUNIT",
      uri: "https://example.com/rig-second",
      usdcAmount: convert("500", 6),
      unitAmount: convert("2000000", 18),
      initialUps: convert("2", 18),
      tailUps: convert("0.005", 18),
      halvingPeriod: 86400 * 14, // 14 days
      rigEpochPeriod: 7200, // 2 hours
      rigPriceMultiplier: convert("1.5", 18),
      rigMinInitPrice: convert("100", 6),
      odds: [10],
      auctionInitPrice: convert("2000", 6),
      auctionEpochPeriod: 86400 * 2,
      auctionPriceMultiplier: convert("2", 18),
      auctionMinInitPrice: convert("10", 6),
    };

    // Mint and approve USDC for user1
    await usdc.mint(user1.address, convert("1000", 6));
    await usdc.connect(user1).approve(core.address, launchParams.usdcAmount);

    const tx = await core.connect(user1).launch(launchParams);
    await tx.wait();

    console.log("Second spin rig launched.");
  });
});
