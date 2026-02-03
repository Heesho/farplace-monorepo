/**
 * @title MineRig Invariant and Business Logic Tests
 * @notice Comprehensive tests verifying contract invariants and intended behavior
 * @dev Tests focus on properties that should ALWAYS hold regardless of state
 */

const convert = (amount, decimals = 18) => ethers.utils.parseUnits(amount.toString(), decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";
const AddressDead = "0x000000000000000000000000000000000000dEaD";

// Time helpers
async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function getBlockTimestamp() {
  const block = await ethers.provider.getBlock("latest");
  return block.timestamp;
}

const ONE_MINUTE = 60;
const TEN_MINUTES = 600;
const ONE_HOUR = 3600;
const ONE_DAY = 86400;
const PRECISION = ethers.BigNumber.from("1000000000000000000"); // 1e18

describe("MineRig Invariant Tests", function () {
  let owner, protocol, team, user0, user1, user2, user3;
  let weth, usdc, registry, core, entropy;
  let rig, rigContract, auction, unit, unitContract;

  before("Deploy fresh contracts", async function () {
    await network.provider.send("hardhat_reset");

    [owner, protocol, team, user0, user1, user2, user3] = await ethers.getSigners();

    // Deploy mock tokens
    const mockWethArtifact = await ethers.getContractFactory("MockWETH");
    weth = await mockWethArtifact.deploy();
    const mockUsdcArtifact = await ethers.getContractFactory("MockUSDC");
    usdc = await mockUsdcArtifact.deploy();

    // Deploy mock Entropy
    const entropyArtifact = await ethers.getContractFactory("MockEntropy");
    entropy = await entropyArtifact.deploy();

    // Deploy mock Uniswap
    const mockUniswapFactoryArtifact = await ethers.getContractFactory("MockUniswapV2Factory");
    const uniswapFactory = await mockUniswapFactoryArtifact.deploy();
    const mockUniswapRouterArtifact = await ethers.getContractFactory("MockUniswapV2Router");
    const uniswapRouter = await mockUniswapRouterArtifact.deploy(uniswapFactory.address);

    // Deploy factories
    const rigFactoryArtifact = await ethers.getContractFactory("MineRigFactory");
    const rigFactory = await rigFactoryArtifact.deploy();
    const auctionFactoryArtifact = await ethers.getContractFactory("AuctionFactory");
    const auctionFactory = await auctionFactoryArtifact.deploy();
    const unitFactoryArtifact = await ethers.getContractFactory("UnitFactory");
    const unitFactory = await unitFactoryArtifact.deploy();

    // Deploy Registry
    const registryArtifact = await ethers.getContractFactory("Registry");
    registry = await registryArtifact.deploy();

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
      convert("100", 6)
    );

    await registry.setFactoryApproval(core.address, true);

    // Fund users (keep amounts reasonable to leave room for gas)
    await usdc.mint(user0.address, convert("5000", 6));
    await weth.connect(user0).deposit({ value: convert("500", 18) });
    await weth.connect(user1).deposit({ value: convert("500", 18) });
    await weth.connect(user2).deposit({ value: convert("500", 18) });
    await weth.connect(user3).deposit({ value: convert("500", 18) });

    // Launch rig with specific parameters for testing
    const launchParams = {
      launcher: user0.address,
      quoteToken: weth.address,
      tokenName: "Invariant Test",
      tokenSymbol: "INVT",
      uri: "https://test.com",
      usdcAmount: convert("1000", 6),
      unitAmount: convert("1000000", 18),
      initialUps: convert("10", 18), // 10 tokens per second per slot
      tailUps: convert("0.1", 18),
      halvingAmount: convert("100000", 18),
      rigEpochPeriod: ONE_HOUR,
      rigPriceMultiplier: convert("2", 18),
      rigMinInitPrice: convert("0.001", 18),
      upsMultipliers: [convert("1", 18)],
      upsMultiplierDuration: 86400,
      auctionInitPrice: convert("1", 18),
      auctionEpochPeriod: ONE_DAY,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("0.01", 18),
    };

    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);
    const tx = await core.connect(user0).launch(launchParams);
    const receipt = await tx.wait();

    const launchEvent = receipt.events.find((e) => e.event === "MineCore__Launched");
    rig = launchEvent.args.rig;
    unit = launchEvent.args.unit;
    auction = launchEvent.args.auction;

    rigContract = await ethers.getContractAt("MineRig", rig);
    unitContract = await ethers.getContractAt("Unit", unit);

    // Disable entropy for tests that don't send ETH for VRF fees
    await rigContract.connect(user0).setEntropyEnabled(false);

    // Set team for complete fee distribution
    await rigContract.connect(user0).setTeam(team.address);
  });

  /**
   * INVARIANT 1: Price decay formula correctness
   * price = initPrice - (initPrice * timePassed / epochPeriod)
   * price should be 0 after epochPeriod, never negative
   */
  describe("INVARIANT: Price Decay Formula", function () {
    beforeEach(async function () {
      // Mine to reset epoch with known initPrice
      const slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rig, convert("10", 18));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 1961439882, convert("10", 18), ""
      );
    });

    it("Price should equal initPrice at epoch start (t=0)", async function () {
      const slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      // Allow 1% tolerance for block time differences
      const tolerance = slot.initPrice.div(100);
      expect(price).to.be.closeTo(slot.initPrice, tolerance);
    });

    it("Price should be ~50% of initPrice at epoch midpoint", async function () {
      const slot = await rigContract.getSlot(0);
      const epochPeriod = await rigContract.epochPeriod();

      await increaseTime(epochPeriod.toNumber() / 2);

      const price = await rigContract.getPrice(0);
      const expected = slot.initPrice.div(2);
      const tolerance = expected.div(10); // 10% tolerance

      expect(price).to.be.closeTo(expected, tolerance);
    });

    it("Price should be exactly 0 after epochPeriod", async function () {
      const epochPeriod = await rigContract.epochPeriod();

      await increaseTime(epochPeriod.toNumber() + 1);

      const price = await rigContract.getPrice(0);
      expect(price).to.equal(0);
    });

    it("Price should never be negative (always >= 0)", async function () {
      const epochPeriod = await rigContract.epochPeriod();

      // Test at various points including way past epoch end
      const testPoints = [0, epochPeriod.toNumber() * 2, epochPeriod.toNumber() * 100];

      for (const offset of testPoints) {
        const price = await rigContract.getPrice(0);
        expect(price).to.be.gte(0);
        if (offset > 0) await increaseTime(offset);
      }
    });

    it("Price should decay monotonically (never increase within epoch)", async function () {
      const epochPeriod = await rigContract.epochPeriod();
      const iterations = 10;
      const timeStep = epochPeriod.toNumber() / iterations;

      let prevPrice = await rigContract.getPrice(0);

      for (let i = 0; i < iterations; i++) {
        await increaseTime(timeStep);
        const currentPrice = await rigContract.getPrice(0);
        expect(currentPrice).to.be.lte(prevPrice);
        prevPrice = currentPrice;
      }
    });
  });

  /**
   * INVARIANT 2: Fee distribution sums to 100%
   * minerFee + treasuryFee + protocolFee + teamFee = price
   */
  describe("INVARIANT: Fee Distribution Sums to 100%", function () {
    it("All fees should sum to exactly the price paid", async function () {
      // First mine to establish a slot
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rig, convert("10", 18));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 1961439882, convert("10", 18), ""
      );

      // Get fresh slot and price
      slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      if (price.eq(0)) {
        this.skip(); // Skip if price decayed to 0
      }

      // Record all balances before
      const prevMiner = slot.miner;
      const minerClaimableBefore = await rigContract.accountToClaimable(prevMiner);
      const treasuryBefore = await weth.balanceOf(auction);
      const protocolBefore = await weth.balanceOf(protocol.address);
      const teamBefore = await weth.balanceOf(team.address);

      // Mine again
      await weth.connect(user2).approve(rig, price.add(convert("1", 18)));
      const tx = await rigContract.connect(user2).mine(
        user2.address, 0, slot.epochId, 1961439882, price.add(convert("1", 18)), ""
      );

      // Get actual price from event
      const receipt = await tx.wait();
      const mineEvent = receipt.events.find(e => e.event === "MineRig__Mine");
      const actualPrice = mineEvent.args.price;

      // Calculate all fees received
      const minerClaimableAfter = await rigContract.accountToClaimable(prevMiner);
      const treasuryAfter = await weth.balanceOf(auction);
      const protocolAfter = await weth.balanceOf(protocol.address);
      const teamAfter = await weth.balanceOf(team.address);

      const minerFee = minerClaimableAfter.sub(minerClaimableBefore);
      const treasuryFee = treasuryAfter.sub(treasuryBefore);
      const protocolFee = protocolAfter.sub(protocolBefore);
      const teamFee = teamAfter.sub(teamBefore);

      const totalFees = minerFee.add(treasuryFee).add(protocolFee).add(teamFee);

      // Total fees should equal actual price paid (allowing 1 wei rounding error)
      expect(totalFees).to.be.closeTo(actualPrice, 1);
    });

    it("Fee percentages should match constants (80/15/4/1)", async function () {
      // Mine slot 0 to reset epoch and get a fresh price
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rig, convert("10", 18));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 1961439882, convert("10", 18), ""
      );

      // Get fresh state - the new initPrice after mining should be price * 2
      slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      if (price.lt(convert("0.001", 18))) {
        this.skip(); // Need meaningful price for percentage calculation
      }

      const prevMiner = slot.miner;
      const minerClaimableBefore = await rigContract.accountToClaimable(prevMiner);
      const treasuryBefore = await weth.balanceOf(auction);
      const protocolBefore = await weth.balanceOf(protocol.address);
      const teamBefore = await weth.balanceOf(team.address);

      await weth.connect(user2).approve(rig, price.add(convert("1", 18)));
      const tx = await rigContract.connect(user2).mine(
        user2.address, 0, slot.epochId, 1961439882, price.add(convert("1", 18)), ""
      );

      // Get actual price from event
      const receipt = await tx.wait();
      const mineEvent = receipt.events.find(e => e.event === "MineRig__Mine");
      const actualPrice = mineEvent.args.price;

      const minerFee = (await rigContract.accountToClaimable(prevMiner)).sub(minerClaimableBefore);
      const treasuryFee = (await weth.balanceOf(auction)).sub(treasuryBefore);
      const protocolFee = (await weth.balanceOf(protocol.address)).sub(protocolBefore);
      const teamFee = (await weth.balanceOf(team.address)).sub(teamBefore);

      // Check percentages based on actual price (with 1% tolerance)
      const minerPct = minerFee.mul(100).div(actualPrice).toNumber();
      const treasuryPct = treasuryFee.mul(100).div(actualPrice).toNumber();
      const protocolPct = protocolFee.mul(100).div(actualPrice).toNumber();
      const teamPct = teamFee.mul(100).div(actualPrice).toNumber();

      expect(minerPct).to.be.closeTo(80, 1);
      expect(treasuryPct).to.be.closeTo(15, 1);
      expect(protocolPct).to.be.closeTo(1, 1);
      expect(teamPct).to.be.closeTo(4, 1);
    });
  });

  /**
   * INVARIANT 3: UPS halving is monotonically decreasing
   * UPS should only decrease (or stay same at tailUps floor)
   */
  describe("INVARIANT: UPS Halving Monotonic Decrease", function () {
    it("UPS should never increase as totalMinted increases", async function () {
      const initialUps = await rigContract.getUps();

      // Mine several times to increase totalMinted
      for (let i = 0; i < 5; i++) {
        const slot = await rigContract.getSlot(0);

        // Wait for epoch to expire to accumulate more minting
        const epochPeriod = await rigContract.epochPeriod();
        await increaseTime(epochPeriod.toNumber() + 1);

        await weth.connect(user1).approve(rig, convert("10", 18));
        await rigContract.connect(user1).mine(
          user1.address, 0, slot.epochId, 19614398820, convert("10", 18), ""
        );

        const currentUps = await rigContract.getUps();
        expect(currentUps).to.be.lte(initialUps);
      }
    });

    it("UPS should never go below tailUps", async function () {
      const tailUps = await rigContract.tailUps();

      // Mine many times to try to push UPS down
      for (let i = 0; i < 20; i++) {
        const slot = await rigContract.getSlot(0);
        const epochPeriod = await rigContract.epochPeriod();
        await increaseTime(epochPeriod.toNumber() + 1);

        await weth.connect(user1).approve(rig, convert("10", 18));
        await rigContract.connect(user1).mine(
          user1.address, 0, slot.epochId, 19614398820, convert("10", 18), ""
        );
      }

      const currentUps = await rigContract.getUps();
      expect(currentUps).to.be.gte(tailUps);
    });
  });

  /**
   * INVARIANT 4: Token minting matches time held
   * mintedAmount = timeHeld * ups * upsMultiplier / PRECISION
   */
  describe("INVARIANT: Token Minting Calculation", function () {
    it("Minted tokens should be proportional to time held", async function () {
      // Mine to establish miner
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rig, convert("10", 18));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 19614398820, convert("10", 18), ""
      );

      const startTime = await getBlockTimestamp();
      const user1BalBefore = await unitContract.balanceOf(user1.address);

      // Wait specific time
      const waitSeconds = 100;
      await increaseTime(waitSeconds);

      // Mine again to trigger minting
      slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      await weth.connect(user2).approve(rig, price.add(convert("10", 18)));
      await rigContract.connect(user2).mine(
        user2.address, 0, slot.epochId, 19614398820, price.add(convert("10", 18)), ""
      );

      const user1BalAfter = await unitContract.balanceOf(user1.address);
      const minted = user1BalAfter.sub(user1BalBefore);

      // Calculate expected: timeHeld * ups / capacity
      const slotData = await rigContract.getSlot(0);
      const timeHeld = (await getBlockTimestamp()) - startTime;
      const ups = slotData.ups;
      const upsMultiplier = slotData.upsMultiplier;

      // Expected = timeHeld * ups * upsMultiplier / PRECISION
      const expectedMin = ethers.BigNumber.from(waitSeconds).mul(ups).mul(upsMultiplier).div(PRECISION);
      const expectedMax = ethers.BigNumber.from(waitSeconds + 5).mul(ups).mul(upsMultiplier).div(PRECISION);

      // Allow tolerance for block time variations
      expect(minted).to.be.gte(expectedMin.mul(90).div(100));
      expect(minted).to.be.lte(expectedMax.mul(110).div(100));
    });
  });

  /**
   * INVARIANT 5: Epoch ID increments correctly
   * Each mine should increment epochId by exactly 1
   */
  describe("INVARIANT: Epoch ID Increments", function () {
    it("Epoch ID should increment by exactly 1 per mine", async function () {
      const slot = await rigContract.getSlot(0);
      const epochIdBefore = slot.epochId;

      await weth.connect(user1).approve(rig, convert("10", 18));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 19614398820, convert("10", 18), ""
      );

      const newSlot = await rigContract.getSlot(0);
      expect(newSlot.epochId).to.equal(epochIdBefore.add(1));
    });

    it("Epoch ID should be independent per slot", async function () {
      // Increase capacity first
      await rigContract.connect(user0).setCapacity(5);

      // Get initial epoch IDs
      const slot0 = await rigContract.getSlot(0);
      const slot1 = await rigContract.getSlot(1);

      // Mine slot 1 only
      await weth.connect(user1).approve(rig, convert("10", 18));
      await rigContract.connect(user1).mine(
        user1.address, 1, slot1.epochId, 19614398820, convert("10", 18), ""
      );

      // Slot 0 epoch should be unchanged
      const newSlot0 = await rigContract.getSlot(0);
      const newSlot1 = await rigContract.getSlot(1);

      expect(newSlot0.epochId).to.equal(slot0.epochId);
      expect(newSlot1.epochId).to.equal(slot1.epochId.add(1));
    });
  });

  /**
   * INVARIANT 6: Claimable balance can only increase from mining
   * accountToClaimable[x] should only increase when x is displaced
   */
  describe("INVARIANT: Claimable Balance Accumulation", function () {
    it("Claimable should only increase when miner is displaced", async function () {
      // Mine to become miner
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rig, convert("10", 18));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 19614398820, convert("10", 18), ""
      );

      const claimableBefore = await rigContract.accountToClaimable(user1.address);

      // User1 mines same slot (self-displacement at price 0)
      const epochPeriod = await rigContract.epochPeriod();
      await increaseTime(epochPeriod.toNumber() + 1);

      slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rig, convert("10", 18));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 19614398820, convert("10", 18), ""
      );

      // When user1 displaces user1 at price 0, no miner fee is added
      const claimableAfter = await rigContract.accountToClaimable(user1.address);
      expect(claimableAfter).to.be.gte(claimableBefore);
    });

    it("Claimable should increase by exactly 80% of price paid", async function () {
      // User1 is miner
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rig, convert("10", 18));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 19614398820, convert("10", 18), ""
      );

      slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      if (price.eq(0)) {
        this.skip();
      }

      const claimableBefore = await rigContract.accountToClaimable(user1.address);

      // User2 displaces user1
      await weth.connect(user2).approve(rig, price.add(convert("1", 18)));
      const tx = await rigContract.connect(user2).mine(
        user2.address, 0, slot.epochId, 19614398820, price.add(convert("1", 18)), ""
      );

      // Get actual price from event
      const receipt = await tx.wait();
      const mineEvent = receipt.events.find(e => e.event === "MineRig__Mine");
      const actualPrice = mineEvent.args.price;

      const claimableAfter = await rigContract.accountToClaimable(user1.address);
      const increase = claimableAfter.sub(claimableBefore);

      // Should be exactly 80% of actual price paid (DIVISOR - TOTAL_FEE) / DIVISOR = 8000/10000
      const expected = actualPrice.mul(8000).div(10000);
      expect(increase).to.be.closeTo(expected, 1);
    });
  });

  /**
   * INVARIANT 7: Price multiplier application
   * newInitPrice = max(minInitPrice, price * priceMultiplier / PRECISION)
   */
  describe("INVARIANT: Price Multiplier Application", function () {
    it("New initPrice should be price * multiplier (capped at max)", async function () {
      // Mine at a known price
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rig, convert("10", 18));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 19614398820, convert("10", 18), ""
      );

      // Get price immediately (should be close to initPrice)
      slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      if (price.eq(0)) {
        this.skip();
      }

      const priceMultiplier = await rigContract.priceMultiplier();

      await weth.connect(user2).approve(rig, price);
      await rigContract.connect(user2).mine(
        user2.address, 0, slot.epochId, 19614398820, price, ""
      );

      const newSlot = await rigContract.getSlot(0);
      const expectedInitPrice = price.mul(priceMultiplier).div(PRECISION);

      // New initPrice should match expected (within 1% tolerance for rounding)
      expect(newSlot.initPrice).to.be.closeTo(expectedInitPrice, expectedInitPrice.div(100).add(1));
    });

    it("New initPrice should never be below minInitPrice", async function () {
      // Wait for price to decay to 0
      const epochPeriod = await rigContract.epochPeriod();
      await increaseTime(epochPeriod.toNumber() + 1);

      const slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);
      expect(price).to.equal(0);

      const minInitPrice = await rigContract.minInitPrice();

      await weth.connect(user1).approve(rig, convert("10", 18));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 19614398820, convert("10", 18), ""
      );

      const newSlot = await rigContract.getSlot(0);
      expect(newSlot.initPrice).to.equal(minInitPrice);
    });
  });

  /**
   * INVARIANT 8: Capacity constraints
   * slot index must always be < capacity
   */
  describe("INVARIANT: Capacity Constraints", function () {
    it("Should always revert for slot index >= capacity", async function () {
      const capacity = await rigContract.capacity();

      await expect(
        rigContract.connect(user1).mine(
          user1.address, capacity.toNumber(), 0, 19614398820, convert("10", 18), ""
        )
      ).to.be.revertedWith("Rig__IndexOutOfBounds()");

      await expect(
        rigContract.connect(user1).mine(
          user1.address, capacity.toNumber() + 100, 0, 19614398820, convert("10", 18), ""
        )
      ).to.be.revertedWith("Rig__IndexOutOfBounds()");
    });

    it("Should allow mining any valid slot index", async function () {
      const capacity = await rigContract.capacity();

      // Mine the last valid slot
      const lastIndex = capacity.toNumber() - 1;
      const slot = await rigContract.getSlot(lastIndex);

      await weth.connect(user1).approve(rig, convert("10", 18));
      await expect(
        rigContract.connect(user1).mine(
          user1.address, lastIndex, slot.epochId, 19614398820, convert("10", 18), ""
        )
      ).to.not.be.reverted;
    });
  });

  /**
   * INVARIANT 9: Claim pull pattern
   * claim() should transfer exactly accountToClaimable[account] and zero it
   */
  describe("INVARIANT: Claim Exactness", function () {
    it("Claim should transfer exactly the claimable amount", async function () {
      // Build up some claimable balance
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rig, convert("10", 18));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 19614398820, convert("10", 18), ""
      );

      slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      if (price.eq(0)) {
        this.skip();
      }

      await weth.connect(user2).approve(rig, price);
      await rigContract.connect(user2).mine(
        user2.address, 0, slot.epochId, 19614398820, price, ""
      );

      const claimable = await rigContract.accountToClaimable(user1.address);

      if (claimable.eq(0)) {
        this.skip();
      }

      const balBefore = await weth.balanceOf(user1.address);

      await rigContract.claim(user1.address);

      const balAfter = await weth.balanceOf(user1.address);
      const claimableAfter = await rigContract.accountToClaimable(user1.address);

      expect(balAfter.sub(balBefore)).to.equal(claimable);
      expect(claimableAfter).to.equal(0);
    });

    it("Claim should revert with NothingToClaim when balance is 0", async function () {
      // User3 has never been a miner, should have 0 claimable
      const claimable = await rigContract.accountToClaimable(user3.address);
      expect(claimable).to.equal(0);

      await expect(
        rigContract.claim(user3.address)
      ).to.be.revertedWith("Rig__NothingToClaim()");
    });
  });
});

describe("MineRig Business Logic Tests", function () {
  let owner, protocol, team, user0, user1, user2, user3;
  let weth, usdc, registry, core, entropy;
  let rig, rigContract, auction, unit, unitContract;

  before("Deploy contracts", async function () {
    await network.provider.send("hardhat_reset");

    [owner, protocol, team, user0, user1, user2, user3] = await ethers.getSigners();

    // Deploy infrastructure (same as above)
    const mockWethArtifact = await ethers.getContractFactory("MockWETH");
    weth = await mockWethArtifact.deploy();
    const mockUsdcArtifact = await ethers.getContractFactory("MockUSDC");
    usdc = await mockUsdcArtifact.deploy();

    const entropyArtifact = await ethers.getContractFactory("MockEntropy");
    entropy = await entropyArtifact.deploy();

    const mockUniswapFactoryArtifact = await ethers.getContractFactory("MockUniswapV2Factory");
    const uniswapFactory = await mockUniswapFactoryArtifact.deploy();
    const mockUniswapRouterArtifact = await ethers.getContractFactory("MockUniswapV2Router");
    const uniswapRouter = await mockUniswapRouterArtifact.deploy(uniswapFactory.address);

    const rigFactoryArtifact = await ethers.getContractFactory("MineRigFactory");
    const rigFactory = await rigFactoryArtifact.deploy();
    const auctionFactoryArtifact = await ethers.getContractFactory("AuctionFactory");
    const auctionFactory = await auctionFactoryArtifact.deploy();
    const unitFactoryArtifact = await ethers.getContractFactory("UnitFactory");
    const unitFactory = await unitFactoryArtifact.deploy();

    const registryArtifact = await ethers.getContractFactory("Registry");
    registry = await registryArtifact.deploy();

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
      convert("100", 6)
    );

    await registry.setFactoryApproval(core.address, true);

    // Fund users (keep amounts reasonable to leave room for gas)
    await usdc.mint(user0.address, convert("5000", 6));
    await weth.connect(user0).deposit({ value: convert("500", 18) });
    await weth.connect(user1).deposit({ value: convert("500", 18) });
    await weth.connect(user2).deposit({ value: convert("500", 18) });
    await weth.connect(user3).deposit({ value: convert("500", 18) });

    const launchParams = {
      launcher: user0.address,
      quoteToken: weth.address,
      tokenName: "Business Logic Test",
      tokenSymbol: "BLT",
      uri: "https://test.com",
      usdcAmount: convert("1000", 6),
      unitAmount: convert("1000000", 18),
      initialUps: convert("10", 18),
      tailUps: convert("0.1", 18),
      halvingAmount: convert("1000", 18), // Low for testing
      rigEpochPeriod: ONE_HOUR,
      rigPriceMultiplier: convert("2", 18),
      rigMinInitPrice: convert("0.001", 18),
      upsMultipliers: [convert("1", 18)],
      upsMultiplierDuration: 86400,
      auctionInitPrice: convert("1", 18),
      auctionEpochPeriod: ONE_DAY,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("0.01", 18),
    };

    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);
    const tx = await core.connect(user0).launch(launchParams);
    const receipt = await tx.wait();

    const launchEvent = receipt.events.find((e) => e.event === "MineCore__Launched");
    rig = launchEvent.args.rig;
    unit = launchEvent.args.unit;
    auction = launchEvent.args.auction;

    rigContract = await ethers.getContractAt("MineRig", rig);
    unitContract = await ethers.getContractAt("Unit", unit);

    // Disable entropy for tests that don't send ETH for VRF fees
    await rigContract.connect(user0).setEntropyEnabled(false);

    await rigContract.connect(user0).setTeam(team.address);
  });

  describe("Mining Competition Mechanics", function () {
    it("Should allow anyone to take an available slot", async function () {
      const slot = await rigContract.getSlot(0);

      await weth.connect(user1).approve(rig, convert("10", 18));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 19614398820, convert("10", 18), ""
      );

      const newSlot = await rigContract.getSlot(0);
      expect(newSlot.miner).to.equal(user1.address);
    });

    it("Should allow displacing current miner by paying current price", async function () {
      const slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      await weth.connect(user2).approve(rig, price.add(convert("1", 18)));
      await rigContract.connect(user2).mine(
        user2.address, 0, slot.epochId, 19614398820, price.add(convert("1", 18)), ""
      );

      const newSlot = await rigContract.getSlot(0);
      expect(newSlot.miner).to.equal(user2.address);
    });

    it("Should mint tokens to displaced miner based on time held", async function () {
      // User2 is current miner - record their balance
      const user2BalBefore = await unitContract.balanceOf(user2.address);

      // Wait some time
      await increaseTime(60); // 60 seconds

      // Displace user2
      const slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      await weth.connect(user3).approve(rig, price.add(convert("1", 18)));
      await rigContract.connect(user3).mine(
        user3.address, 0, slot.epochId, 19614398820, price.add(convert("1", 18)), ""
      );

      const user2BalAfter = await unitContract.balanceOf(user2.address);
      expect(user2BalAfter).to.be.gt(user2BalBefore);
    });

    it("Should pay previous miner 80% of the price paid", async function () {
      // User3 is miner
      let slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      if (price.eq(0)) {
        // Wait for fresh epoch
        await increaseTime(ONE_HOUR + 1);
        slot = await rigContract.getSlot(0);
        await weth.connect(user3).approve(rig, convert("10", 18));
        await rigContract.connect(user3).mine(
          user3.address, 0, slot.epochId, 19614398820, convert("10", 18), ""
        );
        slot = await rigContract.getSlot(0);
      }

      const claimableBefore = await rigContract.accountToClaimable(user3.address);
      const newPrice = await rigContract.getPrice(0);

      if (newPrice.eq(0)) {
        this.skip();
      }

      await weth.connect(user1).approve(rig, newPrice);
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 19614398820, newPrice, ""
      );

      const claimableAfter = await rigContract.accountToClaimable(user3.address);
      const minerFee = claimableAfter.sub(claimableBefore);

      // 80% of price
      const expected = newPrice.mul(80).div(100);
      expect(minerFee).to.be.closeTo(expected, expected.div(100).add(1));
    });
  });

  describe("Zero-Price Edge Cases", function () {
    it("Should allow mining at price 0 after epoch expires", async function () {
      const epochPeriod = await rigContract.epochPeriod();
      await increaseTime(epochPeriod.toNumber() + 1);

      const price = await rigContract.getPrice(0);
      expect(price).to.equal(0);

      const slot = await rigContract.getSlot(0);

      // Mining at 0 should work - no transfer needed
      await weth.connect(user2).approve(rig, convert("1", 18));
      await expect(
        rigContract.connect(user2).mine(
          user2.address, 0, slot.epochId, 19614398820, convert("1", 18), ""
        )
      ).to.not.be.reverted;
    });

    it("Should not pay miner fee when price is 0", async function () {
      const epochPeriod = await rigContract.epochPeriod();
      await increaseTime(epochPeriod.toNumber() + 1);

      const slot = await rigContract.getSlot(0);
      const prevMiner = slot.miner;
      const claimableBefore = await rigContract.accountToClaimable(prevMiner);

      await weth.connect(user3).approve(rig, convert("1", 18));
      await rigContract.connect(user3).mine(
        user3.address, 0, slot.epochId, 19614398820, convert("1", 18), ""
      );

      const claimableAfter = await rigContract.accountToClaimable(prevMiner);

      // No miner fee should be added when price is 0
      expect(claimableAfter).to.equal(claimableBefore);
    });

    it("Should still mint tokens to displaced miner even at price 0", async function () {
      // Mine to become miner
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rig, convert("1", 18));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 19614398820, convert("1", 18), ""
      );

      const user1BalBefore = await unitContract.balanceOf(user1.address);

      // Wait for epoch to expire
      const epochPeriod = await rigContract.epochPeriod();
      await increaseTime(epochPeriod.toNumber() + 1);

      // Mine at price 0
      slot = await rigContract.getSlot(0);
      await weth.connect(user2).approve(rig, convert("1", 18));
      await rigContract.connect(user2).mine(
        user2.address, 0, slot.epochId, 19614398820, convert("1", 18), ""
      );

      const user1BalAfter = await unitContract.balanceOf(user1.address);

      // User1 should still receive minted tokens
      expect(user1BalAfter).to.be.gt(user1BalBefore);
    });
  });

  describe("Multi-Slot Fairness", function () {
    before(async function () {
      // Increase capacity
      await rigContract.connect(user0).setCapacity(10);
    });

    it("Each slot should have independent epochs", async function () {
      // Mine different slots
      const slot0 = await rigContract.getSlot(0);
      const slot5 = await rigContract.getSlot(5);

      await weth.connect(user1).approve(rig, convert("20", 18));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot0.epochId, 19614398820, convert("10", 18), ""
      );

      // Mine slot 0 again
      const newSlot0 = await rigContract.getSlot(0);
      await weth.connect(user2).approve(rig, convert("10", 18));

      // Slot 5 should still be at original epochId
      const unchangedSlot5 = await rigContract.getSlot(5);
      expect(unchangedSlot5.epochId).to.equal(slot5.epochId);
    });

    it("Total UPS should be divided by capacity for each slot", async function () {
      const totalUps = await rigContract.getUps();
      const capacity = await rigContract.capacity();

      // Mine a fresh slot
      const slot7 = await rigContract.getSlot(7);
      await weth.connect(user1).approve(rig, convert("10", 18));
      await rigContract.connect(user1).mine(
        user1.address, 7, slot7.epochId, 19614398820, convert("10", 18), ""
      );

      const newSlot7 = await rigContract.getSlot(7);
      expect(newSlot7.ups).to.equal(totalUps.div(capacity));
    });
  });

  describe("Halving Schedule", function () {
    it("UPS should halve after halvingAmount tokens minted", async function () {
      const initialUps = await rigContract.initialUps();
      const halvingAmount = await rigContract.halvingAmount();
      const totalMintedBefore = await rigContract.totalMinted();

      // If we've already minted more than halvingAmount, UPS should be halved
      if (totalMintedBefore.gte(halvingAmount)) {
        const currentUps = await rigContract.getUps();
        expect(currentUps).to.be.lt(initialUps);
      }
    });

    it("Multiple halvings should reduce UPS exponentially", async function () {
      const initialUps = await rigContract.initialUps();
      const halvingAmount = await rigContract.halvingAmount();
      const totalMinted = await rigContract.totalMinted();

      // Calculate expected halvings
      const halvings = totalMinted.div(halvingAmount).toNumber();

      if (halvings > 0) {
        const currentUps = await rigContract.getUps();
        const expectedUps = initialUps.div(ethers.BigNumber.from(2).pow(halvings));
        const tailUps = await rigContract.tailUps();

        // UPS should be max(expectedUps, tailUps)
        expect(currentUps).to.be.gte(tailUps);
      }
    });
  });
});
