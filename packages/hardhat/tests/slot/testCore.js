const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";
const AddressDead = "0x000000000000000000000000000000000000dEaD";

let owner, protocol, user0, user1, user2;
let usdc, donut, registry, core;
let slotRig, auction, unit, lpToken;
let unitFactory, slotRigFactory, auctionFactory;
let uniswapFactory, uniswapRouter;
let mockEntropy;

describe("SlotCore Launch Tests", function () {
  before("Initial set up", async function () {
    await network.provider.send("hardhat_reset");
    console.log("Begin Initialization");

    [owner, protocol, user0, user1, user2] = await ethers.getSigners();

    // Deploy USDC (6 decimals) as quote token
    const usdcArtifact = await ethers.getContractFactory("MockUSDC");
    usdc = await usdcArtifact.deploy();
    console.log("- USDC Initialized");

    // Deploy mock DONUT token
    const donutArtifact = await ethers.getContractFactory("MockWETH");
    donut = await donutArtifact.deploy();
    console.log("- DONUT Initialized");

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

    const slotRigFactoryArtifact = await ethers.getContractFactory("SlotRigFactory");
    slotRigFactory = await slotRigFactoryArtifact.deploy();
    console.log("- SlotRigFactory Initialized");

    const auctionFactoryArtifact = await ethers.getContractFactory("AuctionFactory");
    auctionFactory = await auctionFactoryArtifact.deploy();
    console.log("- AuctionFactory Initialized");

    // Deploy SlotCore
    const coreArtifact = await ethers.getContractFactory("SlotCore");
    core = await coreArtifact.deploy(
      registry.address,
      donut.address,
      uniswapFactory.address,
      uniswapRouter.address,
      unitFactory.address,
      slotRigFactory.address,
      auctionFactory.address,
      mockEntropy.address,
      protocol.address,
      convert("100", 18) // minDonutForLaunch
    );
    console.log("- SlotCore Initialized");

    // Approve SlotCore as factory in Registry
    await registry.setFactoryApproval(core.address, true);
    console.log("- SlotCore approved in Registry");

    // Mint DONUT to user0 for launching
    await donut.connect(user0).deposit({ value: convert("1000", 18) });
    console.log("- DONUT minted to user0");

    console.log("Initialization Complete\n");
  });

  it("Core state is correct", async function () {
    console.log("******************************************************");
    expect(await core.protocolFeeAddress()).to.equal(protocol.address);
    expect(await core.donutToken()).to.equal(donut.address);
    expect(await core.entropy()).to.equal(mockEntropy.address);
    expect(await core.minDonutForLaunch()).to.equal(convert("100", 18));
    expect(await core.deployedRigsLength()).to.equal(0);
    expect(await core.RIG_TYPE()).to.equal("slot");
    console.log("Core state verified");
  });

  it("Launch a new slot rig", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      quoteToken: usdc.address,
      tokenName: "Test Unit",
      tokenSymbol: "TUNIT",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18), // 4 tokens per second
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 30, // 30 days
      rigEpochPeriod: 3600, // 1 hour
      rigPriceMultiplier: convert("2", 18),
      rigMinInitPrice: convert("1", 6),
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400, // 1 day
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    // Approve DONUT
    await donut.connect(user0).approve(core.address, launchParams.donutAmount);

    // Launch
    const tx = await core.connect(user0).launch(launchParams);
    const receipt = await tx.wait();

    // Get deployed addresses from event
    const launchEvent = receipt.events.find((e) => e.event === "SlotCore__Launched");
    slotRig = launchEvent.args.rig;
    unit = launchEvent.args.unit;
    auction = launchEvent.args.auction;
    lpToken = launchEvent.args.lpToken;

    console.log("SlotRig deployed at:", slotRig);
    console.log("Unit token deployed at:", unit);
    console.log("Auction deployed at:", auction);
    console.log("LP Token at:", lpToken);

    // Verify registry
    expect(await core.isDeployedRig(slotRig)).to.equal(true);
    expect(await core.rigToLauncher(slotRig)).to.equal(user0.address);
    expect(await core.rigToUnit(slotRig)).to.equal(unit);
    expect(await core.rigToAuction(slotRig)).to.equal(auction);
    expect(await core.rigToLP(slotRig)).to.equal(lpToken);
    expect(await core.rigToQuote(slotRig)).to.equal(usdc.address);
    expect(await core.deployedRigsLength()).to.equal(1);
  });

  it("SlotRig ownership transferred to launcher", async function () {
    console.log("******************************************************");
    const rigContract = await ethers.getContractAt("SlotRig", slotRig);
    expect(await rigContract.owner()).to.equal(user0.address);
    console.log("SlotRig owner:", await rigContract.owner());
  });

  it("Unit minting rights transferred to SlotRig", async function () {
    console.log("******************************************************");
    const unitContract = await ethers.getContractAt("Unit", unit);
    expect(await unitContract.rig()).to.equal(slotRig);
    console.log("Unit rig:", await unitContract.rig());
  });

  it("LP tokens burned", async function () {
    console.log("******************************************************");
    const lpContract = await ethers.getContractAt("IERC20", lpToken);
    const deadBalance = await lpContract.balanceOf(AddressDead);
    console.log("LP tokens burned (in dead address):", divDec(deadBalance));
    expect(deadBalance).to.be.gt(0);
  });

  it("SlotRig parameters correct", async function () {
    console.log("******************************************************");
    const rigContract = await ethers.getContractAt("SlotRig", slotRig);

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

    console.log("SlotRig parameters verified");
  });

  it("Cannot launch with insufficient DONUT", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      quoteToken: usdc.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      donutAmount: convert("50", 18), // Less than minDonutForLaunch (100)
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 30,
      rigEpochPeriod: 3600,
      rigPriceMultiplier: convert("2", 18),
      rigMinInitPrice: convert("1", 6),
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "SlotCore__InsufficientDonut()"
    );
    console.log("Launch correctly reverted with insufficient DONUT");
  });

  it("Cannot launch with zero launcher address", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: AddressZero,
      quoteToken: usdc.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 30,
      rigEpochPeriod: 3600,
      rigPriceMultiplier: convert("2", 18),
      rigMinInitPrice: convert("1", 6),
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "SlotCore__ZeroLauncher()"
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
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400, // 1 day - below minimum of 7 days
      rigEpochPeriod: 3600,
      rigPriceMultiplier: convert("2", 18),
      rigMinInitPrice: convert("1", 6),
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "SlotCore__RigHalvingPeriodOutOfRange()"
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

  it("Protocol owner can change min DONUT for launch", async function () {
    console.log("******************************************************");

    await expect(
      core.connect(user0).setMinDonutForLaunch(convert("200", 18))
    ).to.be.revertedWith("Ownable: caller is not the owner");

    await core.connect(owner).setMinDonutForLaunch(convert("200", 18));
    expect(await core.minDonutForLaunch()).to.equal(convert("200", 18));
    console.log("Min DONUT for launch:", divDec(await core.minDonutForLaunch()));

    // Change back
    await core.connect(owner).setMinDonutForLaunch(convert("100", 18));
  });

  it("Can launch multiple slot rigs", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user1.address,
      quoteToken: usdc.address,
      tokenName: "Second Unit",
      tokenSymbol: "SUNIT",
      donutAmount: convert("500", 18),
      unitAmount: convert("2000000", 18),
      initialUps: convert("2", 18),
      tailUps: convert("0.005", 18),
      halvingPeriod: 86400 * 14, // 14 days
      rigEpochPeriod: 7200, // 2 hours
      rigPriceMultiplier: convert("1.5", 18),
      rigMinInitPrice: convert("100", 6),
      auctionInitPrice: convert("2000", 6),
      auctionEpochPeriod: 86400 * 2,
      auctionPriceMultiplier: convert("2", 18),
      auctionMinInitPrice: convert("10", 6),
    };

    // Mint and approve DONUT for user1
    await donut.connect(user1).deposit({ value: convert("1000", 18) });
    await donut.connect(user1).approve(core.address, launchParams.donutAmount);

    const tx = await core.connect(user1).launch(launchParams);
    await tx.wait();

    expect(await core.deployedRigsLength()).to.equal(2);
    console.log("Second slot rig launched. Total:", (await core.deployedRigsLength()).toString());
  });
});
