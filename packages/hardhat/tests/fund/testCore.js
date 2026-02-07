const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";
const AddressDead = "0x000000000000000000000000000000000000dEaD";

let owner, protocol, user0, user1, user2;
let usdc, registry, core;
let fundRig, auction, unit, lpToken;
let unitFactory, fundRigFactory, auctionFactory;
let uniswapFactory, uniswapRouter;

describe("FundCore Launch Tests", function () {
  before("Initial set up", async function () {
    await network.provider.send("hardhat_reset");
    console.log("Begin Initialization");

    [owner, protocol, user0, user1, user2] = await ethers.getSigners();

    // Deploy USDC (6 decimals) as quote token
    const usdcArtifact = await ethers.getContractFactory("MockUSDC");
    usdc = await usdcArtifact.deploy();
    console.log("- USDC Initialized");

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

    const fundRigFactoryArtifact = await ethers.getContractFactory("FundRigFactory");
    fundRigFactory = await fundRigFactoryArtifact.deploy();
    console.log("- FundRigFactory Initialized");

    const auctionFactoryArtifact = await ethers.getContractFactory("AuctionFactory");
    auctionFactory = await auctionFactoryArtifact.deploy();
    console.log("- AuctionFactory Initialized");

    // Deploy FundCore
    const coreArtifact = await ethers.getContractFactory("FundCore");
    core = await coreArtifact.deploy(
      registry.address,
      usdc.address,
      uniswapFactory.address,
      uniswapRouter.address,
      unitFactory.address,
      fundRigFactory.address,
      auctionFactory.address,
      protocol.address,
      convert("100", 6) // minUsdcForLaunch
    );
    console.log("- FundCore Initialized");

    // Approve FundCore as factory in Registry
    await registry.setFactoryApproval(core.address, true);
    console.log("- FundCore approved in Registry");

    // Mint USDC to user0 for launching
    await usdc.mint(user0.address, convert("1000", 6));
    console.log("- USDC minted to user0");

    console.log("Initialization Complete\n");
  });

  it("Core state is correct", async function () {
    console.log("******************************************************");
    expect(await core.protocolFeeAddress()).to.equal(protocol.address);
    expect(await core.usdcToken()).to.equal(usdc.address);
    expect(await core.minUsdcForLaunch()).to.equal(convert("100", 6));
    expect(await core.RIG_TYPE()).to.equal("fund");
    console.log("Core state verified");
  });

  it("Launch a new fund rig", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      quoteToken: usdc.address,
      recipient: user1.address, // recipient receives 50% of donations
      tokenName: "Test Unit",
      tokenSymbol: "TUNIT",
      uri: "https://example.com/fund",
      usdcAmount: convert("500", 6),
      unitAmount: convert("1000000", 18),
      initialEmission: convert("345600", 18), // 345,600 per day
      minEmission: convert("864", 18), // 864 per day
      halvingPeriod: 30, // 30 days
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
    const launchEvent = receipt.events.find((e) => e.event === "FundCore__Launched");
    fundRig = launchEvent.args.rig;
    unit = launchEvent.args.unit;
    auction = launchEvent.args.auction;
    lpToken = launchEvent.args.lpToken;

    console.log("FundRig deployed at:", fundRig);
    console.log("Unit token deployed at:", unit);
    console.log("Auction deployed at:", auction);
    console.log("LP Token at:", lpToken);

    // Verify registry
    expect(await core.rigToIsRig(fundRig)).to.equal(true);
    expect(await core.rigToAuction(fundRig)).to.equal(auction);
    expect(await core.rigs(0)).to.equal(fundRig);
    expect(await core.rigsLength()).to.equal(1);
    expect(await core.rigToIndex(fundRig)).to.equal(0);
    expect(await core.rigToLP(fundRig)).to.equal(lpToken);
  });

  it("FundRig ownership transferred to launcher", async function () {
    console.log("******************************************************");
    const rigContract = await ethers.getContractAt("FundRig", fundRig);
    expect(await rigContract.owner()).to.equal(user0.address);
    console.log("FundRig owner:", await rigContract.owner());
  });

  it("Unit minting rights transferred to FundRig", async function () {
    console.log("******************************************************");
    const unitContract = await ethers.getContractAt("Unit", unit);
    expect(await unitContract.rig()).to.equal(fundRig);
    console.log("Unit rig:", await unitContract.rig());
  });

  it("LP tokens burned", async function () {
    console.log("******************************************************");
    const lpContract = await ethers.getContractAt("IERC20", lpToken);
    const deadBalance = await lpContract.balanceOf(AddressDead);
    console.log("LP tokens burned (in dead address):", divDec(deadBalance));
    expect(deadBalance).to.be.gt(0);
  });

  it("FundRig parameters correct", async function () {
    console.log("******************************************************");
    const rigContract = await ethers.getContractAt("FundRig", fundRig);

    expect(await rigContract.unit()).to.equal(unit);
    expect(await rigContract.quote()).to.equal(usdc.address);
    expect(await rigContract.treasury()).to.equal(auction); // treasury = auction
    expect(await rigContract.team()).to.equal(user0.address); // team = launcher
    expect(await rigContract.core()).to.equal(core.address);
    expect(await rigContract.initialEmission()).to.equal(convert("345600", 18));
    expect(await rigContract.minEmission()).to.equal(convert("864", 18));

    console.log("FundRig parameters verified");
  });

  it("Cannot launch with insufficient USDC", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      quoteToken: usdc.address,
      recipient: user1.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/fund",
      usdcAmount: convert("50", 6), // Less than minUsdcForLaunch (100)
      unitAmount: convert("1000000", 18),
      initialEmission: convert("345600", 18),
      minEmission: convert("864", 18),
      halvingPeriod: 30,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "FundCore__InsufficientUsdc()"
    );
    console.log("Launch correctly reverted with insufficient USDC");
  });

  it("Cannot launch with zero launcher address", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: AddressZero,
      quoteToken: usdc.address,
      recipient: user1.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/fund",
      usdcAmount: convert("500", 6),
      unitAmount: convert("1000000", 18),
      initialEmission: convert("345600", 18),
      minEmission: convert("864", 18),
      halvingPeriod: 30,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "FundCore__ZeroLauncher()"
    );
    console.log("Launch correctly reverted with zero launcher address");
  });

  it("Cannot launch with zero quote token", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      quoteToken: AddressZero,
      recipient: user1.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/fund",
      usdcAmount: convert("500", 6),
      unitAmount: convert("1000000", 18),
      initialEmission: convert("345600", 18),
      minEmission: convert("864", 18),
      halvingPeriod: 30,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "FundCore__ZeroQuoteToken()"
    );
    console.log("Launch correctly reverted with zero quote token");
  });

  it("Cannot launch with empty token name", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      quoteToken: usdc.address,
      recipient: user1.address,
      tokenName: "",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/fund",
      usdcAmount: convert("500", 6),
      unitAmount: convert("1000000", 18),
      initialEmission: convert("345600", 18),
      minEmission: convert("864", 18),
      halvingPeriod: 30,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "FundCore__EmptyTokenName()"
    );
    console.log("Launch correctly reverted with empty token name");
  });

  it("Cannot launch with empty token symbol", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      quoteToken: usdc.address,
      recipient: user1.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "",
      uri: "https://example.com/fund",
      usdcAmount: convert("500", 6),
      unitAmount: convert("1000000", 18),
      initialEmission: convert("345600", 18),
      minEmission: convert("864", 18),
      halvingPeriod: 30,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "FundCore__EmptyTokenSymbol()"
    );
    console.log("Launch correctly reverted with empty token symbol");
  });

  it("Cannot launch with zero unit amount", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      quoteToken: usdc.address,
      recipient: user1.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/fund",
      usdcAmount: convert("500", 6),
      unitAmount: 0,
      initialEmission: convert("345600", 18),
      minEmission: convert("864", 18),
      halvingPeriod: 30,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "FundCore__ZeroUnitAmount()"
    );
    console.log("Launch correctly reverted with zero unit amount");
  });

  it("Cannot launch with invalid emission parameters", async function () {
    console.log("******************************************************");

    // minEmission > initialEmission
    const launchParams = {
      launcher: user0.address,
      quoteToken: usdc.address,
      recipient: user1.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/fund",
      usdcAmount: convert("500", 6),
      unitAmount: convert("1000000", 18),
      initialEmission: convert("100", 18),
      minEmission: convert("200", 18), // greater than initial
      halvingPeriod: 30,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "FundRig__EmissionOutOfRange()"
    );
    console.log("Launch correctly reverted with invalid emission");
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

    await expect(
      core.connect(user0).setMinUsdcForLaunch(convert("200", 6))
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await core.connect(owner).setMinUsdcForLaunch(convert("200", 6));
    expect(await core.minUsdcForLaunch()).to.equal(convert("200", 6));
    console.log("Min USDC for launch:", divDec(await core.minUsdcForLaunch()));

    // Change back
    await core.connect(owner).setMinUsdcForLaunch(convert("100", 6));
  });

  it("Can launch multiple fund rigs", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user1.address,
      quoteToken: usdc.address,
      recipient: user2.address,
      tokenName: "Second Unit",
      tokenSymbol: "SUNIT",
      uri: "https://example.com/fund2",
      usdcAmount: convert("500", 6),
      unitAmount: convert("2000000", 18),
      initialEmission: convert("172800", 18), // different emission
      minEmission: convert("432", 18),
      halvingPeriod: 30,
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

  });
});
