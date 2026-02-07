/**
 * @title Edge Case Security Audit Tests
 * @notice Comprehensive edge case tests for MineRig, SpinRig, FundRig, and Auction contracts.
 * @dev Tests zero values, maximum values, boundary conditions, time edge cases,
 *      multi-user scenarios, and parameter validation.
 */

const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const convert = (amount, decimals = 18) => ethers.utils.parseUnits(amount.toString(), decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const PRECISION = ethers.BigNumber.from("1000000000000000000");

const AddressZero = "0x0000000000000000000000000000000000000000";
const AddressDead = "0x000000000000000000000000000000000000dEaD";

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function getBlockTimestamp() {
  const block = await ethers.provider.getBlock("latest");
  return block.timestamp;
}

async function getFutureDeadline() {
  const block = await ethers.provider.getBlock("latest");
  return block.timestamp + 3600;
}

const ONE_HOUR = 3600;
const ONE_DAY = 86400;
const SEVEN_DAYS = 7 * ONE_DAY;
const THIRTY_DAYS = 30 * ONE_DAY;
const ONE_YEAR = 365 * ONE_DAY;

describe("Edge Case Security Audit Tests", function () {
  let owner, protocol, team, user0, user1, user2, user3, user4, user5, user6, user7;
  let weth, usdc, entropy, registry;
  let mineCore, spinCore, fundCore;
  let uniswapFactory, uniswapRouter;
  let unitFactory, mineRigFactory, spinRigFactory, fundRigFactory, auctionFactory;

  // Counter for unique token names
  let launchCounter = 0;

  before("Deploy all infrastructure", async function () {
    this.timeout(120000);
    await network.provider.send("hardhat_reset");

    [owner, protocol, team, user0, user1, user2, user3, user4, user5, user6, user7] =
      await ethers.getSigners();

    // Deploy mock tokens
    const MockWETH = await ethers.getContractFactory("MockWETH");
    weth = await MockWETH.deploy();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    // Deploy mock Entropy
    const MockEntropy = await ethers.getContractFactory("MockEntropy");
    entropy = await MockEntropy.deploy();

    // Deploy mock Uniswap
    const MockUniswapV2Factory = await ethers.getContractFactory("MockUniswapV2Factory");
    uniswapFactory = await MockUniswapV2Factory.deploy();

    const MockUniswapV2Router = await ethers.getContractFactory("MockUniswapV2Router");
    uniswapRouter = await MockUniswapV2Router.deploy(uniswapFactory.address);

    // Deploy Registry
    const Registry = await ethers.getContractFactory("Registry");
    registry = await Registry.deploy();

    // Deploy factories
    const UnitFactory = await ethers.getContractFactory("UnitFactory");
    unitFactory = await UnitFactory.deploy();

    const MineRigFactory = await ethers.getContractFactory("MineRigFactory");
    mineRigFactory = await MineRigFactory.deploy();

    const SpinRigFactory = await ethers.getContractFactory("SpinRigFactory");
    spinRigFactory = await SpinRigFactory.deploy();

    const FundRigFactory = await ethers.getContractFactory("FundRigFactory");
    fundRigFactory = await FundRigFactory.deploy();

    const AuctionFactory = await ethers.getContractFactory("AuctionFactory");
    auctionFactory = await AuctionFactory.deploy();

    // Deploy MineCore
    const MineCore = await ethers.getContractFactory("MineCore");
    mineCore = await MineCore.deploy(
      registry.address,
      usdc.address,
      uniswapFactory.address,
      uniswapRouter.address,
      unitFactory.address,
      mineRigFactory.address,
      auctionFactory.address,
      entropy.address,
      protocol.address,
      convert("100", 6)
    );

    // Deploy SpinCore
    const SpinCore = await ethers.getContractFactory("SpinCore");
    spinCore = await SpinCore.deploy(
      registry.address,
      usdc.address,
      uniswapFactory.address,
      uniswapRouter.address,
      unitFactory.address,
      spinRigFactory.address,
      auctionFactory.address,
      entropy.address,
      protocol.address,
      convert("100", 6)
    );

    // Deploy FundCore
    const FundCore = await ethers.getContractFactory("FundCore");
    fundCore = await FundCore.deploy(
      registry.address,
      usdc.address,
      uniswapFactory.address,
      uniswapRouter.address,
      unitFactory.address,
      fundRigFactory.address,
      auctionFactory.address,
      protocol.address,
      convert("100", 6)
    );

    // Approve all Cores in Registry
    await registry.setFactoryApproval(mineCore.address, true);
    await registry.setFactoryApproval(spinCore.address, true);
    await registry.setFactoryApproval(fundCore.address, true);

    // Fund users with WETH (modest amounts - save ETH for gas)
    const signers = [user0, user1, user2, user3, user4, user5, user6, user7];
    for (const signer of signers) {
      await weth.connect(signer).deposit({ value: convert("500", 18) });
      await usdc.mint(signer.address, convert("10000000", 6));
    }

    // Fund users with USDC for launches
    await usdc.mint(user0.address, convert("5000", 6));
    // Also fund other users with USDC in case they launch
    await usdc.mint(user1.address, convert("1000", 6));
    await usdc.mint(user2.address, convert("1000", 6));
  });

  // ---------------------------------------------------------------------------
  // HELPER FUNCTIONS
  // ---------------------------------------------------------------------------

  async function launchMineRig(launcher, overrides = {}) {
    launchCounter++;
    const params = {
      launcher: launcher.address,
      quoteToken: overrides.quoteToken || weth.address,
      tokenName: overrides.tokenName || `MineEdge${launchCounter}`,
      tokenSymbol: overrides.tokenSymbol || `ME${launchCounter}`,
      uri: overrides.uri !== undefined ? overrides.uri : "https://example.com/rig",
      usdcAmount: overrides.usdcAmount || convert("100", 6),
      unitAmount: overrides.unitAmount || convert("1000000", 18),
      initialUps: overrides.initialUps || convert("4", 18),
      tailUps: overrides.tailUps || convert("0.01", 18),
      halvingAmount: overrides.halvingAmount || convert("10000000", 18),
      rigEpochPeriod: overrides.rigEpochPeriod || 3600,
      rigPriceMultiplier: overrides.rigPriceMultiplier || convert("2", 18),
      rigMinInitPrice: overrides.rigMinInitPrice || convert("0.0001", 18),
      upsMultipliers: overrides.upsMultipliers || [convert("1", 18)],
      upsMultiplierDuration: overrides.upsMultiplierDuration || ONE_DAY,
      auctionInitPrice: overrides.auctionInitPrice || convert("1", 18),
      auctionEpochPeriod: overrides.auctionEpochPeriod || ONE_HOUR,
      auctionPriceMultiplier: overrides.auctionPriceMultiplier || convert("2", 18),
      auctionMinInitPrice: overrides.auctionMinInitPrice || convert("0.1", 18),
    };

    await usdc.connect(launcher).approve(mineCore.address, params.usdcAmount);
    const tx = await mineCore.connect(launcher).launch(params);
    const receipt = await tx.wait();
    const ev = receipt.events.find((e) => e.event === "MineCore__Launched");

    const rigContract = await ethers.getContractAt("MineRig", ev.args.rig);

    // Disable entropy for tests that don't send ETH for VRF fees
    await rigContract.connect(launcher).setEntropyEnabled(false);

    const unitContract = await ethers.getContractAt("Unit", ev.args.unit);
    const auctionContract = await ethers.getContractAt("Auction", ev.args.auction);

    return {
      rig: ev.args.rig,
      unit: ev.args.unit,
      auction: ev.args.auction,
      lpToken: ev.args.lpToken,
      rigContract,
      unitContract,
      auctionContract,
    };
  }

  async function launchSpinRig(launcher, overrides = {}) {
    launchCounter++;
    const params = {
      launcher: launcher.address,
      quoteToken: overrides.quoteToken || weth.address,
      tokenName: overrides.tokenName || `SpinEdge${launchCounter}`,
      tokenSymbol: overrides.tokenSymbol || `SE${launchCounter}`,
      uri: overrides.uri !== undefined ? overrides.uri : "https://example.com/rig",
      usdcAmount: overrides.usdcAmount || convert("100", 6),
      unitAmount: overrides.unitAmount || convert("1000000", 18),
      initialUps: overrides.initialUps || convert("4", 18),
      tailUps: overrides.tailUps || convert("0.01", 18),
      halvingPeriod: overrides.halvingPeriod || SEVEN_DAYS,
      rigEpochPeriod: overrides.rigEpochPeriod || ONE_HOUR,
      rigPriceMultiplier: overrides.rigPriceMultiplier || convert("2", 18),
      rigMinInitPrice: overrides.rigMinInitPrice || convert("0.0001", 18),
      odds: overrides.odds || [10, 100, 500, 1000, 5000],
      auctionInitPrice: overrides.auctionInitPrice || convert("1", 18),
      auctionEpochPeriod: overrides.auctionEpochPeriod || ONE_HOUR,
      auctionPriceMultiplier: overrides.auctionPriceMultiplier || convert("2", 18),
      auctionMinInitPrice: overrides.auctionMinInitPrice || convert("0.1", 18),
    };

    await usdc.connect(launcher).approve(spinCore.address, params.usdcAmount);
    const tx = await spinCore.connect(launcher).launch(params);
    const receipt = await tx.wait();
    const ev = receipt.events.find((e) => e.event === "SpinCore__Launched");

    const rigContract = await ethers.getContractAt("SpinRig", ev.args.rig);
    const unitContract = await ethers.getContractAt("Unit", ev.args.unit);
    const auctionContract = await ethers.getContractAt("Auction", ev.args.auction);

    return {
      rig: ev.args.rig,
      unit: ev.args.unit,
      auction: ev.args.auction,
      lpToken: ev.args.lpToken,
      rigContract,
      unitContract,
      auctionContract,
    };
  }

  async function launchFundRig(launcher, overrides = {}) {
    launchCounter++;
    const params = {
      launcher: launcher.address,
      quoteToken: overrides.quoteToken || usdc.address,
      recipient: overrides.recipient || user1.address,
      tokenName: overrides.tokenName || `FundEdge${launchCounter}`,
      tokenSymbol: overrides.tokenSymbol || `FE${launchCounter}`,
      uri: overrides.uri !== undefined ? overrides.uri : "https://example.com/rig",
      usdcAmount: overrides.usdcAmount || convert("100", 6),
      unitAmount: overrides.unitAmount || convert("1000000", 18),
      initialEmission: overrides.initialEmission || convert("1000", 18),
      minEmission: overrides.minEmission || convert("1", 18),
      halvingPeriod: overrides.halvingPeriod || 30,
      auctionInitPrice: overrides.auctionInitPrice || convert("1", 18),
      auctionEpochPeriod: overrides.auctionEpochPeriod || ONE_HOUR,
      auctionPriceMultiplier: overrides.auctionPriceMultiplier || convert("2", 18),
      auctionMinInitPrice: overrides.auctionMinInitPrice || convert("0.1", 18),
    };

    await usdc.connect(launcher).approve(fundCore.address, params.usdcAmount);
    const tx = await fundCore.connect(launcher).launch(params);
    const receipt = await tx.wait();
    const ev = receipt.events.find((e) => e.event === "FundCore__Launched");

    const rigContract = await ethers.getContractAt("FundRig", ev.args.rig);
    const unitContract = await ethers.getContractAt("Unit", ev.args.unit);
    const auctionContract = await ethers.getContractAt("Auction", ev.args.auction);

    return {
      rig: ev.args.rig,
      unit: ev.args.unit,
      auction: ev.args.auction,
      lpToken: ev.args.lpToken,
      rigContract,
      unitContract,
      auctionContract,
    };
  }

  // ---------------------------------------------------------------------------
  // 1. ZERO VALUES
  // ---------------------------------------------------------------------------

  describe("Zero Values", function () {
    it("Mine at price=0: should allow free mining when epoch expires", async function () {
      const { rigContract, rig, unitContract } = await launchMineRig(user0);

      // Wait for epoch to expire so price = 0
      const epochPeriod = await rigContract.epochPeriod();
      await increaseTime(epochPeriod.toNumber() + 1);

      const price = await rigContract.getPrice(0);
      expect(price).to.equal(0);

      const slot = await rigContract.getSlot(0);
      const deadline = await getFutureDeadline();

      // Mine at price 0
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, 0, "");

      const newSlot = await rigContract.getSlot(0);
      expect(newSlot.miner).to.equal(user1.address);
      expect(newSlot.epochId).to.equal(slot.epochId.add(1));
    });

    it("Mine at price=0: previous miner is launcher, tokens minted for launcher's hold time", async function () {
      const { rigContract, rig, unitContract } = await launchMineRig(user0);

      await increaseTime(ONE_HOUR + 1);

      const slot = await rigContract.getSlot(0);
      // Slot 0 is now pre-initialized with launcher as miner
      expect(slot.miner).to.equal(user0.address);

      const totalMintedBefore = await rigContract.totalMinted();
      const deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, 0, "");

      const totalMintedAfter = await rigContract.totalMinted();
      // Launcher held the slot for ~1 hour, so tokens were minted
      expect(totalMintedAfter).to.be.gt(totalMintedBefore);
    });

    it("Fund with MIN_DONATION (10000 units): fee splits work correctly", async function () {
      const { rigContract, rig } = await launchFundRig(user0);

      const MIN_DONATION = 10000;

      const recipientAddr = await rigContract.recipient();
      const treasuryAddr = await rigContract.treasury();
      const teamAddr = await rigContract.team();

      const recipientBefore = await usdc.balanceOf(recipientAddr);
      const treasuryBefore = await usdc.balanceOf(treasuryAddr);
      const teamBefore = await usdc.balanceOf(teamAddr);
      const protocolBefore = await usdc.balanceOf(protocol.address);

      await usdc.connect(user2).approve(rig, MIN_DONATION);
      await rigContract.connect(user2).fund(user2.address, MIN_DONATION, "");

      const recipientAfter = await usdc.balanceOf(recipientAddr);
      const treasuryAfter = await usdc.balanceOf(treasuryAddr);
      const teamAfter = await usdc.balanceOf(teamAddr);
      const protocolAfter = await usdc.balanceOf(protocol.address);

      expect(recipientAfter.sub(recipientBefore)).to.equal(5000);
      expect(teamAfter.sub(teamBefore)).to.equal(400);
      expect(protocolAfter.sub(protocolBefore)).to.equal(100);
      expect(treasuryAfter.sub(treasuryBefore)).to.equal(4500);
    });

    it("Auction buy at price=0: should transfer assets even with zero payment", async function () {
      const { rigContract, rig, auctionContract, auction } = await launchMineRig(user0);

      // Mine to generate treasury fees
      await increaseTime(ONE_HOUR + 1);
      const slot = await rigContract.getSlot(0);
      const deadline = await getFutureDeadline();
      await weth.connect(user1).approve(rig, convert("1", 18));
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("1", 18), "");

      const slot2 = await rigContract.getSlot(0);
      const price2 = await rigContract.getPrice(0);
      if (price2.gt(0)) {
        await weth.connect(user2).approve(rig, price2.add(convert("1", 18)));
        await rigContract.connect(user2).mine(
          user2.address, 0, slot2.epochId, deadline, price2.add(convert("1", 18)), ""
        );
      }

      // Wait for auction epoch to expire
      const auctionEpochPeriod = await auctionContract.epochPeriod();
      await increaseTime(auctionEpochPeriod.toNumber() + 1);

      const auctionPrice = await auctionContract.getPrice();
      expect(auctionPrice).to.equal(0);

      const auctionEpochId = await auctionContract.epochId();
      const auctionDeadline = await getFutureDeadline();

      // Buy at price 0
      await auctionContract
        .connect(user3)
        .buy([weth.address], user3.address, auctionEpochId, auctionDeadline, 0);

      const newEpochId = await auctionContract.epochId();
      expect(newEpochId).to.equal(auctionEpochId.add(1));
    });
  });

  // ---------------------------------------------------------------------------
  // 2. MAXIMUM VALUES
  // ---------------------------------------------------------------------------

  describe("Maximum Values", function () {
    it("Launch MineRig with very large unitAmount (1 trillion tokens)", async function () {
      const { rigContract, unitContract } = await launchMineRig(user0, {
        unitAmount: convert("1000000000000", 18),
      });

      expect(await rigContract.capacity()).to.equal(1);
      const ups = await rigContract.getUps();
      expect(ups).to.equal(convert("4", 18));
    });

    it("Launch MineRig with high minInitPrice and verify price calculations", async function () {
      const { rigContract, rig } = await launchMineRig(user0, {
        rigMinInitPrice: convert("1000", 18),
      });

      await increaseTime(ONE_HOUR + 1);

      const slot = await rigContract.getSlot(0);
      const deadline = await getFutureDeadline();
      await weth.connect(user1).approve(rig, convert("10000", 18));
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("10000", 18), "");

      const newSlot = await rigContract.getSlot(0);
      expect(newSlot.initPrice).to.equal(convert("1000", 18));
    });

    it("MineRig capacity at MAX_CAPACITY (256): mine and verify UPS division", async function () {
      const { rigContract, rig } = await launchMineRig(user0);

      await rigContract.connect(user0).setCapacity(256);
      expect(await rigContract.capacity()).to.equal(256);

      const totalUps = await rigContract.getUps();
      const expectedSlotUps = totalUps.div(256);

      await increaseTime(ONE_HOUR + 1);
      const slot0 = await rigContract.getSlot(0);
      const deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, 0, slot0.epochId, deadline, 0, "");

      const minedSlot0 = await rigContract.getSlot(0);
      expect(minedSlot0.ups).to.equal(expectedSlotUps);

      const slot255 = await rigContract.getSlot(255);
      await rigContract.connect(user2).mine(user2.address, 255, slot255.epochId, deadline, 0, "");

      const minedSlot255 = await rigContract.getSlot(255);
      expect(minedSlot255.ups).to.equal(expectedSlotUps);
    });

    it("MineRig with MAX_INITIAL_UPS (1e24): mine, wait, mine again, verify no overflow", async function () {
      const { rigContract, rig, unitContract } = await launchMineRig(user0, {
        initialUps: ethers.BigNumber.from("1000000000000000000000000"), // 1e24
        tailUps: convert("1", 18),
      });

      await increaseTime(ONE_HOUR + 1);

      const slot = await rigContract.getSlot(0);
      const deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, 0, "");

      await increaseTime(10);

      const user1BalBefore = await unitContract.balanceOf(user1.address);
      const slot2 = await rigContract.getSlot(0);
      const price2 = await rigContract.getPrice(0);
      const deadline2 = await getFutureDeadline();
      await weth.connect(user2).approve(rig, price2.add(convert("100", 18)));
      await rigContract.connect(user2).mine(
        user2.address, 0, slot2.epochId, deadline2, price2.add(convert("100", 18)), ""
      );

      const user1BalAfter = await unitContract.balanceOf(user1.address);
      expect(user1BalAfter).to.be.gt(user1BalBefore);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. BOUNDARY VALUES
  // ---------------------------------------------------------------------------

  describe("Boundary Values", function () {
    it("Exact epoch boundary: getPrice returns 0 at exactly epochPeriod elapsed", async function () {
      const { rigContract, rig } = await launchMineRig(user0);

      await increaseTime(ONE_HOUR + 1);
      const slot = await rigContract.getSlot(0);
      const deadline = await getFutureDeadline();
      await weth.connect(user1).approve(rig, convert("1", 18));
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("1", 18), "");

      const epochPeriod = await rigContract.epochPeriod();
      await increaseTime(epochPeriod.toNumber());

      const price = await rigContract.getPrice(0);
      expect(price).to.equal(0);

      const slot2 = await rigContract.getSlot(0);
      const deadline2 = await getFutureDeadline();
      await rigContract.connect(user2).mine(user2.address, 0, slot2.epochId, deadline2, 0, "");
      const newSlot = await rigContract.getSlot(0);
      expect(newSlot.miner).to.equal(user2.address);
    });

    it("Exact halving boundary (MineRig): UPS changes when halvingAmount crossed", async function () {
      const { rigContract, rig, unitContract } = await launchMineRig(user0, {
        initialUps: convert("10000", 18),
        tailUps: convert("1", 18),
        halvingAmount: convert("1000", 18),
        rigEpochPeriod: 600,
      });

      const initialUps = await rigContract.getUps();
      expect(initialUps).to.equal(convert("10000", 18));

      for (let i = 0; i < 15; i++) {
        await increaseTime(601);
        const slot = await rigContract.getSlot(0);
        const deadline = await getFutureDeadline();
        await weth.connect(user1).approve(rig, convert("1", 18));
        await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("1", 18), "");
      }

      const totalMinted = await rigContract.totalMinted();
      if (totalMinted.gte(convert("1000", 18))) {
        const newUps = await rigContract.getUps();
        expect(newUps).to.be.lt(initialUps);
      }
    });

    it("Exact halving boundary (SpinRig): UPS halves after halvingPeriod", async function () {
      const { rigContract } = await launchSpinRig(user0);

      const upsBefore = await rigContract.getUps();
      expect(upsBefore).to.equal(convert("4", 18));

      // Advance exactly halvingPeriod (7 days for this rig)
      const halvingPeriod = await rigContract.halvingPeriod();
      await increaseTime(halvingPeriod.toNumber());

      const upsAfter = await rigContract.getUps();
      expect(upsAfter).to.equal(upsBefore.div(2));
    });

    it("Exact day boundary (FundRig): cannot claim current day, can claim after day ends", async function () {
      const { rigContract, rig, unitContract } = await launchFundRig(user0);

      const currentDay = await rigContract.currentDay();

      await usdc.connect(user2).approve(rig, convert("100", 6));
      await rigContract.connect(user2).fund(user2.address, convert("100", 6), "");

      await expect(
        rigContract.connect(user2).claim(user2.address, currentDay)
      ).to.be.revertedWith("FundRig__DayNotEnded()");

      await increaseTime(ONE_DAY + 1);

      const balBefore = await unitContract.balanceOf(user2.address);
      await rigContract.connect(user2).claim(user2.address, currentDay);
      const balAfter = await unitContract.balanceOf(user2.address);
      expect(balAfter).to.be.gt(balBefore);
    });

    it("First mine displaces launcher: tokens minted for launcher's hold time", async function () {
      const { rigContract, rig, unitContract } = await launchMineRig(user0);

      await increaseTime(ONE_HOUR + 1);

      const slot = await rigContract.getSlot(0);
      // Slot 0 is now pre-initialized with launcher as miner
      expect(slot.miner).to.equal(user0.address);

      const totalMintedBefore = await rigContract.totalMinted();
      const deadline = await getFutureDeadline();

      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, 0, "");

      const totalMintedAfter = await rigContract.totalMinted();
      // Launcher held slot for ~1 hour, so tokens minted for that time
      expect(totalMintedAfter).to.be.gt(totalMintedBefore);

      const newSlot = await rigContract.getSlot(0);
      expect(newSlot.miner).to.equal(user1.address);
    });

    it("Slot 0 vs slot 255: both work identically with capacity=256", async function () {
      const { rigContract, rig, unitContract } = await launchMineRig(user0);

      await rigContract.connect(user0).setCapacity(256);
      await increaseTime(ONE_HOUR + 1);

      const deadline = await getFutureDeadline();

      const slot0 = await rigContract.getSlot(0);
      await rigContract.connect(user1).mine(user1.address, 0, slot0.epochId, deadline, 0, "");

      const slot255 = await rigContract.getSlot(255);
      await rigContract.connect(user2).mine(user2.address, 255, slot255.epochId, deadline, 0, "");

      const newSlot0 = await rigContract.getSlot(0);
      const newSlot255 = await rigContract.getSlot(255);

      expect(newSlot0.miner).to.equal(user1.address);
      expect(newSlot255.miner).to.equal(user2.address);
      expect(newSlot0.ups).to.equal(newSlot255.ups);
      expect(newSlot0.initPrice).to.equal(newSlot255.initPrice);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. TIME EDGE CASES
  // ---------------------------------------------------------------------------

  describe("Time Edge Cases", function () {
    it("1-year idle MineRig: mine, wait 365 days, mine again without overflow", async function () {
      this.timeout(30000);
      const { rigContract, rig, unitContract } = await launchMineRig(user0);

      await increaseTime(ONE_HOUR + 1);
      const slot = await rigContract.getSlot(0);
      const deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, 0, "");

      await increaseTime(ONE_YEAR);

      const slot2 = await rigContract.getSlot(0);
      const deadline2 = await getFutureDeadline();
      const user1BalBefore = await unitContract.balanceOf(user1.address);

      await rigContract.connect(user2).mine(user2.address, 0, slot2.epochId, deadline2, 0, "");

      const user1BalAfter = await unitContract.balanceOf(user1.address);
      const minted = user1BalAfter.sub(user1BalBefore);

      expect(minted).to.be.gt(0);
      const totalMinted = await rigContract.totalMinted();
      expect(totalMinted).to.be.gt(0);
    });

    it("Multiple mines same block (rapid succession): second mine mints near-zero tokens", async function () {
      const { rigContract, rig, unitContract } = await launchMineRig(user0);

      await increaseTime(ONE_HOUR + 1);
      const slot = await rigContract.getSlot(0);
      const deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, 0, "");

      // Mine immediately (same block practically)
      const slot2 = await rigContract.getSlot(0);
      const price2 = await rigContract.getPrice(0);
      const deadline2 = await getFutureDeadline();
      const user1BalBefore = await unitContract.balanceOf(user1.address);

      await weth.connect(user2).approve(rig, price2.add(convert("1", 18)));
      await rigContract.connect(user2).mine(
        user2.address, 0, slot2.epochId, deadline2, price2.add(convert("1", 18)), ""
      );

      const user1BalAfter = await unitContract.balanceOf(user1.address);
      const minted = user1BalAfter.sub(user1BalBefore);

      // Should be near zero since almost no time elapsed (1 block = ~1 second)
      expect(minted).to.be.lte(convert("10", 18));
    });

    it("Mine immediately after deploy: slot has minInitPrice, displaces launcher", async function () {
      const { rigContract, rig, unitContract } = await launchMineRig(user0);

      const slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);
      // Slot 0 is pre-initialized with initPrice=minInitPrice, so price > 0
      expect(price).to.be.gt(0);
      // Launcher is the initial miner
      expect(slot.miner).to.equal(user0.address);

      const deadline = await getFutureDeadline();

      await weth.connect(user1).approve(rig, price.mul(2));
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, price.mul(2), "");

      const newSlot = await rigContract.getSlot(0);
      expect(newSlot.miner).to.equal(user1.address);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. MULTI-USER SCENARIOS
  // ---------------------------------------------------------------------------

  describe("Multi-User Scenarios", function () {
    it("5 users sequentially mine the same MineRig slot: correct fees and tokens", async function () {
      this.timeout(30000);
      const { rigContract, rig, unitContract } = await launchMineRig(user0);
      await rigContract.connect(user0).setTeam(team.address);

      const users = [user1, user2, user3, user4, user5];

      // Initial mine
      await increaseTime(ONE_HOUR + 1);
      const slot = await rigContract.getSlot(0);
      const deadline = await getFutureDeadline();
      await weth.connect(user1).approve(rig, convert("1", 18));
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("1", 18), "");

      for (let i = 1; i < users.length; i++) {
        await increaseTime(100);

        const currentSlot = await rigContract.getSlot(0);
        const currentPrice = await rigContract.getPrice(0);
        const dl = await getFutureDeadline();

        const prevMiner = currentSlot.miner;
        const prevMinerBal = await unitContract.balanceOf(prevMiner);

        await weth.connect(users[i]).approve(rig, currentPrice.add(convert("10", 18)));
        await rigContract.connect(users[i]).mine(
          users[i].address, 0, currentSlot.epochId, dl, currentPrice.add(convert("10", 18)), ""
        );

        const prevMinerBalAfter = await unitContract.balanceOf(prevMiner);
        expect(prevMinerBalAfter).to.be.gte(prevMinerBal);

        const updatedSlot = await rigContract.getSlot(0);
        expect(updatedSlot.miner).to.equal(users[i].address);
      }

      const totalMinted = await rigContract.totalMinted();
      expect(totalMinted).to.be.gt(0);
    });

    it("5 donors same day in FundRig: rewards sum approximately equals dayEmission", async function () {
      this.timeout(30000);
      const { rigContract, rig, unitContract } = await launchFundRig(user0);

      const day = await rigContract.currentDay();

      const amounts = [
        convert("50", 6),
        convert("100", 6),
        convert("200", 6),
        convert("300", 6),
        convert("350", 6),
      ];
      const donors = [user1, user2, user3, user4, user5];

      for (let i = 0; i < donors.length; i++) {
        await usdc.connect(donors[i]).approve(rig, amounts[i]);
        await rigContract.connect(donors[i]).fund(donors[i].address, amounts[i], "");
      }

      await increaseTime(ONE_DAY + 1);

      const dayEmission = await rigContract.getDayEmission(day);

      let totalRewards = ethers.BigNumber.from(0);
      for (let i = 0; i < donors.length; i++) {
        const balBefore = await unitContract.balanceOf(donors[i].address);
        await rigContract.connect(donors[i]).claim(donors[i].address, day);
        const balAfter = await unitContract.balanceOf(donors[i].address);
        totalRewards = totalRewards.add(balAfter.sub(balBefore));
      }

      // Due to integer division rounding, total may be slightly less than dayEmission
      expect(totalRewards).to.be.lte(dayEmission);
      expect(dayEmission.sub(totalRewards)).to.be.lte(5);
    });

    it("Simultaneous auction competition: second buyer reverts with epoch mismatch", async function () {
      const { rigContract, rig, auctionContract, auction } = await launchMineRig(user0);

      await increaseTime(ONE_HOUR + 1);
      const slot = await rigContract.getSlot(0);
      const dl = await getFutureDeadline();
      await weth.connect(user1).approve(rig, convert("1", 18));
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, dl, convert("1", 18), "");

      const slot2 = await rigContract.getSlot(0);
      const price2 = await rigContract.getPrice(0);
      if (price2.gt(0)) {
        await weth.connect(user2).approve(rig, price2.add(convert("10", 18)));
        await rigContract.connect(user2).mine(
          user2.address, 0, slot2.epochId, dl, price2.add(convert("10", 18)), ""
        );
      }

      const auctionEpochPeriod = await auctionContract.epochPeriod();
      await increaseTime(auctionEpochPeriod.toNumber() + 1);

      const auctionEpochId = await auctionContract.epochId();
      const auctionDl = await getFutureDeadline();

      // First buy succeeds
      await auctionContract
        .connect(user3)
        .buy([weth.address], user3.address, auctionEpochId, auctionDl, 0);

      // Second buy with same epochId reverts
      await expect(
        auctionContract
          .connect(user4)
          .buy([weth.address], user4.address, auctionEpochId, auctionDl, 0)
      ).to.be.revertedWith("Auction__EpochIdMismatch()");
    });
  });

  // ---------------------------------------------------------------------------
  // 6. PARAMETER VALIDATION EDGE CASES
  // ---------------------------------------------------------------------------

  describe("Parameter Validation", function () {
    describe("MineRig: minimum valid parameters", function () {
      it("Should launch with all minimum valid parameters", async function () {
        const { rigContract } = await launchMineRig(user0, {
          unitAmount: convert("1", 18),
          initialUps: ethers.BigNumber.from("1"),
          tailUps: ethers.BigNumber.from("1"),
          halvingAmount: convert("1000", 18),
          rigEpochPeriod: 600,
          rigPriceMultiplier: ethers.BigNumber.from("1100000000000000000"),
          rigMinInitPrice: ethers.BigNumber.from("1000000"),
          upsMultiplierDuration: ONE_HOUR,
          auctionInitPrice: ethers.BigNumber.from("1000000"),
          auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: ethers.BigNumber.from("1100000000000000000"),
          auctionMinInitPrice: ethers.BigNumber.from("1000000"),
        });

        expect(await rigContract.epochPeriod()).to.equal(600);
        expect(await rigContract.initialUps()).to.equal(1);
      });
    });

    describe("MineRig: maximum valid parameters", function () {
      it("Should launch with maximum epoch period and price multiplier", async function () {
        const { rigContract } = await launchMineRig(user0, {
          rigEpochPeriod: ONE_YEAR,
          rigPriceMultiplier: convert("3", 18),
          auctionEpochPeriod: ONE_YEAR,
          auctionPriceMultiplier: convert("3", 18),
        });

        expect(await rigContract.epochPeriod()).to.equal(ONE_YEAR);
        expect(await rigContract.priceMultiplier()).to.equal(convert("3", 18));
      });
    });

    describe("MineRig: invalid parameters revert correctly", function () {
      it("Should revert with epochPeriod below minimum", async function () {
        const params = {
          launcher: user0.address, quoteToken: weth.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18), tailUps: convert("0.01", 18),
          halvingAmount: convert("10000000", 18),
          rigEpochPeriod: 599,
          rigPriceMultiplier: convert("2", 18), rigMinInitPrice: convert("0.0001", 18),
          upsMultipliers: [convert("1", 18)], upsMultiplierDuration: ONE_DAY,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        };
        await usdc.connect(user0).approve(mineCore.address, params.usdcAmount);
        await expect(mineCore.connect(user0).launch(params)).to.be.revertedWith("Rig__EpochPeriodOutOfRange()");
      });

      it("Should revert with priceMultiplier below minimum (1.1e18)", async function () {
        const params = {
          launcher: user0.address, quoteToken: weth.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18), tailUps: convert("0.01", 18),
          halvingAmount: convert("10000000", 18), rigEpochPeriod: ONE_HOUR,
          rigPriceMultiplier: convert("1", 18),
          rigMinInitPrice: convert("0.0001", 18), upsMultipliers: [convert("1", 18)], upsMultiplierDuration: ONE_DAY,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        };
        await usdc.connect(user0).approve(mineCore.address, params.usdcAmount);
        await expect(mineCore.connect(user0).launch(params)).to.be.revertedWith("Rig__PriceMultiplierOutOfRange()");
      });

      it("Should revert with initialUps = 0", async function () {
        const params = {
          launcher: user0.address, quoteToken: weth.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: 0, tailUps: convert("0.01", 18),
          halvingAmount: convert("10000000", 18), rigEpochPeriod: ONE_HOUR,
          rigPriceMultiplier: convert("2", 18), rigMinInitPrice: convert("0.0001", 18),
          upsMultipliers: [convert("1", 18)], upsMultiplierDuration: ONE_DAY,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        };
        await usdc.connect(user0).approve(mineCore.address, params.usdcAmount);
        await expect(mineCore.connect(user0).launch(params)).to.be.revertedWith("Rig__ZeroInitialUps()");
      });

      it("Should revert with initialUps exceeding MAX (1e24)", async function () {
        const params = {
          launcher: user0.address, quoteToken: weth.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: ethers.BigNumber.from("1000000000000000000000001"),
          tailUps: convert("0.01", 18), halvingAmount: convert("10000000", 18),
          rigEpochPeriod: ONE_HOUR, rigPriceMultiplier: convert("2", 18),
          rigMinInitPrice: convert("0.0001", 18), upsMultipliers: [convert("1", 18)], upsMultiplierDuration: ONE_DAY,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        };
        await usdc.connect(user0).approve(mineCore.address, params.usdcAmount);
        await expect(mineCore.connect(user0).launch(params)).to.be.revertedWith("Rig__InitialUpsExceedsMax()");
      });

      it("Should revert with tailUps > initialUps", async function () {
        const params = {
          launcher: user0.address, quoteToken: weth.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: convert("1", 18), tailUps: convert("2", 18),
          halvingAmount: convert("10000000", 18), rigEpochPeriod: ONE_HOUR,
          rigPriceMultiplier: convert("2", 18), rigMinInitPrice: convert("0.0001", 18),
          upsMultipliers: [convert("1", 18)], upsMultiplierDuration: ONE_DAY,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        };
        await usdc.connect(user0).approve(mineCore.address, params.usdcAmount);
        await expect(mineCore.connect(user0).launch(params)).to.be.revertedWith("Rig__TailUpsOutOfRange()");
      });

      it("Should revert with halvingAmount below MIN_HALVING_AMOUNT", async function () {
        const params = {
          launcher: user0.address, quoteToken: weth.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18), tailUps: convert("0.01", 18),
          halvingAmount: convert("999", 18), rigEpochPeriod: ONE_HOUR,
          rigPriceMultiplier: convert("2", 18), rigMinInitPrice: convert("0.0001", 18),
          upsMultipliers: [convert("1", 18)], upsMultiplierDuration: ONE_DAY,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        };
        await usdc.connect(user0).approve(mineCore.address, params.usdcAmount);
        await expect(mineCore.connect(user0).launch(params)).to.be.revertedWith("Rig__HalvingAmountBelowMin()");
      });

      it("Should revert with minInitPrice below ABS_MIN_INIT_PRICE", async function () {
        const params = {
          launcher: user0.address, quoteToken: weth.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18), tailUps: convert("0.01", 18),
          halvingAmount: convert("10000000", 18), rigEpochPeriod: ONE_HOUR,
          rigPriceMultiplier: convert("2", 18), rigMinInitPrice: 999999,
          upsMultipliers: [convert("1", 18)], upsMultiplierDuration: ONE_DAY,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        };
        await usdc.connect(user0).approve(mineCore.address, params.usdcAmount);
        await expect(mineCore.connect(user0).launch(params)).to.be.revertedWith("Rig__MinInitPriceOutOfRange()");
      });
    });

    describe("SpinRig: minimum valid parameters", function () {
      it("Should launch with all minimum valid parameters", async function () {
        const { rigContract } = await launchSpinRig(user0, {
          unitAmount: convert("1", 18),
          initialUps: ethers.BigNumber.from("1"),
          tailUps: ethers.BigNumber.from("1"),
          halvingPeriod: SEVEN_DAYS,
          rigEpochPeriod: 600,
          rigPriceMultiplier: ethers.BigNumber.from("1100000000000000000"),
          rigMinInitPrice: ethers.BigNumber.from("1000000"),
          odds: [10],
          auctionInitPrice: ethers.BigNumber.from("1000000"),
          auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: ethers.BigNumber.from("1100000000000000000"),
          auctionMinInitPrice: ethers.BigNumber.from("1000000"),
        });

        expect(await rigContract.epochPeriod()).to.equal(600);
        expect(await rigContract.halvingPeriod()).to.equal(SEVEN_DAYS);
      });
    });

    describe("SpinRig: maximum valid parameters", function () {
      it("Should launch with maximum halving period and odds", async function () {
        const { rigContract } = await launchSpinRig(user0, {
          halvingPeriod: ONE_YEAR,
          odds: [8000],
          rigEpochPeriod: ONE_YEAR,
          auctionEpochPeriod: ONE_YEAR,
        });

        expect(await rigContract.halvingPeriod()).to.equal(ONE_YEAR);
        const odds = await rigContract.getOdds();
        expect(odds[0]).to.equal(8000);
      });
    });

    describe("SpinRig: invalid parameters revert correctly", function () {
      it("Should revert with halvingPeriod below minimum (7 days)", async function () {
        const params = {
          launcher: user0.address, quoteToken: weth.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18), tailUps: convert("0.01", 18),
          halvingPeriod: SEVEN_DAYS - 1,
          rigEpochPeriod: ONE_HOUR, rigPriceMultiplier: convert("2", 18),
          rigMinInitPrice: convert("0.0001", 18), odds: [10],
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        };
        await usdc.connect(user0).approve(spinCore.address, params.usdcAmount);
        await expect(spinCore.connect(user0).launch(params)).to.be.revertedWith("SpinRig__HalvingPeriodOutOfRange()");
      });

      it("Should revert with empty odds array", async function () {
        const params = {
          launcher: user0.address, quoteToken: weth.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18), tailUps: convert("0.01", 18),
          halvingPeriod: SEVEN_DAYS, rigEpochPeriod: ONE_HOUR,
          rigPriceMultiplier: convert("2", 18), rigMinInitPrice: convert("0.0001", 18),
          odds: [],
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        };
        await usdc.connect(user0).approve(spinCore.address, params.usdcAmount);
        await expect(spinCore.connect(user0).launch(params)).to.be.revertedWith("SpinRig__InvalidOdds()");
      });

      it("Should revert with odds below MIN_ODDS_BPS (10)", async function () {
        const params = {
          launcher: user0.address, quoteToken: weth.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18), tailUps: convert("0.01", 18),
          halvingPeriod: SEVEN_DAYS, rigEpochPeriod: ONE_HOUR,
          rigPriceMultiplier: convert("2", 18), rigMinInitPrice: convert("0.0001", 18),
          odds: [9],
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        };
        await usdc.connect(user0).approve(spinCore.address, params.usdcAmount);
        await expect(spinCore.connect(user0).launch(params)).to.be.revertedWith("SpinRig__OddsTooLow()");
      });

      it("Should revert with odds above MAX_ODDS_BPS (8000)", async function () {
        const params = {
          launcher: user0.address, quoteToken: weth.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18), tailUps: convert("0.01", 18),
          halvingPeriod: SEVEN_DAYS, rigEpochPeriod: ONE_HOUR,
          rigPriceMultiplier: convert("2", 18), rigMinInitPrice: convert("0.0001", 18),
          odds: [8001],
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        };
        await usdc.connect(user0).approve(spinCore.address, params.usdcAmount);
        await expect(spinCore.connect(user0).launch(params)).to.be.revertedWith("SpinRig__InvalidOdds()");
      });
    });

    describe("FundRig: minimum valid parameters", function () {
      it("Should launch with all minimum valid parameters", async function () {
        const { rigContract } = await launchFundRig(user0, {
          unitAmount: convert("1", 18),
          initialEmission: convert("1", 18),
          minEmission: convert("1", 18),
          halvingPeriod: 7,
          auctionInitPrice: ethers.BigNumber.from("1000000"),
          auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: ethers.BigNumber.from("1100000000000000000"),
          auctionMinInitPrice: ethers.BigNumber.from("1000000"),
        });

        expect(await rigContract.initialEmission()).to.equal(convert("1", 18));
        expect(await rigContract.halvingPeriod()).to.equal(7);
      });
    });

    describe("FundRig: maximum valid parameters", function () {
      it("Should launch with maximum halving period and emission", async function () {
        const { rigContract } = await launchFundRig(user0, {
          initialEmission: ethers.BigNumber.from("1000000000000000000000000000000"),
          minEmission: convert("1", 18),
          halvingPeriod: 365,
          auctionEpochPeriod: ONE_YEAR,
        });

        expect(await rigContract.halvingPeriod()).to.equal(365);
      });
    });

    describe("FundRig: invalid parameters revert correctly", function () {
      it("Should revert with halvingPeriod below minimum (7)", async function () {
        const params = {
          launcher: user0.address, quoteToken: usdc.address, recipient: user1.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialEmission: convert("1000", 18), minEmission: convert("1", 18),
          halvingPeriod: 6,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        };
        await usdc.connect(user0).approve(fundCore.address, params.usdcAmount);
        await expect(fundCore.connect(user0).launch(params)).to.be.revertedWith("FundRig__InvalidHalvingPeriod()");
      });

      it("Should revert with halvingPeriod above maximum (365)", async function () {
        const params = {
          launcher: user0.address, quoteToken: usdc.address, recipient: user1.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialEmission: convert("1000", 18), minEmission: convert("1", 18),
          halvingPeriod: 366,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        };
        await usdc.connect(user0).approve(fundCore.address, params.usdcAmount);
        await expect(fundCore.connect(user0).launch(params)).to.be.revertedWith("FundRig__InvalidHalvingPeriod()");
      });

      it("Should revert with initialEmission below minimum (1e18)", async function () {
        const params = {
          launcher: user0.address, quoteToken: usdc.address, recipient: user1.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialEmission: ethers.BigNumber.from("999999999999999999"),
          minEmission: ethers.BigNumber.from("999999999999999999"),
          halvingPeriod: 30,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        };
        await usdc.connect(user0).approve(fundCore.address, params.usdcAmount);
        await expect(fundCore.connect(user0).launch(params)).to.be.revertedWith("FundRig__InvalidEmission()");
      });

      it("Should revert with minEmission > initialEmission", async function () {
        const params = {
          launcher: user0.address, quoteToken: usdc.address, recipient: user1.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialEmission: convert("100", 18), minEmission: convert("200", 18),
          halvingPeriod: 30,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        };
        await usdc.connect(user0).approve(fundCore.address, params.usdcAmount);
        await expect(fundCore.connect(user0).launch(params)).to.be.revertedWith("FundRig__InvalidEmission()");
      });

      it("Should revert with zero recipient", async function () {
        const params = {
          launcher: user0.address, quoteToken: usdc.address, recipient: AddressZero,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialEmission: convert("1000", 18), minEmission: convert("1", 18),
          halvingPeriod: 30,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        };
        await usdc.connect(user0).approve(fundCore.address, params.usdcAmount);
        await expect(fundCore.connect(user0).launch(params)).to.be.revertedWith("FundCore__ZeroRecipient()");
      });
    });

    describe("Auction: invalid parameter edge cases", function () {
      it("Should revert with auctionInitPrice < auctionMinInitPrice", async function () {
        const params = {
          launcher: user0.address, quoteToken: weth.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18), tailUps: convert("0.01", 18),
          halvingAmount: convert("10000000", 18), rigEpochPeriod: ONE_HOUR,
          rigPriceMultiplier: convert("2", 18), rigMinInitPrice: convert("0.0001", 18),
          upsMultipliers: [convert("1", 18)], upsMultiplierDuration: ONE_DAY,
          auctionInitPrice: convert("0.01", 18),
          auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        };
        await usdc.connect(user0).approve(mineCore.address, params.usdcAmount);
        await expect(mineCore.connect(user0).launch(params)).to.be.revertedWith("Auction__InitPriceOutOfRange()");
      });

      it("Should revert with auctionEpochPeriod below minimum (1 hour)", async function () {
        const params = {
          launcher: user0.address, quoteToken: weth.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18), tailUps: convert("0.01", 18),
          halvingAmount: convert("10000000", 18), rigEpochPeriod: ONE_HOUR,
          rigPriceMultiplier: convert("2", 18), rigMinInitPrice: convert("0.0001", 18),
          upsMultipliers: [convert("1", 18)], upsMultiplierDuration: ONE_DAY,
          auctionInitPrice: convert("1", 18),
          auctionEpochPeriod: ONE_HOUR - 1,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        };
        await usdc.connect(user0).approve(mineCore.address, params.usdcAmount);
        await expect(mineCore.connect(user0).launch(params)).to.be.revertedWith("Auction__EpochPeriodOutOfRange()");
      });

      it("Should revert with auctionPriceMultiplier above maximum (3e18)", async function () {
        const params = {
          launcher: user0.address, quoteToken: weth.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18), tailUps: convert("0.01", 18),
          halvingAmount: convert("10000000", 18), rigEpochPeriod: ONE_HOUR,
          rigPriceMultiplier: convert("2", 18), rigMinInitPrice: convert("0.0001", 18),
          upsMultipliers: [convert("1", 18)], upsMultiplierDuration: ONE_DAY,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: ethers.BigNumber.from("3000000000000000001"),
          auctionMinInitPrice: convert("0.1", 18),
        };
        await usdc.connect(user0).approve(mineCore.address, params.usdcAmount);
        await expect(mineCore.connect(user0).launch(params)).to.be.revertedWith("Auction__PriceMultiplierOutOfRange()");
      });
    });

    describe("Cross-rig parameter validation", function () {
      it("Should revert with zero launcher for all core types", async function () {
        // MineCore
        await usdc.connect(user0).approve(mineCore.address, convert("100", 6));
        await expect(mineCore.connect(user0).launch({
          launcher: AddressZero, quoteToken: weth.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18), tailUps: convert("0.01", 18),
          halvingAmount: convert("10000000", 18), rigEpochPeriod: ONE_HOUR,
          rigPriceMultiplier: convert("2", 18), rigMinInitPrice: convert("0.0001", 18),
          upsMultipliers: [convert("1", 18)], upsMultiplierDuration: ONE_DAY,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        })).to.be.revertedWith("MineCore__ZeroLauncher()");

        // SpinCore
        await usdc.connect(user0).approve(spinCore.address, convert("100", 6));
        await expect(spinCore.connect(user0).launch({
          launcher: AddressZero, quoteToken: weth.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18), tailUps: convert("0.01", 18),
          halvingPeriod: SEVEN_DAYS, rigEpochPeriod: ONE_HOUR,
          rigPriceMultiplier: convert("2", 18), rigMinInitPrice: convert("0.0001", 18),
          odds: [10],
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        })).to.be.revertedWith("SpinCore__ZeroLauncher()");

        // FundCore
        await usdc.connect(user0).approve(fundCore.address, convert("100", 6));
        await expect(fundCore.connect(user0).launch({
          launcher: AddressZero, quoteToken: usdc.address, recipient: user1.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialEmission: convert("1000", 18), minEmission: convert("1", 18),
          halvingPeriod: 30,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        })).to.be.revertedWith("FundCore__ZeroLauncher()");
      });

      it("Should revert with zero quote token for all core types", async function () {
        await usdc.connect(user0).approve(mineCore.address, convert("100", 6));
        await expect(mineCore.connect(user0).launch({
          launcher: user0.address, quoteToken: AddressZero,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18), tailUps: convert("0.01", 18),
          halvingAmount: convert("10000000", 18), rigEpochPeriod: ONE_HOUR,
          rigPriceMultiplier: convert("2", 18), rigMinInitPrice: convert("0.0001", 18),
          upsMultipliers: [convert("1", 18)], upsMultiplierDuration: ONE_DAY,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        })).to.be.revertedWith("MineCore__ZeroQuoteToken()");

        await usdc.connect(user0).approve(spinCore.address, convert("100", 6));
        await expect(spinCore.connect(user0).launch({
          launcher: user0.address, quoteToken: AddressZero,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18), tailUps: convert("0.01", 18),
          halvingPeriod: SEVEN_DAYS, rigEpochPeriod: ONE_HOUR,
          rigPriceMultiplier: convert("2", 18), rigMinInitPrice: convert("0.0001", 18),
          odds: [10],
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        })).to.be.revertedWith("SpinCore__ZeroQuoteToken()");

        await usdc.connect(user0).approve(fundCore.address, convert("100", 6));
        await expect(fundCore.connect(user0).launch({
          launcher: user0.address, quoteToken: AddressZero, recipient: user1.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialEmission: convert("1000", 18), minEmission: convert("1", 18),
          halvingPeriod: 30,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        })).to.be.revertedWith("FundCore__ZeroQuoteToken()");
      });

      it("Should revert with empty token name and symbol", async function () {
        await usdc.connect(user0).approve(mineCore.address, convert("100", 6));
        await expect(mineCore.connect(user0).launch({
          launcher: user0.address, quoteToken: weth.address,
          tokenName: "", tokenSymbol: "X", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18), tailUps: convert("0.01", 18),
          halvingAmount: convert("10000000", 18), rigEpochPeriod: ONE_HOUR,
          rigPriceMultiplier: convert("2", 18), rigMinInitPrice: convert("0.0001", 18),
          upsMultipliers: [convert("1", 18)], upsMultiplierDuration: ONE_DAY,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        })).to.be.revertedWith("MineCore__EmptyTokenName()");

        await usdc.connect(user0).approve(mineCore.address, convert("100", 6));
        await expect(mineCore.connect(user0).launch({
          launcher: user0.address, quoteToken: weth.address,
          tokenName: "X", tokenSymbol: "", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18), tailUps: convert("0.01", 18),
          halvingAmount: convert("10000000", 18), rigEpochPeriod: ONE_HOUR,
          rigPriceMultiplier: convert("2", 18), rigMinInitPrice: convert("0.0001", 18),
          upsMultipliers: [convert("1", 18)], upsMultiplierDuration: ONE_DAY,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        })).to.be.revertedWith("MineCore__EmptyTokenSymbol()");
      });

      it("Should revert with zero unitAmount", async function () {
        await usdc.connect(user0).approve(mineCore.address, convert("100", 6));
        await expect(mineCore.connect(user0).launch({
          launcher: user0.address, quoteToken: weth.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("100", 6), unitAmount: 0,
          initialUps: convert("4", 18), tailUps: convert("0.01", 18),
          halvingAmount: convert("10000000", 18), rigEpochPeriod: ONE_HOUR,
          rigPriceMultiplier: convert("2", 18), rigMinInitPrice: convert("0.0001", 18),
          upsMultipliers: [convert("1", 18)], upsMultiplierDuration: ONE_DAY,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        })).to.be.revertedWith("MineCore__ZeroUnitAmount()");
      });

      it("Should revert with insufficient usdc", async function () {
        await usdc.connect(user0).approve(mineCore.address, convert("50", 6));
        await expect(mineCore.connect(user0).launch({
          launcher: user0.address, quoteToken: weth.address,
          tokenName: "Bad", tokenSymbol: "BAD", uri: "https://example.com/rig",
          usdcAmount: convert("50", 6), unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18), tailUps: convert("0.01", 18),
          halvingAmount: convert("10000000", 18), rigEpochPeriod: ONE_HOUR,
          rigPriceMultiplier: convert("2", 18), rigMinInitPrice: convert("0.0001", 18),
          upsMultipliers: [convert("1", 18)], upsMultiplierDuration: ONE_DAY,
          auctionInitPrice: convert("1", 18), auctionEpochPeriod: ONE_HOUR,
          auctionPriceMultiplier: convert("2", 18), auctionMinInitPrice: convert("0.1", 18),
        })).to.be.revertedWith("MineCore__InsufficientUsdc()");
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 7. ADDITIONAL EDGE CASES
  // ---------------------------------------------------------------------------

  describe("Additional Edge Cases", function () {
    it("SpinRig: spin at price=0 after epoch expires, VRF callback processes", async function () {
      this.timeout(30000);
      const { rigContract, rig, unitContract } = await launchSpinRig(user0);

      await increaseTime(ONE_HOUR + 1);

      const price = await rigContract.getPrice();
      expect(price).to.equal(0);

      const epochId = await rigContract.epochId();
      const entropyFee = await rigContract.getEntropyFee();
      const deadline = await getFutureDeadline();

      await weth.connect(user1).approve(rig, convert("1", 18));
      const tx = await rigContract.connect(user1).spin(
        user1.address, epochId, deadline, convert("1", 18), "", { value: entropyFee }
      );

      const receipt = await tx.wait();
      const entropyEvent = receipt.events.find((e) => e.event === "SpinRig__EntropyRequested");
      expect(entropyEvent).to.not.be.undefined;

      const seqNum = entropyEvent.args.sequenceNumber;
      const randomNumber = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test random"));
      await entropy.fulfillEntropy(seqNum, randomNumber);

      const winFilter = rigContract.filters.SpinRig__Win();
      const winEvents = await rigContract.queryFilter(winFilter);
      expect(winEvents.length).to.be.gt(0);
    });

    it("FundRig: fund below MIN_DONATION should revert", async function () {
      const { rigContract, rig } = await launchFundRig(user0);

      await usdc.connect(user2).approve(rig, 9999);
      await expect(
        rigContract.connect(user2).fund(user2.address, 9999, "")
      ).to.be.revertedWith("FundRig__BelowMinDonation()");
    });

    it("FundRig: double claim for same day should revert", async function () {
      const { rigContract, rig, unitContract } = await launchFundRig(user0);

      const day = await rigContract.currentDay();

      await usdc.connect(user2).approve(rig, convert("100", 6));
      await rigContract.connect(user2).fund(user2.address, convert("100", 6), "");

      await increaseTime(ONE_DAY + 1);

      await rigContract.connect(user2).claim(user2.address, day);

      await expect(
        rigContract.connect(user2).claim(user2.address, day)
      ).to.be.revertedWith("FundRig__AlreadyClaimed()");
    });

    it("FundRig: claim with no donation should revert", async function () {
      const { rigContract, rig } = await launchFundRig(user0);

      const day = await rigContract.currentDay();

      await usdc.connect(user1).approve(rig, convert("100", 6));
      await rigContract.connect(user1).fund(user1.address, convert("100", 6), "");

      await increaseTime(ONE_DAY + 1);

      await expect(
        rigContract.connect(user3).claim(user3.address, day)
      ).to.be.revertedWith("FundRig__NoDonation()");
    });

    it("MineRig: mining slot beyond capacity should revert", async function () {
      const { rigContract } = await launchMineRig(user0);

      const deadline = await getFutureDeadline();
      await expect(
        rigContract.connect(user1).mine(user1.address, 1, 0, deadline, convert("1", 18), "")
      ).to.be.revertedWith("Rig__IndexOutOfBounds()");
    });

    it("MineRig: capacity cannot be decreased", async function () {
      const { rigContract } = await launchMineRig(user0);

      await rigContract.connect(user0).setCapacity(5);

      await expect(
        rigContract.connect(user0).setCapacity(3)
      ).to.be.revertedWith("Rig__CapacityBelowCurrent()");
    });

    it("MineRig: capacity cannot exceed MAX_CAPACITY (256)", async function () {
      const { rigContract } = await launchMineRig(user0);

      await expect(
        rigContract.connect(user0).setCapacity(257)
      ).to.be.revertedWith("Rig__CapacityExceedsMax()");
    });

    it("MineRig: claim with nothing to claim should revert", async function () {
      const { rigContract } = await launchMineRig(user0);

      await expect(
        rigContract.connect(user1).claim(user1.address)
      ).to.be.revertedWith("Rig__NothingToClaim()");
    });

    it("MineRig: claim accumulated miner fees via pull pattern", async function () {
      const { rigContract, rig } = await launchMineRig(user0);

      await increaseTime(ONE_HOUR + 1);
      const slot = await rigContract.getSlot(0);
      const dl = await getFutureDeadline();
      await weth.connect(user1).approve(rig, convert("1", 18));
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, dl, convert("1", 18), "");

      const slot2 = await rigContract.getSlot(0);
      const price2 = await rigContract.getPrice(0);
      if (price2.gt(0)) {
        await weth.connect(user2).approve(rig, price2.add(convert("1", 18)));
        await rigContract.connect(user2).mine(
          user2.address, 0, slot2.epochId, dl, price2.add(convert("1", 18)), ""
        );

        const claimable = await rigContract.accountToClaimable(user1.address);
        if (claimable.gt(0)) {
          const balBefore = await weth.balanceOf(user1.address);
          // Anyone can trigger claim for another user
          await rigContract.connect(user3).claim(user1.address);
          const balAfter = await weth.balanceOf(user1.address);
          expect(balAfter.sub(balBefore)).to.equal(claimable);
        }
      }
    });

    it("SpinRig: spin with zero spinner address should revert", async function () {
      const { rigContract, rig } = await launchSpinRig(user0);

      const epochId = await rigContract.epochId();
      const fee = await rigContract.getEntropyFee();
      const dl = await getFutureDeadline();

      await weth.connect(user1).approve(rig, convert("1", 18));
      await expect(
        rigContract.connect(user1).spin(AddressZero, epochId, dl, convert("1", 18), "", { value: fee })
      ).to.be.revertedWith("SpinRig__ZeroSpinner()");
    });

    it("SpinRig: spin with wrong epochId should revert", async function () {
      const { rigContract, rig } = await launchSpinRig(user0);

      const fee = await rigContract.getEntropyFee();
      const dl = await getFutureDeadline();

      await weth.connect(user1).approve(rig, convert("1", 18));
      await expect(
        rigContract.connect(user1).spin(user1.address, 9999, dl, convert("1", 18), "", { value: fee })
      ).to.be.revertedWith("SpinRig__EpochIdMismatch()");
    });

    it("SpinRig: spin with expired deadline should revert", async function () {
      const { rigContract, rig } = await launchSpinRig(user0);

      const epochId = await rigContract.epochId();
      const fee = await rigContract.getEntropyFee();

      await weth.connect(user1).approve(rig, convert("1", 18));
      await expect(
        rigContract.connect(user1).spin(user1.address, epochId, 1, convert("1", 18), "", { value: fee })
      ).to.be.revertedWith("SpinRig__Expired()");
    });

    it("SpinRig: spin with insufficient entropy fee should revert", async function () {
      const { rigContract, rig } = await launchSpinRig(user0);

      const epochId = await rigContract.epochId();
      const dl = await getFutureDeadline();

      await weth.connect(user1).approve(rig, convert("1", 18));
      await expect(
        rigContract.connect(user1).spin(user1.address, epochId, dl, convert("1", 18), "", { value: 0 })
      ).to.be.revertedWith("SpinRig__InsufficientFee()");
    });

    it("MineRig: mine with zero miner address should revert", async function () {
      const { rigContract } = await launchMineRig(user0);

      const slot = await rigContract.getSlot(0);
      const dl = await getFutureDeadline();

      await expect(
        rigContract.connect(user1).mine(AddressZero, 0, slot.epochId, dl, convert("1", 18), "")
      ).to.be.revertedWith("Rig__ZeroMiner()");
    });

    it("MineRig: mine with expired deadline should revert", async function () {
      const { rigContract } = await launchMineRig(user0);

      const slot = await rigContract.getSlot(0);

      await expect(
        rigContract.connect(user1).mine(user1.address, 0, slot.epochId, 1, convert("1", 18), "")
      ).to.be.revertedWith("Rig__DeadlinePassed()");
    });

    it("MineRig: mine with wrong epochId should revert", async function () {
      const { rigContract, rig } = await launchMineRig(user0);

      const slot = await rigContract.getSlot(0);
      const wrongEpochId = slot.epochId.add(99);
      const dl = await getFutureDeadline();

      await weth.connect(user1).approve(rig, convert("1", 18));
      await expect(
        rigContract.connect(user1).mine(user1.address, 0, wrongEpochId, dl, convert("1", 18), "")
      ).to.be.revertedWith("Rig__EpochIdMismatch()");
    });

    it("FundRig: fund to zero address should revert", async function () {
      const { rigContract, rig } = await launchFundRig(user0);

      await usdc.connect(user1).approve(rig, convert("100", 6));
      await expect(
        rigContract.connect(user1).fund(AddressZero, convert("100", 6), "")
      ).to.be.revertedWith("FundRig__ZeroAddress()");
    });

    it("FundRig: claim to zero address should revert", async function () {
      const { rigContract, rig } = await launchFundRig(user0);

      await usdc.connect(user1).approve(rig, convert("100", 6));
      await rigContract.connect(user1).fund(user1.address, convert("100", 6), "");

      await increaseTime(ONE_DAY + 1);

      const day = await rigContract.currentDay();
      // Claim for a completed day (day - 1 or whatever day the donation was on)
      await expect(
        rigContract.connect(user1).claim(AddressZero, day.sub(1))
      ).to.be.revertedWith("FundRig__ZeroAddress()");
    });

    it("MineRig: UPS never falls below tailUps after many mines", async function () {
      const { rigContract, rig } = await launchMineRig(user0, {
        initialUps: convert("10000", 18),
        tailUps: convert("1", 18),
        halvingAmount: convert("1000", 18),
        rigEpochPeriod: 600,
      });

      for (let i = 0; i < 20; i++) {
        await increaseTime(601);
        const slot = await rigContract.getSlot(0);
        const dl = await getFutureDeadline();
        await weth.connect(user1).approve(rig, convert("1", 18));
        await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, dl, convert("1", 18), "");
      }

      const ups = await rigContract.getUps();
      const tailUps = await rigContract.tailUps();
      expect(ups).to.be.gte(tailUps);
    });

    it("SpinRig: UPS never falls below tailUps after many halvings", async function () {
      const { rigContract } = await launchSpinRig(user0);

      // Fast forward 2 years
      await increaseTime(ONE_YEAR * 2);

      const ups = await rigContract.getUps();
      const tailUps = await rigContract.tailUps();
      expect(ups).to.equal(tailUps);
    });

    it("FundRig: emission never falls below minEmission after many halvings", async function () {
      const { rigContract } = await launchFundRig(user0, {
        initialEmission: convert("1000", 18),
        minEmission: convert("1", 18),
        halvingPeriod: 7,
      });

      const emission = await rigContract.getDayEmission(10000);
      const minEmission = await rigContract.minEmission();
      expect(emission).to.equal(minEmission);
    });
  });
});
