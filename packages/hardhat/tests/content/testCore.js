const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const divDec6 = (amount) => amount / 10 ** 6;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";
const AddressDead = "0x000000000000000000000000000000000000dEaD";

let owner, protocol, user0, user1, user2;
let usdc, donut, registry, core;
let content, minter, rewarder, auction, unit, lpToken;
let unitFactory, contentFactory, minterFactory, rewarderFactory, auctionFactory;
let uniswapFactory, uniswapRouter;

describe("Core Launch Tests", function () {
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

    const contentFactoryArtifact = await ethers.getContractFactory("ContentRigFactory");
    contentFactory = await contentFactoryArtifact.deploy();
    console.log("- ContentRigFactory Initialized");

    const minterFactoryArtifact = await ethers.getContractFactory("MinterFactory");
    minterFactory = await minterFactoryArtifact.deploy();
    console.log("- MinterFactory Initialized");

    const rewarderFactoryArtifact = await ethers.getContractFactory("RewarderFactory");
    rewarderFactory = await rewarderFactoryArtifact.deploy();
    console.log("- RewarderFactory Initialized");

    const auctionFactoryArtifact = await ethers.getContractFactory("AuctionFactory");
    auctionFactory = await auctionFactoryArtifact.deploy();
    console.log("- AuctionFactory Initialized");

    // Deploy ContentCore
    const coreArtifact = await ethers.getContractFactory("ContentCore");
    core = await coreArtifact.deploy(
      registry.address,
      usdc.address,
      donut.address,
      uniswapFactory.address,
      uniswapRouter.address,
      unitFactory.address,
      contentFactory.address,
      minterFactory.address,
      auctionFactory.address,
      rewarderFactory.address,
      protocol.address,
      convert("100", 18) // minDonutForLaunch
    );
    console.log("- ContentCore Initialized");

    // Approve ContentCore as factory in Registry
    await registry.setFactoryApproval(core.address, true);
    console.log("- ContentCore approved in Registry");

    // Mint DONUT to user0 for launching
    await donut.connect(user0).deposit({ value: convert("1000", 18) });
    console.log("- DONUT minted to user0");

    console.log("Initialization Complete\n");
  });

  it("Core state is correct", async function () {
    console.log("******************************************************");
    expect(await core.protocolFeeAddress()).to.equal(protocol.address);
    expect(await core.donutToken()).to.equal(donut.address);
    expect(await core.quote()).to.equal(usdc.address);
    expect(await core.minDonutForLaunch()).to.equal(convert("100", 18));
    expect(await core.deployedRigsLength()).to.equal(0);
    console.log("Core state verified");
  });

  it("Launch a new content engine", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      tokenName: "Test Unit",
      tokenSymbol: "TUNIT",
      uri: "https://example.com/metadata",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18), // 4 tokens per second
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 7, // 7 days (minimum)
      contentMinInitPrice: convert("1", 6),
      contentIsModerated: false,
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
    const launchEvent = receipt.events.find((e) => e.event === "ContentCore__Launched");
    content = launchEvent.args.rig;
    unit = launchEvent.args.unit;
    minter = launchEvent.args.minter;
    rewarder = launchEvent.args.rewarder;
    auction = launchEvent.args.auction;
    lpToken = launchEvent.args.lpToken;

    console.log("ContentRig deployed at:", content);
    console.log("Unit token deployed at:", unit);
    console.log("Minter deployed at:", minter);
    console.log("Rewarder deployed at:", rewarder);
    console.log("Auction deployed at:", auction);
    console.log("LP Token at:", lpToken);

    // Verify registry
    expect(await core.isDeployedRig(content)).to.equal(true);
    expect(await core.rigToLauncher(content)).to.equal(user0.address);
    expect(await core.rigToUnit(content)).to.equal(unit);
    expect(await core.rigToMinter(content)).to.equal(minter);
    expect(await core.rigToRewarder(content)).to.equal(rewarder);
    expect(await core.rigToAuction(content)).to.equal(auction);
    expect(await core.rigToLP(content)).to.equal(lpToken);
    expect(await core.deployedRigsLength()).to.equal(1);
  });

  it("Content ownership transferred to launcher", async function () {
    console.log("******************************************************");
    const contentContract = await ethers.getContractAt("ContentRig", content);
    expect(await contentContract.owner()).to.equal(user0.address);
    console.log("Content owner:", await contentContract.owner());
  });

  it("Unit minting rights transferred to Minter", async function () {
    console.log("******************************************************");
    const unitContract = await ethers.getContractAt("Unit", unit);
    expect(await unitContract.rig()).to.equal(minter);
    console.log("Unit minter (rig):", await unitContract.rig());
  });

  it("LP tokens burned", async function () {
    console.log("******************************************************");
    const lpContract = await ethers.getContractAt("IERC20", lpToken);
    const deadBalance = await lpContract.balanceOf(AddressDead);
    console.log("LP tokens burned (in dead address):", divDec(deadBalance));
    expect(deadBalance).to.be.gt(0);
  });

  it("Rewarder linked to Content", async function () {
    console.log("******************************************************");
    const rewarderContract = await ethers.getContractAt("Rewarder", rewarder);
    expect(await rewarderContract.content()).to.equal(content);
    console.log("Rewarder content:", await rewarderContract.content());
  });

  it("Minter linked to Rewarder", async function () {
    console.log("******************************************************");
    const minterContract = await ethers.getContractAt("Minter", minter);
    expect(await minterContract.rewarder()).to.equal(rewarder);
    console.log("Minter rewarder:", await minterContract.rewarder());
  });

  it("Content parameters correct", async function () {
    console.log("******************************************************");
    const contentContract = await ethers.getContractAt("ContentRig", content);

    expect(await contentContract.unit()).to.equal(unit);
    expect(await contentContract.quote()).to.equal(usdc.address);
    expect(await contentContract.treasury()).to.equal(auction);
    expect(await contentContract.core()).to.equal(core.address);
    expect(await contentContract.minInitPrice()).to.equal(convert("1", 6));
    expect(await contentContract.isModerated()).to.equal(false);

    console.log("Content parameters verified");
  });

  it("Minter parameters correct", async function () {
    console.log("******************************************************");
    const minterContract = await ethers.getContractAt("Minter", minter);

    expect(await minterContract.unit()).to.equal(unit);
    expect(await minterContract.rewarder()).to.equal(rewarder);
    expect(await minterContract.initialUps()).to.equal(convert("4", 18));
    expect(await minterContract.tailUps()).to.equal(convert("0.01", 18));
    expect(await minterContract.halvingPeriod()).to.equal(86400 * 7);

    console.log("Minter parameters verified");
  });

  it("Cannot launch with insufficient DONUT", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/metadata2",
      donutAmount: convert("50", 18), // Less than minDonutForLaunch (100)
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 7,
      contentMinInitPrice: convert("1", 6),
      contentIsModerated: false,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "ContentCore__InsufficientDonut()"
    );
    console.log("Launch correctly reverted with insufficient DONUT");
  });

  it("Cannot launch with zero launcher address", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: AddressZero,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/metadata2",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 7,
      contentMinInitPrice: convert("1", 6),
      contentIsModerated: false,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "ContentCore__InvalidLauncher()"
    );
    console.log("Launch correctly reverted with zero launcher address");
  });

  it("Cannot launch with empty token name", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      tokenName: "",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/metadata2",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 7,
      contentMinInitPrice: convert("1", 6),
      contentIsModerated: false,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "ContentCore__EmptyTokenName()"
    );
    console.log("Launch correctly reverted with empty token name");
  });

  it("Cannot launch with empty token symbol", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "",
      uri: "https://example.com/metadata2",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 7,
      contentMinInitPrice: convert("1", 6),
      contentIsModerated: false,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "ContentCore__EmptyTokenSymbol()"
    );
    console.log("Launch correctly reverted with empty token symbol");
  });

  it("Cannot launch with zero unit amount", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/metadata2",
      donutAmount: convert("500", 18),
      unitAmount: 0,
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 7,
      contentMinInitPrice: convert("1", 6),
      contentIsModerated: false,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "ContentCore__InvalidUnitAmount()"
    );
    console.log("Launch correctly reverted with zero unit amount");
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

  it("Can launch multiple content engines", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user1.address,
      tokenName: "Second Unit",
      tokenSymbol: "SUNIT",
      uri: "https://example.com/metadata2",
      donutAmount: convert("500", 18),
      unitAmount: convert("2000000", 18),
      initialUps: convert("2", 18),
      tailUps: convert("0.005", 18),
      halvingPeriod: 86400 * 14, // 14 days
      contentMinInitPrice: convert("100", 6),
      contentIsModerated: true, // moderated
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
    console.log("Second content engine launched. Total:", (await core.deployedRigsLength()).toString());
  });

  it("Cannot launch with invalid halving period", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/metadata2",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400, // 1 day - below minimum of 7 days
      contentMinInitPrice: convert("1", 6),
      contentIsModerated: false,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "ContentCore__HalvingPeriodOutOfRange()"
    );
    console.log("Launch correctly reverted with invalid halving period");
  });

  it("Cannot launch with zero initialUps", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/metadata2",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: 0,
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 7,
      contentMinInitPrice: convert("1", 6),
      contentIsModerated: false,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "ContentCore__InitialUpsOutOfRange()"
    );
    console.log("Launch correctly reverted with zero initialUps");
  });

  it("Cannot launch with tailUps greater than initialUps", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/metadata2",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("1", 18),
      tailUps: convert("2", 18), // Greater than initialUps
      halvingPeriod: 86400 * 7,
      contentMinInitPrice: convert("1", 6),
      contentIsModerated: false,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "ContentCore__TailUpsOutOfRange()"
    );
    console.log("Launch correctly reverted with tailUps greater than initialUps");
  });

  it("Cannot launch with contentMinInitPrice too low", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/metadata2",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 7,
      contentMinInitPrice: 100, // Below ABS_MIN_INIT_PRICE (1e6)
      contentIsModerated: false,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "ContentCore__ContentMinInitPriceOutOfRange()"
    );
    console.log("Launch correctly reverted with contentMinInitPrice too low");
  });

  it("Cannot launch with auction epoch period too short", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/metadata2",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 7,
      contentMinInitPrice: convert("1", 6),
      contentIsModerated: false,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 60, // 1 minute - below minimum of 1 hour
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "ContentCore__AuctionEpochPeriodOutOfRange()"
    );
    console.log("Launch correctly reverted with auction epoch period too short");
  });

  it("Cannot launch with auction price multiplier too low", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/metadata2",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 7,
      contentMinInitPrice: convert("1", 6),
      contentIsModerated: false,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1", 18), // 1x - below minimum of 1.1x
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "ContentCore__AuctionPriceMultiplierOutOfRange()"
    );
    console.log("Launch correctly reverted with auction price multiplier too low");
  });

  it("Cannot launch with auction init price below min init price", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "https://example.com/metadata2",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 7,
      contentMinInitPrice: convert("1", 6),
      contentIsModerated: false,
      auctionInitPrice: convert("0.5", 6), // Below auctionMinInitPrice
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "ContentCore__AuctionInitPriceOutOfRange()"
    );
    console.log("Launch correctly reverted with auction init price below min init price");
  });
});
