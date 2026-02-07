/**
 * @title Comprehensive Security Invariant Test Suite
 * @notice 23 invariants across Unit, MineRig, SpinRig, FundRig, and Auction contracts
 * @dev Each invariant is tested as a separate test case with self-contained setup
 */

const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const convert = (amount, decimals = 18) => ethers.utils.parseUnits(amount.toString(), decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;

const AddressZero = "0x0000000000000000000000000000000000000000";
const PRECISION = ethers.BigNumber.from("1000000000000000000"); // 1e18

// Time helpers
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

// ============================================================================
// UNIT INVARIANTS (INV-UNIT-1 through INV-UNIT-3)
// ============================================================================

describe("Unit Invariants", function () {
  let owner, protocol, team, user0, user1, user2, user3, attacker;
  let weth, usdc, registry, mineCore, entropy;
  let rigAddress, rigContract, auctionAddress, unitAddress, unitContract;

  before("Deploy fresh contracts for Unit invariants", async function () {
    await network.provider.send("hardhat_reset");

    [owner, protocol, team, user0, user1, user2, user3, attacker] = await ethers.getSigners();

    // Deploy mock tokens
    const MockWETH = await ethers.getContractFactory("MockWETH");
    weth = await MockWETH.deploy();

    // Deploy MockUSDC (6 decimals)
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    // Deploy mock Entropy
    const MockEntropy = await ethers.getContractFactory("MockEntropy");
    entropy = await MockEntropy.deploy();

    // Deploy mock Uniswap
    const MockUniswapV2Factory = await ethers.getContractFactory("MockUniswapV2Factory");
    const uniswapFactory = await MockUniswapV2Factory.deploy();
    const MockUniswapV2Router = await ethers.getContractFactory("MockUniswapV2Router");
    const uniswapRouter = await MockUniswapV2Router.deploy(uniswapFactory.address);

    // Deploy Registry
    const Registry = await ethers.getContractFactory("Registry");
    registry = await Registry.deploy();

    // Deploy factories
    const UnitFactory = await ethers.getContractFactory("UnitFactory");
    const unitFactory = await UnitFactory.deploy();
    const MineRigFactory = await ethers.getContractFactory("MineRigFactory");
    const rigFactory = await MineRigFactory.deploy();
    const AuctionFactory = await ethers.getContractFactory("AuctionFactory");
    const auctionFactory = await AuctionFactory.deploy();

    // Deploy MineCore
    const MineCore = await ethers.getContractFactory("MineCore");
    mineCore = await MineCore.deploy(
      registry.address,
      usdc.address,
      uniswapFactory.address,
      uniswapRouter.address,
      unitFactory.address,
      rigFactory.address,
      auctionFactory.address,
      entropy.address,
      protocol.address,
      convert("100", 6)
    );

    await registry.setFactoryApproval(mineCore.address, true);

    // Fund users
    await usdc.mint(user0.address, convert("5000", 6));
    await weth.connect(user0).deposit({ value: convert("500", 18) });
    await weth.connect(user1).deposit({ value: convert("500", 18) });
    await weth.connect(user2).deposit({ value: convert("500", 18) });
    await weth.connect(attacker).deposit({ value: convert("500", 18) });

    // Launch a MineRig to get a Unit token
    const launchParams = {
      launcher: user0.address,
      quoteToken: weth.address,
      tokenName: "Unit Invariant Test",
      tokenSymbol: "UINV",
      uri: "https://example.com/rig",
      usdcAmount: convert("1000", 6),
      unitAmount: convert("1000000", 18),
      initialUps: convert("10", 18),
      tailUps: convert("0.1", 18),
      halvingAmount: convert("100000", 18),
      rigEpochPeriod: ONE_HOUR,
      rigPriceMultiplier: convert("2", 18),
      rigMinInitPrice: convert("0.001", 18),
      upsMultipliers: [convert("1", 18)],
      upsMultiplierDuration: ONE_DAY,
      auctionInitPrice: convert("1", 18),
      auctionEpochPeriod: ONE_DAY,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("0.01", 18),
    };

    await usdc.connect(user0).approve(mineCore.address, launchParams.usdcAmount);
    const tx = await mineCore.connect(user0).launch(launchParams);
    const receipt = await tx.wait();

    const launchEvent = receipt.events.find((e) => e.event === "MineCore__Launched");
    rigAddress = launchEvent.args.rig;
    unitAddress = launchEvent.args.unit;
    auctionAddress = launchEvent.args.auction;

    rigContract = await ethers.getContractAt("MineRig", rigAddress);
    unitContract = await ethers.getContractAt("Unit", unitAddress);

    // Disable entropy for tests that don't send ETH for VRF fees
    await rigContract.connect(user0).setEntropyEnabled(false);

    await rigContract.connect(user0).setTeam(team.address);
  });

  describe("INV-UNIT-1: totalSupply() only increases via mint, decreases via burn", function () {
    it("totalSupply increases after mint (triggered by mining)", async function () {
      // Mine slot to set up a miner
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rigAddress, convert("10", 18));
      const deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("10", 18), "");

      const supplyBefore = await unitContract.totalSupply();

      // Wait to accumulate tokens, then mine again to trigger mint
      await increaseTime(100);

      slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);
      await weth.connect(user2).approve(rigAddress, price.add(convert("1", 18)));
      const deadline2 = await getFutureDeadline();
      await rigContract.connect(user2).mine(user2.address, 0, slot.epochId, deadline2, price.add(convert("1", 18)), "");

      const supplyAfter = await unitContract.totalSupply();
      expect(supplyAfter).to.be.gt(supplyBefore);
    });

    it("totalSupply decreases after burn", async function () {
      // user1 should have tokens from the previous mine displacement
      const user1Balance = await unitContract.balanceOf(user1.address);
      expect(user1Balance).to.be.gt(0);

      const supplyBefore = await unitContract.totalSupply();
      const burnAmount = user1Balance.div(2);

      await unitContract.connect(user1).burn(burnAmount);

      const supplyAfter = await unitContract.totalSupply();
      expect(supplyAfter).to.equal(supplyBefore.sub(burnAmount));
    });
  });

  describe("INV-UNIT-2: After setRig() called once, rigLocked == true and rig is permanent", function () {
    it("rigLocked is true after launch (setRig was called by Core)", async function () {
      const rigLocked = await unitContract.rigLocked();
      expect(rigLocked).to.equal(true);
    });

    it("rig address equals the MineRig address and cannot change", async function () {
      const rigAddr = await unitContract.rig();
      expect(rigAddr).to.equal(rigAddress);

      // Attempting to call setRig again should revert
      await expect(
        unitContract.connect(user0).setRig(attacker.address)
      ).to.be.revertedWith("Unit__NotRig()");
    });
  });

  describe("INV-UNIT-3: mint() only callable by rig address", function () {
    it("mint() reverts when called by non-rig address", async function () {
      await expect(
        unitContract.connect(attacker).mint(attacker.address, convert("1000", 18))
      ).to.be.revertedWith("Unit__NotRig()");
    });

    it("mint() reverts when called by owner", async function () {
      await expect(
        unitContract.connect(owner).mint(owner.address, convert("1000", 18))
      ).to.be.revertedWith("Unit__NotRig()");
    });

    it("mint() reverts when called by the launcher", async function () {
      await expect(
        unitContract.connect(user0).mint(user0.address, convert("1000", 18))
      ).to.be.revertedWith("Unit__NotRig()");
    });
  });
});

// ============================================================================
// MINE RIG INVARIANTS (INV-MINE-1 through INV-MINE-7)
// ============================================================================

describe("MineRig Invariants", function () {
  let owner, protocol, team, user0, user1, user2, user3, attacker;
  let weth, usdc, registry, mineCore, entropy;
  let rigAddress, rigContract, auctionAddress, unitAddress, unitContract;

  before("Deploy fresh contracts for MineRig invariants", async function () {
    await network.provider.send("hardhat_reset");

    [owner, protocol, team, user0, user1, user2, user3, attacker] = await ethers.getSigners();

    const MockWETH = await ethers.getContractFactory("MockWETH");
    weth = await MockWETH.deploy();

    // Deploy MockUSDC (6 decimals)
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    const MockEntropy = await ethers.getContractFactory("MockEntropy");
    entropy = await MockEntropy.deploy();

    const MockUniswapV2Factory = await ethers.getContractFactory("MockUniswapV2Factory");
    const uniswapFactory = await MockUniswapV2Factory.deploy();
    const MockUniswapV2Router = await ethers.getContractFactory("MockUniswapV2Router");
    const uniswapRouter = await MockUniswapV2Router.deploy(uniswapFactory.address);

    const Registry = await ethers.getContractFactory("Registry");
    registry = await Registry.deploy();

    const UnitFactory = await ethers.getContractFactory("UnitFactory");
    const unitFactory = await UnitFactory.deploy();
    const MineRigFactory = await ethers.getContractFactory("MineRigFactory");
    const rigFactory = await MineRigFactory.deploy();
    const AuctionFactory = await ethers.getContractFactory("AuctionFactory");
    const auctionFactory = await AuctionFactory.deploy();

    const MineCore = await ethers.getContractFactory("MineCore");
    mineCore = await MineCore.deploy(
      registry.address,
      usdc.address,
      uniswapFactory.address,
      uniswapRouter.address,
      unitFactory.address,
      rigFactory.address,
      auctionFactory.address,
      entropy.address,
      protocol.address,
      convert("100", 6)
    );

    await registry.setFactoryApproval(mineCore.address, true);

    await usdc.mint(user0.address, convert("5000", 6));
    await weth.connect(user0).deposit({ value: convert("500", 18) });
    await weth.connect(user1).deposit({ value: convert("500", 18) });
    await weth.connect(user2).deposit({ value: convert("500", 18) });
    await weth.connect(user3).deposit({ value: convert("500", 18) });
    await weth.connect(attacker).deposit({ value: convert("500", 18) });

    const launchParams = {
      launcher: user0.address,
      quoteToken: weth.address,
      tokenName: "Mine Invariant Test",
      tokenSymbol: "MINV",
      uri: "https://example.com/rig",
      usdcAmount: convert("1000", 6),
      unitAmount: convert("1000000", 18),
      initialUps: convert("10", 18),
      tailUps: convert("0.1", 18),
      halvingAmount: convert("100000", 18),
      rigEpochPeriod: ONE_HOUR,
      rigPriceMultiplier: convert("2", 18),
      rigMinInitPrice: convert("0.001", 18),
      upsMultipliers: [convert("1", 18)],
      upsMultiplierDuration: ONE_DAY,
      auctionInitPrice: convert("1", 18),
      auctionEpochPeriod: ONE_DAY,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("0.01", 18),
    };

    await usdc.connect(user0).approve(mineCore.address, launchParams.usdcAmount);
    const tx = await mineCore.connect(user0).launch(launchParams);
    const receipt = await tx.wait();

    const launchEvent = receipt.events.find((e) => e.event === "MineCore__Launched");
    rigAddress = launchEvent.args.rig;
    unitAddress = launchEvent.args.unit;
    auctionAddress = launchEvent.args.auction;

    rigContract = await ethers.getContractAt("MineRig", rigAddress);
    unitContract = await ethers.getContractAt("Unit", unitAddress);

    // Disable entropy for tests that don't send ETH for VRF fees
    await rigContract.connect(user0).setEntropyEnabled(false);

    await rigContract.connect(user0).setTeam(team.address);
  });

  describe("INV-MINE-1: totalMinted monotonically non-decreasing", function () {
    it("totalMinted never decreases across multiple mine operations", async function () {
      let prevTotalMinted = await rigContract.totalMinted();

      for (let i = 0; i < 5; i++) {
        const slot = await rigContract.getSlot(0);
        const epochPeriod = await rigContract.epochPeriod();
        await increaseTime(epochPeriod.toNumber() + 1);

        const deadline = await getFutureDeadline();
        await weth.connect(user1).approve(rigAddress, convert("10", 18));
        await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("10", 18), "");

        const currentTotalMinted = await rigContract.totalMinted();
        expect(currentTotalMinted).to.be.gte(prevTotalMinted);
        prevTotalMinted = currentTotalMinted;
      }
    });
  });

  describe("INV-MINE-2: getPrice(index) always in [0, slot.initPrice]", function () {
    it("getPrice returns value between 0 and slot.initPrice at various time points", async function () {
      // Mine to reset slot with known initPrice
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rigAddress, convert("10", 18));
      const deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("10", 18), "");

      slot = await rigContract.getSlot(0);
      const initPrice = slot.initPrice;
      const epochPeriod = await rigContract.epochPeriod();

      // Check at several time points within the epoch
      const checkPoints = [0, epochPeriod.toNumber() / 4, epochPeriod.toNumber() / 2, epochPeriod.toNumber() * 3 / 4];
      for (const offset of checkPoints) {
        if (offset > 0) await increaseTime(offset);
        const price = await rigContract.getPrice(0);
        expect(price).to.be.gte(0);
        expect(price).to.be.lte(initPrice);
      }

      // Past epoch end
      await increaseTime(epochPeriod.toNumber());
      const pricePastEnd = await rigContract.getPrice(0);
      expect(pricePastEnd).to.equal(0);
    });
  });

  describe("INV-MINE-3: Fee sum == price for all mine operations", function () {
    it("minerFee + protocolFee + teamFee + treasuryFee == price", async function () {
      // Set up: mine to establish a miner
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rigAddress, convert("10", 18));
      let deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("10", 18), "");

      // Get fresh slot state and price
      slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      if (price.eq(0)) {
        this.skip();
        return;
      }

      const prevMiner = slot.miner;
      const minerClaimableBefore = await rigContract.accountToClaimable(prevMiner);
      const treasuryBefore = await weth.balanceOf(auctionAddress);
      const protocolBefore = await weth.balanceOf(protocol.address);
      const teamBefore = await weth.balanceOf(team.address);

      await weth.connect(user2).approve(rigAddress, price.add(convert("1", 18)));
      deadline = await getFutureDeadline();
      const tx = await rigContract.connect(user2).mine(user2.address, 0, slot.epochId, deadline, price.add(convert("1", 18)), "");
      const receipt = await tx.wait();
      const mineEvent = receipt.events.find(e => e.event === "MineRig__Mine");
      const actualPrice = mineEvent.args.price;

      const minerClaimableAfter = await rigContract.accountToClaimable(prevMiner);
      const treasuryAfter = await weth.balanceOf(auctionAddress);
      const protocolAfter = await weth.balanceOf(protocol.address);
      const teamAfter = await weth.balanceOf(team.address);

      const minerFee = minerClaimableAfter.sub(minerClaimableBefore);
      const treasuryFee = treasuryAfter.sub(treasuryBefore);
      const protocolFee = protocolAfter.sub(protocolBefore);
      const teamFee = teamAfter.sub(teamBefore);

      const totalFees = minerFee.add(treasuryFee).add(protocolFee).add(teamFee);
      expect(totalFees).to.be.closeTo(actualPrice, 1);
    });
  });

  describe("INV-MINE-4: getUps() >= tailUps always holds", function () {
    it("UPS never drops below tailUps regardless of mining activity", async function () {
      const tailUps = await rigContract.tailUps();

      // Mine many times to push totalMinted up (may trigger halvings)
      for (let i = 0; i < 10; i++) {
        const slot = await rigContract.getSlot(0);
        const epochPeriod = await rigContract.epochPeriod();
        await increaseTime(epochPeriod.toNumber() + 1);

        const deadline = await getFutureDeadline();
        await weth.connect(user1).approve(rigAddress, convert("10", 18));
        await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("10", 18), "");

        const currentUps = await rigContract.getUps();
        expect(currentUps).to.be.gte(tailUps);
      }
    });
  });

  describe("INV-MINE-5: After claim(), accountToClaimable[account] == 0", function () {
    it("Claimable balance resets to zero after claim", async function () {
      // Build up claimable balance: user1 mines, then user2 displaces
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rigAddress, convert("10", 18));
      let deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("10", 18), "");

      slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      if (price.gt(0)) {
        await weth.connect(user2).approve(rigAddress, price.add(convert("1", 18)));
        deadline = await getFutureDeadline();
        await rigContract.connect(user2).mine(user2.address, 0, slot.epochId, deadline, price.add(convert("1", 18)), "");
      }

      const claimable = await rigContract.accountToClaimable(user1.address);

      if (claimable.gt(0)) {
        await rigContract.claim(user1.address);
        const claimableAfter = await rigContract.accountToClaimable(user1.address);
        expect(claimableAfter).to.equal(0);
      }
    });
  });

  describe("INV-MINE-6: epochId per slot only increases", function () {
    it("epochId increments by exactly 1 on each mine", async function () {
      const slot = await rigContract.getSlot(0);
      const epochIdBefore = slot.epochId;

      await weth.connect(user1).approve(rigAddress, convert("10", 18));
      const deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("10", 18), "");

      const newSlot = await rigContract.getSlot(0);
      expect(newSlot.epochId).to.equal(epochIdBefore.add(1));
    });

    it("epochId monotonically increases across multiple mines", async function () {
      let prevEpochId = (await rigContract.getSlot(0)).epochId;

      for (let i = 0; i < 3; i++) {
        const slot = await rigContract.getSlot(0);
        const epochPeriod = await rigContract.epochPeriod();
        await increaseTime(epochPeriod.toNumber() + 1);

        const deadline = await getFutureDeadline();
        await weth.connect(user1).approve(rigAddress, convert("10", 18));
        await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("10", 18), "");

        const currentEpochId = (await rigContract.getSlot(0)).epochId;
        expect(currentEpochId).to.be.gt(prevEpochId);
        prevEpochId = currentEpochId;
      }
    });
  });

  describe("INV-MINE-7: Rig quote token balance == sum of all accountToClaimable values", function () {
    it("Rig balance matches total claimable amounts", async function () {
      // Get the rig's quote token balance
      const rigBalance = await weth.balanceOf(rigAddress);

      // Check known claimable accounts (user1, user2 may have claimable)
      const claimable1 = await rigContract.accountToClaimable(user1.address);
      const claimable2 = await rigContract.accountToClaimable(user2.address);
      const claimable3 = await rigContract.accountToClaimable(user3.address);
      const claimableAttacker = await rigContract.accountToClaimable(attacker.address);

      const totalClaimable = claimable1.add(claimable2).add(claimable3).add(claimableAttacker);

      // The rig's quote token balance should be exactly the sum of all claimable amounts.
      // Since we know all accounts that interacted, this should hold.
      expect(rigBalance).to.equal(totalClaimable);
    });
  });
});

// ============================================================================
// SPIN RIG INVARIANTS (INV-SPIN-1 through INV-SPIN-5)
// ============================================================================

describe("SpinRig Invariants", function () {
  let owner, protocol, team, user0, user1, user2, user3, attacker;
  let paymentToken, unitToken, rig, mockEntropy, mockCore;

  before("Deploy fresh contracts for SpinRig invariants", async function () {
    await network.provider.send("hardhat_reset");

    [owner, protocol, team, user0, user1, user2, user3, attacker] = await ethers.getSigners();

    // Deploy mock USDC (6 decimals)
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    paymentToken = await MockUSDC.deploy();

    // Deploy mock Entropy
    const MockEntropy = await ethers.getContractFactory("MockEntropy");
    mockEntropy = await MockEntropy.deploy();

    // Deploy mock Core
    const MockCore = await ethers.getContractFactory("MockCore");
    mockCore = await MockCore.deploy(protocol.address);

    // Deploy Unit token
    const Unit = await ethers.getContractFactory("Unit");
    unitToken = await Unit.deploy("Spin Invariant Unit", "SINV", owner.address);

    // Deploy SpinRig with multiple odds values for testing
    const SpinRig = await ethers.getContractFactory("SpinRig");
    const config = {
      epochPeriod: ONE_HOUR,
      priceMultiplier: convert("2", 18),
      minInitPrice: convert("1", 6), // 1 USDC
      initialUps: convert("100", 18), // High for testing
      halvingPeriod: THIRTY_DAYS,
      tailUps: convert("1", 18),
      odds: [10, 100, 500, 1000, 5000],
    };

    rig = await SpinRig.deploy(
      unitToken.address,
      paymentToken.address,
      mockCore.address,
      owner.address, // treasury
      AddressZero, // team (set later via setTeam)
      mockEntropy.address,
      config
    );

    // Grant minting rights
    await unitToken.setRig(rig.address);

    // Set team
    await rig.connect(owner).setTeam(team.address);

    // Fund users
    await paymentToken.mint(user0.address, convert("100000", 6));
    await paymentToken.mint(user1.address, convert("100000", 6));
    await paymentToken.mint(user2.address, convert("100000", 6));
  });

  describe("INV-SPIN-1: Prize pool only changes via emissions (up) or payouts (down)", function () {
    it("Prize pool increases after spin (via emissions minted into pool)", async function () {
      const poolBefore = await rig.getPrizePool();

      // Wait for emissions to accumulate
      await increaseTime(ONE_HOUR);

      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));
      await rig.connect(user0).spin(user0.address, epochId, await getFutureDeadline(), convert("1000", 6), "", { value: fee });

      const poolAfter = await rig.getPrizePool();
      // Pool should increase because emissions were minted
      expect(poolAfter).to.be.gt(poolBefore);
    });

    it("Prize pool decreases after entropy callback payout", async function () {
      // Accumulate more emissions
      await increaseTime(ONE_HOUR * 2);

      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user1).approve(rig.address, convert("1000", 6));
      const tx = await rig.connect(user1).spin(user1.address, epochId, await getFutureDeadline(), convert("1000", 6), "", { value: fee });
      const receipt = await tx.wait();
      const entropyEvent = receipt.events.find(e => e.event === "SpinRig__EntropyRequested");
      const sequenceNumber = entropyEvent.args.sequenceNumber;

      const poolBeforeCallback = await rig.getPrizePool();

      // Fulfill entropy with a known random value
      const randomNumber = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test_payout"));
      await mockEntropy.fulfillEntropy(sequenceNumber, randomNumber);

      const poolAfterCallback = await rig.getPrizePool();

      // Prize pool should decrease or stay the same (payout occurred)
      expect(poolAfterCallback).to.be.lte(poolBeforeCallback);
    });
  });

  describe("INV-SPIN-2: _drawOdds() returns value in [MIN_ODDS_BPS(10), MAX_ODDS_BPS(8000)]", function () {
    it("Entropy callback always produces odds in valid range", async function () {
      // Test with various random values
      const randomValues = [
        ethers.utils.hexZeroPad("0x00", 32),
        ethers.utils.hexZeroPad("0x01", 32),
        ethers.utils.hexZeroPad("0x42", 32),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("random1")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("random2")),
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("random3")),
        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      ];

      for (const randomValue of randomValues) {
        // Accumulate emissions
        await increaseTime(ONE_HOUR + 1);

        const epochId = await rig.epochId();
        const fee = await rig.getEntropyFee();

        await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));
        const tx = await rig.connect(user0).spin(user0.address, epochId, await getFutureDeadline(), convert("1000", 6), "", { value: fee });
        const receipt = await tx.wait();
        const entropyEvent = receipt.events.find(e => e.event === "SpinRig__EntropyRequested");
        const sequenceNumber = entropyEvent.args.sequenceNumber;

        await mockEntropy.fulfillEntropy(sequenceNumber, randomValue);

        // Check the Win event to verify odds
        const winEvents = await rig.queryFilter(rig.filters.SpinRig__Win());
        const latestWin = winEvents[winEvents.length - 1];
        const oddsBps = latestWin.args.oddsBps;

        expect(oddsBps).to.be.gte(10); // MIN_ODDS_BPS
        expect(oddsBps).to.be.lte(8000); // MAX_ODDS_BPS
      }
    });
  });

  describe("INV-SPIN-3: Win amount <= 80% of prize pool at callback time", function () {
    it("Payout never exceeds 80% of the prize pool", async function () {
      // Accumulate significant emissions
      await increaseTime(ONE_HOUR * 3);

      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user2).approve(rig.address, convert("1000", 6));
      const tx = await rig.connect(user2).spin(user2.address, epochId, await getFutureDeadline(), convert("1000", 6), "", { value: fee });
      const receipt = await tx.wait();
      const entropyEvent = receipt.events.find(e => e.event === "SpinRig__EntropyRequested");
      const sequenceNumber = entropyEvent.args.sequenceNumber;

      // Get pool size before callback
      const poolBeforeCallback = await rig.getPrizePool();

      const randomNumber = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("max_win_test"));
      await mockEntropy.fulfillEntropy(sequenceNumber, randomNumber);

      const winEvents = await rig.queryFilter(rig.filters.SpinRig__Win());
      const latestWin = winEvents[winEvents.length - 1];
      const winAmount = latestWin.args.amount;

      // MAX_ODDS_BPS is 8000 = 80%, so win should never exceed 80% of pool
      const maxPayout = poolBeforeCallback.mul(8000).div(10000);
      expect(winAmount).to.be.lte(maxPayout);
    });
  });

  describe("INV-SPIN-4: Fee sum == price for all spins", function () {
    it("treasuryFee + teamFee + protocolFee == price", async function () {
      await increaseTime(ONE_HOUR + 1);

      // Spin to get a fresh epoch with known price
      let epochId = await rig.epochId();
      let fee = await rig.getEntropyFee();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));
      await rig.connect(user0).spin(user0.address, epochId, await getFutureDeadline(), convert("1000", 6), "", { value: fee });

      // Now spin again immediately to get a non-zero price
      const price = await rig.getPrice();
      if (price.eq(0)) {
        this.skip();
        return;
      }

      const treasuryBefore = await paymentToken.balanceOf(owner.address); // owner is treasury
      const teamBefore = await paymentToken.balanceOf(team.address);
      const protocolBefore = await paymentToken.balanceOf(protocol.address);

      epochId = await rig.epochId();
      fee = await rig.getEntropyFee();

      await paymentToken.connect(user1).approve(rig.address, price.add(convert("100", 6)));
      const tx = await rig.connect(user1).spin(user1.address, epochId, await getFutureDeadline(), price.add(convert("100", 6)), "", { value: fee });
      const receipt = await tx.wait();
      const spinEvent = receipt.events.find(e => e.event === "SpinRig__Spin");
      const actualPrice = spinEvent.args.price;

      const treasuryAfter = await paymentToken.balanceOf(owner.address);
      const teamAfter = await paymentToken.balanceOf(team.address);
      const protocolAfter = await paymentToken.balanceOf(protocol.address);

      const treasuryReceived = treasuryAfter.sub(treasuryBefore);
      const teamReceived = teamAfter.sub(teamBefore);
      const protocolReceived = protocolAfter.sub(protocolBefore);

      const totalFees = treasuryReceived.add(teamReceived).add(protocolReceived);
      expect(totalFees).to.be.closeTo(actualPrice, 1);
    });
  });

  describe("INV-SPIN-5: lastEmissionTime monotonically non-decreasing", function () {
    it("lastEmissionTime never decreases across multiple spins", async function () {
      let prevEmissionTime = await rig.lastEmissionTime();

      for (let i = 0; i < 3; i++) {
        await increaseTime(ONE_HOUR + 1);

        const epochId = await rig.epochId();
        const fee = await rig.getEntropyFee();

        await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));
        await rig.connect(user0).spin(user0.address, epochId, await getFutureDeadline(), convert("1000", 6), "", { value: fee });

        const currentEmissionTime = await rig.lastEmissionTime();
        expect(currentEmissionTime).to.be.gte(prevEmissionTime);
        prevEmissionTime = currentEmissionTime;
      }
    });
  });
});

// ============================================================================
// FUND RIG INVARIANTS (INV-FUND-1 through INV-FUND-5)
// ============================================================================

describe("FundRig Invariants", function () {
  let owner, protocol, team, treasury, recipient, user0, user1, user2, attacker;
  let paymentToken, unitToken, rig, mockCore;

  before("Deploy fresh contracts for FundRig invariants", async function () {
    await network.provider.send("hardhat_reset");

    [owner, protocol, team, treasury, recipient, user0, user1, user2, attacker] = await ethers.getSigners();

    // Deploy mock WETH as payment token
    const MockWETH = await ethers.getContractFactory("MockWETH");
    paymentToken = await MockWETH.deploy();

    // Deploy mock Core
    const MockCore = await ethers.getContractFactory("MockCore");
    mockCore = await MockCore.deploy(protocol.address);

    // Deploy Unit token
    const Unit = await ethers.getContractFactory("Unit");
    unitToken = await Unit.deploy("Fund Invariant Unit", "FINV", owner.address);

    // Deploy FundRig
    const FundRig = await ethers.getContractFactory("FundRig");
    rig = await FundRig.deploy(
      unitToken.address,
      paymentToken.address,
      mockCore.address,
      treasury.address,
      team.address,
      recipient.address,
      [convert("1000", 18), convert("10", 18), 30] // Config: {initialEmission, minEmission, halvingPeriod}
    );

    // Grant minting rights
    await unitToken.setRig(rig.address);

    // Fund users
    await paymentToken.connect(user0).deposit({ value: convert("5000", 18) });
    await paymentToken.connect(user1).deposit({ value: convert("5000", 18) });
    await paymentToken.connect(user2).deposit({ value: convert("5000", 18) });
  });

  describe("INV-FUND-1: dayToTotalDonated[day] == sum of all individual user donations for that day", function () {
    it("Day total equals sum of individual donations from multiple users", async function () {
      const currentDay = await rig.currentDay();

      const amounts = [convert("100", 18), convert("200", 18), convert("50", 18)];
      const users = [user0, user1, user2];

      for (let i = 0; i < users.length; i++) {
        await paymentToken.connect(users[i]).approve(rig.address, amounts[i]);
        await rig.connect(users[i]).fund(users[i].address, amounts[i], "");
      }

      const dayTotal = await rig.dayToTotalDonated(currentDay);
      let sumOfIndividual = ethers.BigNumber.from(0);
      for (let i = 0; i < users.length; i++) {
        const donation = await rig.dayAccountToDonation(currentDay, users[i].address);
        sumOfIndividual = sumOfIndividual.add(donation);
      }

      expect(dayTotal).to.equal(sumOfIndividual);
    });

    it("Multiple donations from same user accumulate correctly in day total", async function () {
      await increaseTime(ONE_DAY);
      const currentDay = await rig.currentDay();

      const amount1 = convert("75", 18);
      const amount2 = convert("125", 18);

      await paymentToken.connect(user0).approve(rig.address, amount1.add(amount2));
      await rig.connect(user0).fund(user0.address, amount1, "");
      await rig.connect(user0).fund(user0.address, amount2, "");

      const dayTotal = await rig.dayToTotalDonated(currentDay);
      const user0Donation = await rig.dayAccountToDonation(currentDay, user0.address);

      expect(dayTotal).to.equal(amount1.add(amount2));
      expect(user0Donation).to.equal(amount1.add(amount2));
    });
  });

  describe("INV-FUND-2: Sum of all claims for a day <= getDayEmission(day)", function () {
    it("Total claimed tokens for a day does not exceed day emission", async function () {
      await increaseTime(ONE_DAY);
      const claimDay = await rig.currentDay();

      // Three users donate
      const amounts = [convert("300", 18), convert("200", 18), convert("100", 18)];
      const users = [user0, user1, user2];

      for (let i = 0; i < users.length; i++) {
        await paymentToken.connect(users[i]).approve(rig.address, amounts[i]);
        await rig.connect(users[i]).fund(users[i].address, amounts[i], "");
      }

      // Move to next day to allow claiming
      await increaseTime(ONE_DAY);

      const dayEmission = await rig.getDayEmission(claimDay);
      let totalClaimed = ethers.BigNumber.from(0);

      for (let i = 0; i < users.length; i++) {
        const balBefore = await unitToken.balanceOf(users[i].address);
        await rig.claim(users[i].address, claimDay);
        const balAfter = await unitToken.balanceOf(users[i].address);
        totalClaimed = totalClaimed.add(balAfter.sub(balBefore));
      }

      // Total claimed should be <= dayEmission (may be slightly less due to rounding)
      expect(totalClaimed).to.be.lte(dayEmission);
      // But it should be very close (within 3 wei rounding for 3 users)
      expect(totalClaimed).to.be.closeTo(dayEmission, 3);
    });
  });

  describe("INV-FUND-3: No account claims twice for same day", function () {
    it("Second claim attempt reverts with FundRig__AlreadyClaimed", async function () {
      await increaseTime(ONE_DAY);
      const testDay = await rig.currentDay();

      await paymentToken.connect(user0).approve(rig.address, convert("100", 18));
      await rig.connect(user0).fund(user0.address, convert("100", 18), "");

      await increaseTime(ONE_DAY);

      // First claim succeeds
      await rig.claim(user0.address, testDay);

      // Second claim reverts
      await expect(
        rig.claim(user0.address, testDay)
      ).to.be.revertedWith("FundRig__AlreadyClaimed()");
    });
  });

  describe("INV-FUND-4: getDayEmission(day) >= minEmission for any day value", function () {
    it("Emission is at or above minEmission for day 0", async function () {
      const minEmission = await rig.minEmission();
      const emission = await rig.getDayEmission(0);
      expect(emission).to.be.gte(minEmission);
    });

    it("Emission is at or above minEmission for early days", async function () {
      const minEmission = await rig.minEmission();
      for (let day = 0; day < 10; day++) {
        const emission = await rig.getDayEmission(day);
        expect(emission).to.be.gte(minEmission);
      }
    });

    it("Emission is at or above minEmission after many halving periods", async function () {
      const minEmission = await rig.minEmission();
      // Test far future days (after many halvings)
      const farDays = [100, 500, 1000, 5000, 10000];
      for (const day of farDays) {
        const emission = await rig.getDayEmission(day);
        expect(emission).to.be.gte(minEmission);
      }
    });
  });

  describe("INV-FUND-5: FundRig holds 0 payment tokens after each fund operation", function () {
    it("FundRig contract balance is zero after fund() distributes immediately", async function () {
      await increaseTime(ONE_DAY);

      const amount = convert("500", 18);
      await paymentToken.connect(user0).approve(rig.address, amount);
      await rig.connect(user0).fund(user0.address, amount, "");

      const rigBalance = await paymentToken.balanceOf(rig.address);
      expect(rigBalance).to.equal(0);
    });

    it("FundRig balance remains zero across multiple fund operations", async function () {
      const amounts = [convert("100", 18), convert("250", 18), convert("333", 18)];
      const users = [user0, user1, user2];

      for (let i = 0; i < users.length; i++) {
        await paymentToken.connect(users[i]).approve(rig.address, amounts[i]);
        await rig.connect(users[i]).fund(users[i].address, amounts[i], "");

        const rigBalance = await paymentToken.balanceOf(rig.address);
        expect(rigBalance).to.equal(0);
      }
    });
  });
});

// ============================================================================
// AUCTION INVARIANTS (INV-AUC-1 through INV-AUC-3)
// ============================================================================

describe("Auction Invariants", function () {
  let owner, paymentReceiver, buyer0, buyer1, buyer2, attacker;
  let paymentToken, assetToken1, assetToken2, auction;

  before("Deploy fresh contracts for Auction invariants", async function () {
    await network.provider.send("hardhat_reset");

    [owner, paymentReceiver, buyer0, buyer1, buyer2, attacker] = await ethers.getSigners();

    // Deploy mock tokens
    const MockWETH = await ethers.getContractFactory("MockWETH");
    paymentToken = await MockWETH.deploy();
    assetToken1 = await MockWETH.deploy();
    assetToken2 = await MockWETH.deploy();

    // Deploy Auction
    const Auction = await ethers.getContractFactory("Auction");
    auction = await Auction.deploy(
      paymentToken.address,
      paymentReceiver.address,
      convert("100", 18),      // initPrice
      ONE_DAY,                 // epochPeriod
      convert("2", 18),        // priceMultiplier (2x)
      convert("1", 18)         // minInitPrice
    );

    // Fund buyers
    await paymentToken.connect(buyer0).deposit({ value: convert("1000", 18) });
    await paymentToken.connect(buyer1).deposit({ value: convert("1000", 18) });
    await paymentToken.connect(buyer2).deposit({ value: convert("1000", 18) });

    // Send assets to auction
    await assetToken1.connect(owner).deposit({ value: convert("500", 18) });
    await assetToken1.connect(owner).transfer(auction.address, convert("500", 18));
  });

  describe("INV-AUC-1: getPrice() monotonically non-increasing within an epoch", function () {
    it("Price decays monotonically (never increases) within a single epoch", async function () {
      const epochPeriod = await auction.epochPeriod();
      const iterations = 10;
      const timeStep = Math.floor(epochPeriod.toNumber() / iterations);

      let prevPrice = await auction.getPrice();

      for (let i = 0; i < iterations; i++) {
        await increaseTime(timeStep);
        const currentPrice = await auction.getPrice();
        expect(currentPrice).to.be.lte(prevPrice);
        prevPrice = currentPrice;
      }
    });

    it("Price reaches 0 after epoch period", async function () {
      // Already past epoch due to previous test iterations
      const price = await auction.getPrice();
      expect(price).to.equal(0);
    });
  });

  describe("INV-AUC-2: After buy(), auction contract holds 0 balance of the bought assets", function () {
    it("All requested assets are fully transferred out on buy", async function () {
      // Send fresh assets to auction
      await assetToken1.connect(owner).deposit({ value: convert("100", 18) });
      await assetToken1.connect(owner).transfer(auction.address, convert("100", 18));

      const auctionBalBefore = await assetToken1.balanceOf(auction.address);
      expect(auctionBalBefore).to.be.gt(0);

      const price = await auction.getPrice();
      const epochId = await auction.epochId();
      const deadline = await getFutureDeadline();

      if (price.gt(0)) {
        await paymentToken.connect(buyer0).approve(auction.address, price.add(convert("100", 18)));
      }

      await auction.connect(buyer0).buy(
        [assetToken1.address],
        buyer0.address,
        epochId,
        deadline,
        price.add(convert("1000", 18))
      );

      const auctionBalAfter = await assetToken1.balanceOf(auction.address);
      expect(auctionBalAfter).to.equal(0);
    });

    it("Multiple assets are all fully transferred out on buy", async function () {
      // Send fresh assets of both types
      await assetToken1.connect(owner).deposit({ value: convert("50", 18) });
      await assetToken1.connect(owner).transfer(auction.address, convert("50", 18));
      await assetToken2.connect(owner).deposit({ value: convert("75", 18) });
      await assetToken2.connect(owner).transfer(auction.address, convert("75", 18));

      const price = await auction.getPrice();
      const epochId = await auction.epochId();
      const deadline = await getFutureDeadline();

      if (price.gt(0)) {
        await paymentToken.connect(buyer1).approve(auction.address, price.add(convert("100", 18)));
      }

      await auction.connect(buyer1).buy(
        [assetToken1.address, assetToken2.address],
        buyer1.address,
        epochId,
        deadline,
        price.add(convert("1000", 18))
      );

      expect(await assetToken1.balanceOf(auction.address)).to.equal(0);
      expect(await assetToken2.balanceOf(auction.address)).to.equal(0);
    });
  });

  describe("INV-AUC-3: initPrice >= minInitPrice after every epoch transition", function () {
    it("initPrice is at least minInitPrice after buy at price 0", async function () {
      // Wait for epoch to expire
      await increaseTime(ONE_DAY + 1);

      const price = await auction.getPrice();
      expect(price).to.equal(0);

      // Send assets and buy at price 0
      await assetToken1.connect(owner).deposit({ value: convert("10", 18) });
      await assetToken1.connect(owner).transfer(auction.address, convert("10", 18));

      const epochId = await auction.epochId();
      const deadline = await getFutureDeadline();

      await auction.connect(buyer2).buy(
        [assetToken1.address],
        buyer2.address,
        epochId,
        deadline,
        convert("1000", 18)
      );

      const minInitPrice = await auction.minInitPrice();
      const newInitPrice = await auction.initPrice();
      expect(newInitPrice).to.be.gte(minInitPrice);
    });

    it("initPrice is at least minInitPrice after buy at non-zero price", async function () {
      // The previous buy set a fresh epoch; price should be non-zero now
      const price = await auction.getPrice();

      if (price.eq(0)) {
        this.skip();
        return;
      }

      // Send assets and buy at current price
      await assetToken1.connect(owner).deposit({ value: convert("10", 18) });
      await assetToken1.connect(owner).transfer(auction.address, convert("10", 18));

      const epochId = await auction.epochId();
      const deadline = await getFutureDeadline();

      await paymentToken.connect(buyer0).approve(auction.address, price.add(convert("100", 18)));
      await auction.connect(buyer0).buy(
        [assetToken1.address],
        buyer0.address,
        epochId,
        deadline,
        price.add(convert("100", 18))
      );

      const minInitPrice = await auction.minInitPrice();
      const newInitPrice = await auction.initPrice();
      expect(newInitPrice).to.be.gte(minInitPrice);
    });

    it("initPrice holds invariant across multiple successive buys", async function () {
      const minInitPrice = await auction.minInitPrice();

      for (let i = 0; i < 5; i++) {
        // Wait for epoch to expire in some rounds
        if (i % 2 === 0) {
          await increaseTime(ONE_DAY + 1);
        }

        // Send fresh assets
        await assetToken1.connect(owner).deposit({ value: convert("5", 18) });
        await assetToken1.connect(owner).transfer(auction.address, convert("5", 18));

        const price = await auction.getPrice();
        const epochId = await auction.epochId();
        const deadline = await getFutureDeadline();

        if (price.gt(0)) {
          await paymentToken.connect(buyer0).approve(auction.address, price.add(convert("100", 18)));
        }

        await auction.connect(buyer0).buy(
          [assetToken1.address],
          buyer0.address,
          epochId,
          deadline,
          price.add(convert("1000", 18))
        );

        const currentInitPrice = await auction.initPrice();
        expect(currentInitPrice).to.be.gte(minInitPrice);
      }
    });
  });
});
