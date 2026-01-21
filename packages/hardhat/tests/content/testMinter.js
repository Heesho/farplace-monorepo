const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const divDec6 = (amount) => amount / 10 ** 6;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";

let owner, protocol, user0, user1, user2, creator1;
let usdc, donut, registry, core;
let content, minter, rewarder, auction, unit, lpToken;
let unitFactory, contentFactory, minterFactory, rewarderFactory, auctionFactory;
let uniswapFactory, uniswapRouter;

const WEEK = 86400 * 7;

describe("Minter Tests", function () {
  before("Initial set up", async function () {
    await network.provider.send("hardhat_reset");
    console.log("Begin Initialization");

    [owner, protocol, user0, user1, user2, creator1] = await ethers.getSigners();

    // Deploy USDC (6 decimals) as quote token
    const usdcArtifact = await ethers.getContractFactory("MockUSDC");
    usdc = await usdcArtifact.deploy();

    const donutArtifact = await ethers.getContractFactory("MockWETH");
    donut = await donutArtifact.deploy();

    // Deploy mock Uniswap
    uniswapFactory = await (await ethers.getContractFactory("MockUniswapV2Factory")).deploy();
    uniswapRouter = await (await ethers.getContractFactory("MockUniswapV2Router")).deploy(uniswapFactory.address);

    // Deploy Registry
    registry = await (await ethers.getContractFactory("Registry")).deploy();

    // Deploy factories
    unitFactory = await (await ethers.getContractFactory("UnitFactory")).deploy();
    contentFactory = await (await ethers.getContractFactory("ContentRigFactory")).deploy();
    minterFactory = await (await ethers.getContractFactory("MinterFactory")).deploy();
    rewarderFactory = await (await ethers.getContractFactory("RewarderFactory")).deploy();
    auctionFactory = await (await ethers.getContractFactory("AuctionFactory")).deploy();

    // Deploy ContentCore
    core = await (await ethers.getContractFactory("ContentCore")).deploy(
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
      convert("100", 18)
    );

    // Approve ContentCore as factory in Registry
    await registry.setFactoryApproval(core.address, true);

    // Mint DONUT and USDC
    await donut.connect(user0).deposit({ value: convert("1000", 18) });
    await usdc.mint(user1.address, convert("100", 6));
    await usdc.mint(user2.address, convert("100", 6));

    // Launch content engine with 7-day halving
    const launchParams = {
      launcher: user0.address,
      tokenName: "Test Unit",
      tokenSymbol: "TUNIT",
      uri: "https://example.com/metadata",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18), // 4 tokens per second
      tailUps: convert("0.5", 18), // 0.5 tokens per second minimum
      halvingPeriod: WEEK, // 7 days
      contentMinInitPrice: convert("100", 6),
      contentIsModerated: false,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);
    const tx = await core.connect(user0).launch(launchParams);
    const receipt = await tx.wait();

    const launchEvent = receipt.events.find((e) => e.event === "ContentCore__Launched");
    content = launchEvent.args.rig;
    unit = launchEvent.args.unit;
    minter = launchEvent.args.minter;
    rewarder = launchEvent.args.rewarder;
    auction = launchEvent.args.auction;
    lpToken = launchEvent.args.lpToken;

    console.log("Initialization Complete\n");
  });

  describe("Initial State", function () {
    it("Minter parameters are correct", async function () {
      console.log("******************************************************");
      const minterContract = await ethers.getContractAt("Minter", minter);

      expect(await minterContract.unit()).to.equal(unit);
      expect(await minterContract.rewarder()).to.equal(rewarder);
      expect(await minterContract.initialUps()).to.equal(convert("4", 18));
      expect(await minterContract.tailUps()).to.equal(convert("0.5", 18));
      expect(await minterContract.halvingPeriod()).to.equal(WEEK);

      console.log("Initial UPS:", divDec(await minterContract.initialUps()));
      console.log("Tail UPS:", divDec(await minterContract.tailUps()));
      console.log("Halving Period:", (await minterContract.halvingPeriod()).toString(), "seconds");
    });

    it("Current UPS equals initial UPS", async function () {
      console.log("******************************************************");
      const minterContract = await ethers.getContractAt("Minter", minter);

      const currentUps = await minterContract.getUps();
      expect(currentUps).to.equal(convert("4", 18));
      console.log("Current UPS:", divDec(currentUps));
    });

    it("Weekly emission is correct", async function () {
      console.log("******************************************************");
      const minterContract = await ethers.getContractAt("Minter", minter);

      const weekly = await minterContract.weeklyEmission();
      const expectedWeekly = convert("4", 18).mul(WEEK);
      expect(weekly).to.equal(expectedWeekly);
      console.log("Weekly emission:", divDec(weekly), "tokens");
    });
  });

  describe("Update Period", function () {
    it("Cannot mint before week passes", async function () {
      console.log("******************************************************");
      const minterContract = await ethers.getContractAt("Minter", minter);
      const unitContract = await ethers.getContractAt("Unit", unit);

      const rewarderBalanceBefore = await unitContract.balanceOf(rewarder);

      // Try to update period
      await minterContract.connect(user1).updatePeriod();

      // No tokens should have been minted
      const rewarderBalanceAfter = await unitContract.balanceOf(rewarder);
      expect(rewarderBalanceAfter).to.equal(rewarderBalanceBefore);
      console.log("No tokens minted before week passes");
    });

    it("Anyone can call updatePeriod after week", async function () {
      console.log("******************************************************");
      const minterContract = await ethers.getContractAt("Minter", minter);
      const unitContract = await ethers.getContractAt("Unit", unit);
      const rewarderContract = await ethers.getContractAt("Rewarder", rewarder);

      // Forward 1 week
      await network.provider.send("evm_increaseTime", [WEEK]);
      await network.provider.send("evm_mine");

      const rewarderBalanceBefore = await unitContract.balanceOf(rewarder);

      // Anyone can call updatePeriod
      await minterContract.connect(user1).updatePeriod();

      const rewarderBalanceAfter = await unitContract.balanceOf(rewarder);
      const minted = rewarderBalanceAfter.sub(rewarderBalanceBefore);

      console.log("Tokens minted to rewarder:", divDec(minted));
      expect(minted).to.be.gt(0);

      // Should be weeklyEmission (which depends on current UPS after halvings)
      const currentWeeklyEmission = await minterContract.weeklyEmission();
      expect(minted).to.be.closeTo(currentWeeklyEmission, currentWeeklyEmission.div(10));
    });

    it("Rewarder receives notification", async function () {
      console.log("******************************************************");
      const rewarderContract = await ethers.getContractAt("Rewarder", rewarder);

      const left = await rewarderContract.left(unit);
      expect(left).to.be.gt(0);
      console.log("Rewards left in rewarder:", divDec(left));
    });

    it("Cannot mint twice in same week", async function () {
      console.log("******************************************************");
      const minterContract = await ethers.getContractAt("Minter", minter);
      const unitContract = await ethers.getContractAt("Unit", unit);

      const rewarderBalanceBefore = await unitContract.balanceOf(rewarder);

      // Try to update again
      await minterContract.connect(user1).updatePeriod();

      // No additional tokens should have been minted
      const rewarderBalanceAfter = await unitContract.balanceOf(rewarder);
      expect(rewarderBalanceAfter).to.equal(rewarderBalanceBefore);
      console.log("No double minting in same week");
    });
  });

  describe("Halving Schedule", function () {
    it("UPS halves after halving period", async function () {
      console.log("******************************************************");
      const minterContract = await ethers.getContractAt("Minter", minter);

      // After previous tests, we've advanced 1 week. Now advance another week.
      // Total time from start will be 2 weeks = 2 halvings
      await network.provider.send("evm_increaseTime", [WEEK]);
      await network.provider.send("evm_mine");

      const currentUps = await minterContract.getUps();
      // 4 >> 2 = 1 (after 2 halvings)
      expect(currentUps).to.equal(convert("1", 18));
      console.log("UPS after 2 halvings:", divDec(currentUps));
    });

    it("Second halving reduces UPS further", async function () {
      console.log("******************************************************");
      const minterContract = await ethers.getContractAt("Minter", minter);

      // Forward another week (total 3 weeks = 3 halvings)
      await network.provider.send("evm_increaseTime", [WEEK]);
      await network.provider.send("evm_mine");

      const currentUps = await minterContract.getUps();
      // 4 >> 3 = 0.5, but min is tailUps (0.5), so stays at 0.5
      expect(currentUps).to.equal(convert("0.5", 18));
      console.log("UPS after 3 halvings (at tail):", divDec(currentUps));
    });

    it("Third halving stays at tail", async function () {
      console.log("******************************************************");
      const minterContract = await ethers.getContractAt("Minter", minter);

      await network.provider.send("evm_increaseTime", [WEEK]);
      await network.provider.send("evm_mine");

      const currentUps = await minterContract.getUps();
      expect(currentUps).to.equal(convert("0.5", 18)); // Stays at tailUps
      console.log("UPS remains at tail:", divDec(currentUps));
    });

    it("UPS cannot go below tailUps", async function () {
      console.log("******************************************************");
      const minterContract = await ethers.getContractAt("Minter", minter);

      // Forward many weeks
      await network.provider.send("evm_increaseTime", [WEEK * 10]);
      await network.provider.send("evm_mine");

      const currentUps = await minterContract.getUps();
      expect(currentUps).to.equal(convert("0.5", 18)); // Should stay at tailUps
      console.log("UPS after many halvings (at tail):", divDec(currentUps));
    });

    it("Weekly emission reflects reduced UPS", async function () {
      console.log("******************************************************");
      const minterContract = await ethers.getContractAt("Minter", minter);

      const weekly = await minterContract.weeklyEmission();
      const expectedWeekly = convert("0.5", 18).mul(WEEK);
      expect(weekly).to.equal(expectedWeekly);
      console.log("Weekly emission at tail:", divDec(weekly), "tokens");
    });
  });
});

describe("Minter Parameter Validation Tests", function () {
  let localRegistry, localCore;

  before("Setup local core", async function () {
    // Deploy fresh Registry and Core
    localRegistry = await (await ethers.getContractFactory("Registry")).deploy();

    localCore = await (await ethers.getContractFactory("ContentCore")).deploy(
      localRegistry.address,
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
      convert("100", 18)
    );

    await localRegistry.setFactoryApproval(localCore.address, true);
    await donut.connect(user0).deposit({ value: convert("1000", 18) });
  });

  it("Cannot launch with halving period < 7 days", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      tokenName: "Bad Unit",
      tokenSymbol: "BUNIT",
      uri: "https://example.com",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.5", 18),
      halvingPeriod: 86400 * 6, // 6 days - too short
      contentMinInitPrice: convert("100", 6),
      contentIsModerated: false,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(localCore.address, launchParams.donutAmount);

    await expect(localCore.connect(user0).launch(launchParams)).to.be.revertedWith(
      "ContentCore__HalvingPeriodOutOfRange()"
    );
    console.log("Launch with short halving period correctly reverted");
  });

  it("Cannot launch with tailUps > initialUps", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      tokenName: "Bad Unit",
      tokenSymbol: "BUNIT",
      uri: "https://example.com",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("1", 18),
      tailUps: convert("2", 18), // tail > initial
      halvingPeriod: WEEK,
      contentMinInitPrice: convert("100", 6),
      contentIsModerated: false,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(localCore.address, launchParams.donutAmount);

    await expect(localCore.connect(user0).launch(launchParams)).to.be.revertedWith(
      "ContentCore__TailUpsOutOfRange()"
    );
    console.log("Launch with invalid tailUps correctly reverted");
  });

  it("Cannot launch with zero initialUps", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      tokenName: "Bad Unit",
      tokenSymbol: "BUNIT",
      uri: "https://example.com",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: 0,
      tailUps: convert("0.5", 18),
      halvingPeriod: WEEK,
      contentMinInitPrice: convert("100", 6),
      contentIsModerated: false,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(localCore.address, launchParams.donutAmount);

    await expect(localCore.connect(user0).launch(launchParams)).to.be.revertedWith(
      "ContentCore__InitialUpsOutOfRange()"
    );
    console.log("Launch with zero initialUps correctly reverted");
  });
});
