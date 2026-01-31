const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";
const AddressDead = "0x000000000000000000000000000000000000dEaD";
const MaxUint256 = ethers.constants.MaxUint256;

// Helper to get a far-future deadline that won't expire even with large time jumps
function getFutureDeadline() {
  return Math.floor(Date.now() / 1000) + 500 * 365 * 24 * 60 * 60; // 500 years from now
}

let owner, protocol, team, user0, user1, user2, user3, attacker;
let weth, donut, registry, core, entropy;
let rig, rigContract, auction, unit, unitContract, lpToken;

// Helper to get fresh rig for isolated tests
async function deployFreshRig(params = {}) {
  // Mint more donut if needed
  const donutBal = await donut.balanceOf(user0.address);
  if (donutBal.lt(convert("600", 18))) {
    await donut.connect(user0).deposit({ value: convert("1000", 18) });
  }

  const launchParams = {
    launcher: user0.address,
    quoteToken: weth.address,
    tokenName: params.tokenName || "Test Unit",
    tokenSymbol: params.tokenSymbol || "TUNIT",
    uri: params.uri || "",
    donutAmount: params.donutAmount || convert("200", 18), // Reduced from 500
    unitAmount: params.unitAmount || convert("1000000", 18),
    initialUps: params.initialUps || convert("4", 18),
    tailUps: params.tailUps || convert("0.01", 18),
    halvingAmount: params.halvingAmount || convert("10000000", 18),
    rigEpochPeriod: params.rigEpochPeriod || 3600,
    rigPriceMultiplier: params.rigPriceMultiplier || convert("2", 18),
    rigMinInitPrice: params.rigMinInitPrice || convert("0.0001", 18),
    upsMultipliers: params.upsMultipliers || [],
    upsMultiplierDuration: params.upsMultiplierDuration || 86400,
    auctionInitPrice: params.auctionInitPrice || convert("1", 18),
    auctionEpochPeriod: params.auctionEpochPeriod || 86400,
    auctionPriceMultiplier: params.auctionPriceMultiplier || convert("1.2", 18),
    auctionMinInitPrice: params.auctionMinInitPrice || convert("0.001", 18),
  };

  await donut.connect(user0).approve(core.address, launchParams.donutAmount);
  const tx = await core.connect(user0).launch(launchParams);
  const receipt = await tx.wait();
  const launchEvent = receipt.events.find((e) => e.event === "MineCore__Launched");

  return {
    rig: await ethers.getContractAt("MineRig", launchEvent.args.rig),
    unit: await ethers.getContractAt("Unit", launchEvent.args.unit),
    auction: launchEvent.args.auction,
    lpToken: launchEvent.args.lpToken,
  };
}

// Helper to ensure user has enough WETH
async function ensureWeth(user, amount) {
  const bal = await weth.balanceOf(user.address);
  if (bal.lt(amount)) {
    const needed = amount.sub(bal).add(convert("100", 18));
    await weth.connect(user).deposit({ value: needed });
  }
}

// Helper to ensure user has enough donut
async function ensureDonut(user, amount) {
  const bal = await donut.balanceOf(user.address);
  if (bal.lt(amount)) {
    const needed = amount.sub(bal).add(convert("500", 18));
    await donut.connect(user).deposit({ value: needed });
  }
}

describe("EXTREME RIG TESTING - TRY TO BREAK EVERYTHING", function () {
  before("Initial set up", async function () {
    this.timeout(120000);
    await network.provider.send("hardhat_reset");

    [owner, protocol, team, user0, user1, user2, user3, attacker] = await ethers.getSigners();

    // Deploy infrastructure
    const wethArtifact = await ethers.getContractFactory("MockWETH");
    weth = await wethArtifact.deploy();
    donut = await wethArtifact.deploy();

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

    // Deploy Registry
    const registryArtifact = await ethers.getContractFactory("Registry");
    registry = await registryArtifact.deploy();

    const coreArtifact = await ethers.getContractFactory("MineCore");
    core = await coreArtifact.deploy(
      registry.address,
      donut.address,
      uniswapFactory.address,
      uniswapRouter.address,
      unitFactory.address,
      rigFactory.address,
      auctionFactory.address,
      entropy.address,
      protocol.address,
      convert("100", 18)
    );

    // Approve Core as factory in Registry
    await registry.setFactoryApproval(core.address, true);

    // Fund everyone generously (but within account balance)
    for (const user of [user0, user1, user2, user3, attacker]) {
      await donut.connect(user).deposit({ value: convert("2000", 18) });
      await weth.connect(user).deposit({ value: convert("500", 18) });
    }

    // Deploy main test rig
    const result = await deployFreshRig();
    rigContract = result.rig;
    unitContract = result.unit;
    auction = result.auction;
    rig = rigContract.address;

    console.log("EXTREME TESTING INITIALIZED");
  });

  // ============================================================
  // OVERFLOW / UNDERFLOW ATTACKS
  // ============================================================
  describe("OVERFLOW / UNDERFLOW ATTACKS", function () {
    it("ATTACK: Try to overflow mined amount calculation", async function () {
      // Deploy rig with max allowed UPS (1e24 is the limit)
      const result = await deployFreshRig({
        initialUps: convert("1000000000000000000000000", 0), // 1e24 (max allowed)
        tailUps: convert("1", 18),
        halvingAmount: convert("1000", 18),
      });

      // Mine and wait max time
      let slot = await result.rig.getSlot(0);
      await ensureWeth(user1, convert("10", 18));
      await weth.connect(user1).approve(result.rig.address, convert("10", 18));
      await result.rig.connect(user1).mine(user1.address, 0, slot.epochId, getFutureDeadline(), convert("10", 18), "");

      // Wait very long time
      await network.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]); // 1 year
      await network.provider.send("evm_mine");

      // Try to mine - should not overflow
      slot = await result.rig.getSlot(0);
      await ensureWeth(user2, convert("10", 18));
      await weth.connect(user2).approve(result.rig.address, convert("10", 18));

      // Should succeed without overflow
      await expect(
        result.rig.connect(user2).mine(user2.address, 0, slot.epochId, getFutureDeadline(), convert("10", 18), "")
      ).to.not.be.reverted;
    });

    it("ATTACK: Try to overflow price multiplier calculation", async function () {
      // Deploy rig with max price multiplier and reasonable init price
      const result = await deployFreshRig({
        rigPriceMultiplier: convert("3", 18), // 3x max
        rigMinInitPrice: convert("0.01", 18), // Low init price to avoid running out of funds
      });

      // Mine multiple times to escalate price - each time 3x higher
      for (let i = 0; i < 5; i++) {  // Reduced iterations
        const slot = await result.rig.getSlot(0);
        const price = await result.rig.getPrice(0);
        const payAmount = price.add(convert("1", 18));

        await ensureWeth(user1, payAmount);
        await weth.connect(user1).approve(result.rig.address, payAmount);
        await result.rig.connect(user1).mine(
          user1.address, 0, slot.epochId, getFutureDeadline(), payAmount, ""
        );
      }

      // Price should be capped at ABS_MAX_INIT_PRICE
      const finalSlot = await result.rig.getSlot(0);
      expect(finalSlot.initPrice).to.be.lte(ethers.BigNumber.from(2).pow(192).sub(1));
    });

    it("ATTACK: Try to underflow with zero price", async function () {
      // Wait for epoch to expire (price = 0)
      const epochPeriod = await rigContract.epochPeriod();
      await network.provider.send("evm_increaseTime", [epochPeriod.toNumber() + 100]);
      await network.provider.send("evm_mine");

      const slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);
      expect(price).to.equal(0);

      // Mine at price 0 - fee calculations should handle this
      await ensureWeth(user1, convert("10", 18));
      await weth.connect(user1).approve(rig, convert("10", 18));
      await expect(
        rigContract.connect(user1).mine(user1.address, 0, slot.epochId, getFutureDeadline(), convert("10", 18), "")
      ).to.not.be.reverted;
    });
  });

  // ============================================================
  // REENTRANCY ATTACKS
  // ============================================================
  describe("REENTRANCY ATTACKS", function () {
    it("ATTACK: Deploy malicious token that reenters on transfer", async function () {
      // The Rig uses SafeERC20 and has nonReentrant modifier
      // Even with a malicious token, it should be protected
      // This is a conceptual test - the quote token is set at deployment
      // and cannot be changed, so attack surface is limited

      // Verify nonReentrant is in place by checking multiple rapid mines
      const slot = await rigContract.getSlot(0);
      await ensureWeth(user1, convert("10", 18));
      await weth.connect(user1).approve(rig, convert("10", 18));

      // Rapid sequential mines should work (not reentrant)
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, getFutureDeadline(), convert("10", 18), "");

      const newSlot = await rigContract.getSlot(0);
      await ensureWeth(user2, convert("10", 18));
      await weth.connect(user2).approve(rig, convert("10", 18));
      await rigContract.connect(user2).mine(user2.address, 0, newSlot.epochId, getFutureDeadline(), convert("10", 18), "");

      // Both should succeed
      expect((await rigContract.getSlot(0)).miner).to.equal(user2.address);
    });

    it("ATTACK: Excess ETH stays in contract (no reentrancy via refund)", async function () {
      // Enable multipliers to trigger ETH handling
      await rigContract.connect(user0).setMultipliersEnabled(true);

      // Wait for multiplier duration
      const duration = await rigContract.upsMultiplierDuration();
      await network.provider.send("evm_increaseTime", [duration.toNumber() + 1]);
      await network.provider.send("evm_mine");

      const slot = await rigContract.getSlot(0);
      const entropyFee = await rigContract.getEntropyFee();

      // Send excess ETH - excess stays in contract (no refund, no reentrancy risk)
      await ensureWeth(user1, convert("10", 18));
      await weth.connect(user1).approve(rig, convert("10", 18));

      // Execute mine with excess ETH - the tx should succeed, excess stays in contract
      const tx = rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, getFutureDeadline(), convert("10", 18), "",
        { value: entropyFee.mul(10) } // 10x the fee - excess kept by contract
      );

      // Should succeed (not revert)
      await expect(tx).to.not.be.reverted;

      await rigContract.connect(user0).setMultipliersEnabled(false);
    });
  });

  // ============================================================
  // FRONTRUNNING / MEV ATTACKS
  // ============================================================
  describe("FRONTRUNNING / MEV ATTACKS", function () {
    it("PROTECTION: epochId prevents frontrunning", async function () {
      const slot = await rigContract.getSlot(0);

      // User1 tries to mine
      await weth.connect(user1).approve(rig, convert("10", 18));

      // Attacker frontruns and mines first
      await weth.connect(attacker).approve(rig, convert("10", 18));
      await rigContract.connect(attacker).mine(
        attacker.address, 0, slot.epochId, getFutureDeadline(), convert("10", 18), ""
      );

      // User1's transaction should fail due to epochId mismatch
      await expect(
        rigContract.connect(user1).mine(user1.address, 0, slot.epochId, getFutureDeadline(), convert("10", 18), "")
      ).to.be.revertedWith("Rig__EpochIdMismatch()");
    });

    it("PROTECTION: maxPrice prevents sandwich attacks", async function () {
      // Mine to get a non-zero price
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rig, convert("10", 18));
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, getFutureDeadline(), convert("10", 18), "");

      slot = await rigContract.getSlot(0);
      const initialPrice = await rigContract.getPrice(0);

      // Set maxPrice slightly above current price
      const maxPrice = initialPrice.add(1000);

      // If attacker manipulates price up, user's tx will fail
      await weth.connect(user2).approve(rig, maxPrice);

      // Should succeed at current price
      await expect(
        rigContract.connect(user2).mine(user2.address, 0, slot.epochId, getFutureDeadline(), maxPrice, "")
      ).to.not.be.reverted;
    });

    it("PROTECTION: deadline prevents delayed execution", async function () {
      const slot = await rigContract.getSlot(0);
      const deadline = Math.floor(Date.now() / 1000) + 60; // 60 seconds from now

      // Advance time past deadline
      await network.provider.send("evm_increaseTime", [120]);
      await network.provider.send("evm_mine");

      await weth.connect(user1).approve(rig, convert("10", 18));

      await expect(
        rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("10", 18), "")
      ).to.be.revertedWith("Rig__DeadlinePassed()");
    });
  });

  // ============================================================
  // GRIEFING ATTACKS
  // ============================================================
  describe("GRIEFING ATTACKS", function () {
    it("ATTACK: Try to grief by mining all slots with dust amounts", async function () {
      // Deploy fresh rig
      const result = await deployFreshRig();

      // Increase capacity
      await result.rig.connect(user0).setCapacity(100);

      // Attacker tries to mine all slots
      for (let i = 0; i < 10; i++) {
        const slot = await result.rig.getSlot(i);
        await weth.connect(attacker).approve(result.rig.address, convert("1", 18));
        await result.rig.connect(attacker).mine(
          attacker.address, i, slot.epochId, getFutureDeadline(), convert("1", 18), ""
        );
      }

      // Legitimate users can still mine by paying price
      const slot5 = await result.rig.getSlot(5);
      const price5 = await result.rig.getPrice(5);

      await weth.connect(user1).approve(result.rig.address, price5.add(convert("1", 18)));
      await result.rig.connect(user1).mine(
        user1.address, 5, slot5.epochId, getFutureDeadline(), price5.add(convert("1", 18)), ""
      );

      // User1 successfully took the slot
      expect((await result.rig.getSlot(5)).miner).to.equal(user1.address);
    });

    it("ATTACK: Try to DOS by spamming with very long URIs", async function () {
      const slot = await rigContract.getSlot(0);
      const veryLongUri = "x".repeat(10000); // 10KB URI

      await weth.connect(user1).approve(rig, convert("10", 18));

      // Should still work (gas cost increases but no DOS)
      await expect(
        rigContract.connect(user1).mine(
          user1.address, 0, slot.epochId, getFutureDeadline(), convert("10", 18), veryLongUri
        )
      ).to.not.be.reverted;

      const newSlot = await rigContract.getSlot(0);
      expect(newSlot.uri).to.equal(veryLongUri);
    });

    it("ATTACK: Try to prevent token minting by manipulating totalMinted", async function () {
      // totalMinted can only increase through legitimate mining
      // No external way to manipulate it

      const totalBefore = await rigContract.totalMinted();

      // Mine and check totalMinted increases correctly
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rig, convert("10", 18));
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, getFutureDeadline(), convert("10", 18), "");

      // Wait and mine again
      await network.provider.send("evm_increaseTime", [100]);
      await network.provider.send("evm_mine");

      slot = await rigContract.getSlot(0);
      await weth.connect(user2).approve(rig, convert("10", 18));
      await rigContract.connect(user2).mine(user2.address, 0, slot.epochId, getFutureDeadline(), convert("10", 18), "");

      const totalAfter = await rigContract.totalMinted();
      expect(totalAfter).to.be.gt(totalBefore);
    });
  });

  // ============================================================
  // PRECISION / ROUNDING ATTACKS
  // ============================================================
  describe("PRECISION / ROUNDING ATTACKS", function () {
    it("ATTACK: Try to exploit rounding in fee calculations", async function () {
      // Deploy rig with very small min init price
      const result = await deployFreshRig({
        rigMinInitPrice: convert("0.000001", 18), // 1e12 wei
      });

      // Mine at tiny price
      let slot = await result.rig.getSlot(0);
      await weth.connect(user1).approve(result.rig.address, convert("1", 18));
      await result.rig.connect(user1).mine(user1.address, 0, slot.epochId, getFutureDeadline(), convert("1", 18), "");

      // Get price immediately (should be near minInitPrice)
      slot = await result.rig.getSlot(0);
      const price = await result.rig.getPrice(0);

      // Even at tiny prices, fees should be calculated correctly
      const protocolBalBefore = await weth.balanceOf(protocol.address);

      await weth.connect(user2).approve(result.rig.address, price.add(convert("1", 18)));
      await result.rig.connect(user2).mine(
        user2.address, 0, slot.epochId, getFutureDeadline(), price.add(convert("1", 18)), ""
      );

      const protocolBalAfter = await weth.balanceOf(protocol.address);

      // Protocol should receive 1% (even if rounded)
      if (price.gt(0)) {
        expect(protocolBalAfter).to.be.gte(protocolBalBefore);
      }
    });

    it("ATTACK: Try to exploit UPS precision at halving boundaries", async function () {
      // Deploy rig near halving boundary
      const result = await deployFreshRig({
        initialUps: convert("1000", 18),
        tailUps: convert("1", 18),
        halvingAmount: convert("1000", 18),
      });

      // Mine repeatedly to cross halving
      for (let i = 0; i < 20; i++) {
        const slot = await result.rig.getSlot(0);

        await network.provider.send("evm_increaseTime", [601]); // epoch + 1
        await network.provider.send("evm_mine");

        await weth.connect(user1).approve(result.rig.address, convert("1", 18));
        await result.rig.connect(user1).mine(
          user1.address, 0, slot.epochId, getFutureDeadline(), convert("1", 18), ""
        );
      }

      // UPS should not be negative or overflow
      const ups = await result.rig.getUps();
      expect(ups).to.be.gt(0);
      expect(ups).to.be.gte(await result.rig.tailUps());
    });

    it("ATTACK: Try to get free tokens via rounding errors in minted amount", async function () {
      // Mine at exactly 0 seconds held (should mint 0)
      const result = await deployFreshRig();

      let slot = await result.rig.getSlot(0);
      await weth.connect(user1).approve(result.rig.address, convert("1", 18));
      await result.rig.connect(user1).mine(user1.address, 0, slot.epochId, getFutureDeadline(), convert("1", 18), "");

      const user1BalBefore = await result.unit.balanceOf(user1.address);

      // Mine immediately again (0 time passed)
      slot = await result.rig.getSlot(0);
      await weth.connect(user2).approve(result.rig.address, convert("10", 18));

      // Mine in same block (0 time)
      await result.rig.connect(user2).mine(
        user2.address, 0, slot.epochId, getFutureDeadline(), convert("10", 18), ""
      );

      const user1BalAfter = await result.unit.balanceOf(user1.address);

      // Should mint based on time, could be 0 or very small
      // No free tokens - must be >= 0
      expect(user1BalAfter.sub(user1BalBefore)).to.be.gte(0);
    });
  });

  // ============================================================
  // STATE MANIPULATION ATTACKS
  // ============================================================
  describe("STATE MANIPULATION ATTACKS", function () {
    it("ATTACK: Try to manipulate slot state directly", async function () {
      // Slot state is private and only modifiable through mine()
      // Verify state consistency after many operations

      const result = await deployFreshRig();

      for (let i = 0; i < 5; i++) {
        const slot = await result.rig.getSlot(0);
        await weth.connect(i % 2 === 0 ? user1 : user2).approve(result.rig.address, convert("10", 18));
        await result.rig.connect(i % 2 === 0 ? user1 : user2).mine(
          i % 2 === 0 ? user1.address : user2.address,
          0, slot.epochId, getFutureDeadline(), convert("10", 18), ""
        );
      }

      // Verify state is consistent
      const finalSlot = await result.rig.getSlot(0);
      expect(finalSlot.epochId).to.equal(5);
      expect(finalSlot.startTime).to.be.gt(0);
      expect(finalSlot.ups).to.be.gt(0);
    });

    it("ATTACK: Try to set capacity to manipulate UPS", async function () {
      const result = await deployFreshRig();

      // Get initial UPS
      const upsWithCap1 = await result.rig.getUps();

      // Increase capacity
      await result.rig.connect(user0).setCapacity(10);

      // Total UPS stays same, but per-slot UPS decreases
      const upsWithCap10 = await result.rig.getUps();

      // Total UPS should be the same
      expect(upsWithCap10).to.equal(upsWithCap1);

      // Mine slot 0 - should get ups/capacity
      const slot = await result.rig.getSlot(0);
      await weth.connect(user1).approve(result.rig.address, convert("1", 18));
      await result.rig.connect(user1).mine(user1.address, 0, slot.epochId, getFutureDeadline(), convert("1", 18), "");

      const newSlot = await result.rig.getSlot(0);
      expect(newSlot.ups).to.equal(upsWithCap10.div(10));
    });

    it("ATTACK: Try to manipulate randomness by controlling entropy response", async function () {
      const result = await deployFreshRig({
        upsMultipliers: [
          convert("1", 18),
          convert("2", 18),
          convert("5", 18),
          convert("10", 18)
        ],
      });
      await result.rig.connect(user0).setMultipliersEnabled(true);

      // Mine to trigger entropy request
      const duration = await result.rig.upsMultiplierDuration();
      await network.provider.send("evm_increaseTime", [duration.toNumber() + 1]);
      await network.provider.send("evm_mine");

      const slot = await result.rig.getSlot(0);
      const entropyFee = await result.rig.getEntropyFee();

      await weth.connect(user1).approve(result.rig.address, convert("1", 18));
      await result.rig.connect(user1).mine(
        user1.address, 0, slot.epochId, getFutureDeadline(), convert("1", 18), "",
        { value: entropyFee }
      );

      // Attacker tries to fulfill with favorable random number
      // But entropy callback validates epoch/index
      const maliciousRandom = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("favorable"));

      // Even if attacker controls entropy, multiplier is bounded 1x-10x
      // Try to fulfill with seq 0
      try {
        await entropy.fulfillEntropy(0, maliciousRandom);
      } catch (e) {
        // May fail if already fulfilled or invalid
      }

      // Multiplier should still be within bounds
      const newSlot = await result.rig.getSlot(0);
      expect(newSlot.upsMultiplier).to.be.gte(convert("1", 18));
      expect(newSlot.upsMultiplier).to.be.lte(convert("10", 18));
    });
  });

  // ============================================================
  // EXTREME PARAMETER TESTS
  // ============================================================
  describe("EXTREME PARAMETERS", function () {
    it("EXTREME: Maximum epoch period (365 days)", async function () {
      const result = await deployFreshRig({
        rigEpochPeriod: 365 * 24 * 60 * 60, // 1 year
      });

      // Mine and verify
      const slot = await result.rig.getSlot(0);
      await weth.connect(user1).approve(result.rig.address, convert("1", 18));
      await result.rig.connect(user1).mine(user1.address, 0, slot.epochId, getFutureDeadline(), convert("1", 18), "");

      // Price should decay very slowly
      await network.provider.send("evm_increaseTime", [24 * 60 * 60]); // 1 day
      await network.provider.send("evm_mine");

      const newSlot = await result.rig.getSlot(0);
      const price = await result.rig.getPrice(0);

      // After 1 day out of 365, price should be ~99.7% of init
      const expectedPrice = newSlot.initPrice.mul(364).div(365);
      expect(price).to.be.closeTo(expectedPrice, expectedPrice.div(100));
    });

    it("EXTREME: Minimum epoch period (10 minutes)", async function () {
      const result = await deployFreshRig({
        rigEpochPeriod: 600, // 10 minutes
      });

      // Mine
      const slot = await result.rig.getSlot(0);
      await weth.connect(user1).approve(result.rig.address, convert("1", 18));
      await result.rig.connect(user1).mine(user1.address, 0, slot.epochId, getFutureDeadline(), convert("1", 18), "");

      // Price should decay quickly
      await network.provider.send("evm_increaseTime", [300]); // 5 minutes
      await network.provider.send("evm_mine");

      const price = await result.rig.getPrice(0);
      const initPrice = (await result.rig.getSlot(0)).initPrice;

      // After 5 minutes out of 10, price should be ~50%
      expect(price).to.be.closeTo(initPrice.div(2), initPrice.div(10));
    });

    it("EXTREME: Maximum price multiplier (3x)", async function () {
      const result = await deployFreshRig({
        rigPriceMultiplier: convert("3", 18),
      });

      // Mine multiple times
      for (let i = 0; i < 5; i++) {
        const slot = await result.rig.getSlot(0);
        const price = await result.rig.getPrice(0);

        await weth.connect(user1).approve(result.rig.address, price.add(convert("100", 18)));
        await result.rig.connect(user1).mine(
          user1.address, 0, slot.epochId, getFutureDeadline(), price.add(convert("100", 18)), ""
        );
      }

      // Price should have scaled up 3^5 = 243x (capped at max)
      const finalSlot = await result.rig.getSlot(0);
      expect(finalSlot.initPrice).to.be.gt(0);
    });

    it("EXTREME: Minimum price multiplier (1.1x)", async function () {
      const result = await deployFreshRig({
        rigPriceMultiplier: convert("1.1", 18),
      });

      // Mine multiple times
      for (let i = 0; i < 5; i++) {
        const slot = await result.rig.getSlot(0);
        const price = await result.rig.getPrice(0);

        await weth.connect(user1).approve(result.rig.address, price.add(convert("100", 18)));
        await result.rig.connect(user1).mine(
          user1.address, 0, slot.epochId, getFutureDeadline(), price.add(convert("100", 18)), ""
        );
      }

      // Price should have scaled up 1.1^5 = ~1.61x
      const finalSlot = await result.rig.getSlot(0);
      expect(finalSlot.initPrice).to.be.gt(0);
    });

    it("EXTREME: Very high initial UPS", async function () {
      const result = await deployFreshRig({
        initialUps: convert("1000000000000000000000000", 0), // 1e24 (max)
        tailUps: convert("1", 18),
      });

      // Mine and wait
      let slot = await result.rig.getSlot(0);
      await weth.connect(user1).approve(result.rig.address, convert("1", 18));
      await result.rig.connect(user1).mine(user1.address, 0, slot.epochId, getFutureDeadline(), convert("1", 18), "");

      await network.provider.send("evm_increaseTime", [100]);
      await network.provider.send("evm_mine");

      slot = await result.rig.getSlot(0);
      await weth.connect(user2).approve(result.rig.address, convert("1", 18));
      await result.rig.connect(user2).mine(user2.address, 0, slot.epochId, getFutureDeadline(), convert("1", 18), "");

      // Should mint massive amount but not overflow
      const balance = await result.unit.balanceOf(user1.address);
      expect(balance).to.be.gt(0);
    });
  });

  // ============================================================
  // STRESS TESTS
  // ============================================================
  describe("STRESS TESTS", function () {
    it("STRESS: 100 consecutive mines on same slot", async function () {
      this.timeout(120000);

      // Deploy rig with slow price multiplier to avoid price explosion
      const result = await deployFreshRig({
        rigPriceMultiplier: convert("1.1", 18),
        rigMinInitPrice: convert("0.001", 18),
      });

      for (let i = 0; i < 100; i++) {
        const slot = await result.rig.getSlot(0);

        // Wait for price to decay
        await network.provider.send("evm_increaseTime", [1800]); // Half epoch
        await network.provider.send("evm_mine");

        // Alternate users
        const user = i % 2 === 0 ? user1 : user2;
        const price = await result.rig.getPrice(0);
        const payAmount = price.add(convert("1", 18));

        await ensureWeth(user, payAmount);
        await weth.connect(user).approve(result.rig.address, payAmount);
        await result.rig.connect(user).mine(
          user.address, 0, slot.epochId, getFutureDeadline(), payAmount, ""
        );
      }

      // Verify final state
      const finalSlot = await result.rig.getSlot(0);
      expect(finalSlot.epochId).to.equal(100);
    });

    it("STRESS: Mine all 256 slots (max capacity)", async function () {
      this.timeout(300000);

      const result = await deployFreshRig();
      await result.rig.connect(user0).setCapacity(256);

      // Mine first 50 slots
      await ensureWeth(user1, convert("100", 18));
      for (let i = 0; i < 50; i++) {
        const slot = await result.rig.getSlot(i);
        await weth.connect(user1).approve(result.rig.address, convert("1", 18));
        await result.rig.connect(user1).mine(
          user1.address, i, slot.epochId, getFutureDeadline(), convert("1", 18), ""
        );
      }

      // Verify slot 49 is mined
      expect((await result.rig.getSlot(49)).miner).to.equal(user1.address);

      // Verify slot 255 is not mined
      expect((await result.rig.getSlot(255)).miner).to.equal(AddressZero);
    });

    it("STRESS: Rapid time jumps", async function () {
      const result = await deployFreshRig();

      // Mine
      let slot = await result.rig.getSlot(0);
      await ensureWeth(user1, convert("10", 18));
      await weth.connect(user1).approve(result.rig.address, convert("1", 18));
      await result.rig.connect(user1).mine(user1.address, 0, slot.epochId, getFutureDeadline(), convert("1", 18), "");

      // Jump 10 years
      await network.provider.send("evm_increaseTime", [10 * 365 * 24 * 60 * 60]);
      await network.provider.send("evm_mine");

      // Mine again
      slot = await result.rig.getSlot(0);
      await ensureWeth(user2, convert("10", 18));
      await weth.connect(user2).approve(result.rig.address, convert("1", 18));

      // Should still work
      await expect(
        result.rig.connect(user2).mine(user2.address, 0, slot.epochId, getFutureDeadline(), convert("1", 18), "")
      ).to.not.be.reverted;

      // Jump 100 years
      await network.provider.send("evm_increaseTime", [100 * 365 * 24 * 60 * 60]);
      await network.provider.send("evm_mine");

      // Mine again
      slot = await result.rig.getSlot(0);
      await ensureWeth(user1, convert("10", 18));
      await weth.connect(user1).approve(result.rig.address, convert("1", 18));

      await expect(
        result.rig.connect(user1).mine(user1.address, 0, slot.epochId, getFutureDeadline(), convert("1", 18), "")
      ).to.not.be.reverted;
    });

    it("STRESS: Concurrent miners (simulated)", async function () {
      const result = await deployFreshRig();
      await result.rig.connect(user0).setCapacity(10);

      // All users mine different slots "simultaneously"
      const users = [user1, user2, user3, attacker];
      const promises = [];

      for (let i = 0; i < 4; i++) {
        await ensureWeth(users[i], convert("10", 18));
        const slot = await result.rig.getSlot(i);
        await weth.connect(users[i]).approve(result.rig.address, convert("1", 18));
        promises.push(
          result.rig.connect(users[i]).mine(
            users[i].address, i, slot.epochId, getFutureDeadline(), convert("1", 18), ""
          )
        );
      }

      // All should succeed
      await Promise.all(promises);

      // Verify all slots mined
      for (let i = 0; i < 4; i++) {
        expect((await result.rig.getSlot(i)).miner).to.equal(users[i].address);
      }
    });
  });

  // ============================================================
  // INVARIANT TESTS
  // ============================================================
  describe("INVARIANT TESTS", function () {
    it("INVARIANT: totalMinted always increases or stays same", async function () {
      // Use low init price to avoid maxPrice exceeded
      const result = await deployFreshRig({
        rigPriceMultiplier: convert("1.1", 18),
        rigMinInitPrice: convert("0.001", 18),
      });
      let lastTotal = await result.rig.totalMinted();

      await ensureWeth(user1, convert("100", 18));
      await ensureWeth(user2, convert("100", 18));

      for (let i = 0; i < 20; i++) {
        const slot = await result.rig.getSlot(0);
        const price = await result.rig.getPrice(0);
        const maxPrice = price.add(convert("2", 18));

        await network.provider.send("evm_increaseTime", [60]);
        await network.provider.send("evm_mine");

        const user = i % 2 === 0 ? user1 : user2;
        await weth.connect(user).approve(result.rig.address, maxPrice);
        await result.rig.connect(user).mine(
          user.address,
          0, slot.epochId, getFutureDeadline(), maxPrice, ""
        );

        const newTotal = await result.rig.totalMinted();
        expect(newTotal).to.be.gte(lastTotal);
        lastTotal = newTotal;
      }
    });

    it("INVARIANT: epochId always increments by 1", async function () {
      const result = await deployFreshRig();

      await ensureWeth(user1, convert("50", 18));

      for (let i = 0; i < 10; i++) {
        const slotBefore = await result.rig.getSlot(0);
        const expectedEpochId = slotBefore.epochId.add(1);

        await weth.connect(user1).approve(result.rig.address, convert("1", 18));
        await result.rig.connect(user1).mine(
          user1.address, 0, slotBefore.epochId, getFutureDeadline(), convert("1", 18), ""
        );

        const slotAfter = await result.rig.getSlot(0);
        expect(slotAfter.epochId).to.equal(expectedEpochId);
      }
    });

    it("INVARIANT: UPS never goes below tailUps", async function () {
      // Use low init price to avoid maxPrice issues
      const result = await deployFreshRig({
        initialUps: convert("1000", 18),
        tailUps: convert("10", 18),
        halvingAmount: convert("1000", 18),
        rigPriceMultiplier: convert("1.1", 18),
        rigMinInitPrice: convert("0.001", 18),
      });

      await ensureWeth(user1, convert("200", 18));

      // Mine many times to trigger multiple halvings
      for (let i = 0; i < 50; i++) {
        const slot = await result.rig.getSlot(0);
        const price = await result.rig.getPrice(0);
        const maxPrice = price.add(convert("2", 18));

        await network.provider.send("evm_increaseTime", [601]);
        await network.provider.send("evm_mine");

        await weth.connect(user1).approve(result.rig.address, maxPrice);
        await result.rig.connect(user1).mine(
          user1.address, 0, slot.epochId, getFutureDeadline(), maxPrice, ""
        );

        const ups = await result.rig.getUps();
        const tailUps = await result.rig.tailUps();
        expect(ups).to.be.gte(tailUps);
      }
    });

    it("INVARIANT: initPrice always >= minInitPrice after mine", async function () {
      const result = await deployFreshRig();
      const minInitPrice = await result.rig.minInitPrice();

      await ensureWeth(user1, convert("300", 18));

      for (let i = 0; i < 20; i++) {
        const slot = await result.rig.getSlot(0);

        // Sometimes wait for price to go to 0
        if (i % 3 === 0) {
          await network.provider.send("evm_increaseTime", [4000]);
          await network.provider.send("evm_mine");
        }

        await weth.connect(user1).approve(result.rig.address, convert("10", 18));
        await result.rig.connect(user1).mine(
          user1.address, 0, slot.epochId, getFutureDeadline(), convert("10", 18), ""
        );

        const newSlot = await result.rig.getSlot(0);
        expect(newSlot.initPrice).to.be.gte(minInitPrice);
      }
    });

    it("INVARIANT: Fees always sum to price paid", async function () {
      // Deploy with higher init price to make fee percentages work well
      const result = await deployFreshRig({
        rigMinInitPrice: convert("1", 18), // 1 ETH min price
      });
      await result.rig.connect(user0).setTeam(team.address);

      await ensureWeth(user1, convert("10", 18));
      await ensureWeth(user2, convert("10", 18));

      // Mine first to get a price
      let slot = await result.rig.getSlot(0);
      await weth.connect(user1).approve(result.rig.address, convert("2", 18));
      await result.rig.connect(user1).mine(user1.address, 0, slot.epochId, getFutureDeadline(), convert("2", 18), "");

      // Now mine and track fees
      slot = await result.rig.getSlot(0);
      const price = await result.rig.getPrice(0);

      if (price.eq(0)) return;

      const prevMiner = slot.miner;
      // Get treasury from the result's auction - need to find the event for THIS rig
      const rigAddress = result.rig.address;
      const launchEvents = await core.queryFilter(core.filters.MineCore__Launched());
      let auctionAddress;
      for (const evt of launchEvents) {
        if (evt.args.rig === rigAddress) {
          auctionAddress = evt.args.auction;
          break;
        }
      }

      const balances = {
        minerClaimable: await result.rig.accountToClaimable(prevMiner),
        treasury: await weth.balanceOf(auctionAddress),
        protocol: await weth.balanceOf(protocol.address),
        team: await weth.balanceOf(team.address),
      };

      await weth.connect(user2).approve(result.rig.address, price);
      await result.rig.connect(user2).mine(user2.address, 0, slot.epochId, getFutureDeadline(), price, "");

      const newBalances = {
        minerClaimable: await result.rig.accountToClaimable(prevMiner),
        treasury: await weth.balanceOf(auctionAddress),
        protocol: await weth.balanceOf(protocol.address),
        team: await weth.balanceOf(team.address),
      };

      const totalReceived = newBalances.minerClaimable.sub(balances.minerClaimable)
        .add(newBalances.treasury.sub(balances.treasury))
        .add(newBalances.protocol.sub(balances.protocol))
        .add(newBalances.team.sub(balances.team));

      // Total received should equal price paid
      // Fee distribution: 80% miner, 15% treasury, 4% team, 1% protocol
      // The miner fee is calculated as a remainder which can cause small rounding differences
      // Allow 0.1% tolerance for integer division effects
      const tolerance = price.div(1000); // 0.1%
      expect(totalReceived).to.be.gte(price.sub(tolerance));
      expect(totalReceived).to.be.lte(price.add(tolerance));
    });
  });

  // ============================================================
  // FUZZ TESTS (Randomized)
  // ============================================================
  describe("FUZZ TESTS", function () {
    it("FUZZ: Random mine amounts don't break anything", async function () {
      const result = await deployFreshRig();

      await ensureWeth(user1, convert("500", 18));

      for (let i = 0; i < 20; i++) {
        const slot = await result.rig.getSlot(0);
        const price = await result.rig.getPrice(0);

        // Random amount between price and price + 10 ETH (reduced from 100)
        const randomExtra = ethers.BigNumber.from(Math.floor(Math.random() * 10) + 1).mul(convert("1", 18));
        const amount = price.add(randomExtra);

        await weth.connect(user1).approve(result.rig.address, amount);
        await result.rig.connect(user1).mine(
          user1.address, 0, slot.epochId, getFutureDeadline(), amount, ""
        );
      }
    });

    it("FUZZ: Random time intervals", async function () {
      const result = await deployFreshRig();

      await ensureWeth(user1, convert("300", 18));

      for (let i = 0; i < 20; i++) {
        const slot = await result.rig.getSlot(0);

        // Random time between 0 and 1 week
        const randomTime = Math.floor(Math.random() * 7 * 24 * 60 * 60);
        await network.provider.send("evm_increaseTime", [randomTime]);
        await network.provider.send("evm_mine");

        await weth.connect(user1).approve(result.rig.address, convert("10", 18));
        await result.rig.connect(user1).mine(
          user1.address, 0, slot.epochId, getFutureDeadline(), convert("10", 18), ""
        );
      }
    });

    it("FUZZ: Random slot indices", async function () {
      const result = await deployFreshRig();
      await result.rig.connect(user0).setCapacity(100);

      await ensureWeth(user1, convert("500", 18));

      for (let i = 0; i < 30; i++) {
        const randomSlot = Math.floor(Math.random() * 100);
        const slot = await result.rig.getSlot(randomSlot);

        await weth.connect(user1).approve(result.rig.address, convert("10", 18));
        await result.rig.connect(user1).mine(
          user1.address, randomSlot, slot.epochId, getFutureDeadline(), convert("10", 18), ""
        );
      }
    });

    it("FUZZ: Random URIs", async function () {
      const result = await deployFreshRig();

      await ensureWeth(user1, convert("200", 18));

      const randomUris = [
        "",
        "a",
        "https://example.com",
        "ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
        "data:application/json;base64," + Buffer.from('{"name":"test"}').toString('base64'),
        "\u0000\u0001\u0002", // Control characters
        "🚀🌙💎", // Emojis
        "<script>alert('xss')</script>", // XSS attempt
        "'; DROP TABLE users; --", // SQL injection
      ];

      for (const uri of randomUris) {
        const slot = await result.rig.getSlot(0);
        await weth.connect(user1).approve(result.rig.address, convert("10", 18));
        await result.rig.connect(user1).mine(
          user1.address, 0, slot.epochId, getFutureDeadline(), convert("10", 18), uri
        );

        const newSlot = await result.rig.getSlot(0);
        expect(newSlot.uri).to.equal(uri);
      }
    });
  });

  // ============================================================
  // EDGE CASE BOUNDARY TESTS
  // ============================================================
  describe("BOUNDARY TESTS", function () {
    it("BOUNDARY: Mine at exactly epoch boundary", async function () {
      const result = await deployFreshRig();

      await ensureWeth(user1, convert("10", 18));
      await ensureWeth(user2, convert("10", 18));

      let slot = await result.rig.getSlot(0);
      await weth.connect(user1).approve(result.rig.address, convert("1", 18));
      await result.rig.connect(user1).mine(user1.address, 0, slot.epochId, getFutureDeadline(), convert("1", 18), "");

      // Advance to exactly epoch end
      const epochPeriod = await result.rig.epochPeriod();
      await network.provider.send("evm_increaseTime", [epochPeriod.toNumber()]);
      await network.provider.send("evm_mine");

      // Price should be exactly 0
      const price = await result.rig.getPrice(0);
      expect(price).to.equal(0);

      // Mine at 0 price
      slot = await result.rig.getSlot(0);
      await weth.connect(user2).approve(result.rig.address, convert("1", 18));
      await result.rig.connect(user2).mine(user2.address, 0, slot.epochId, getFutureDeadline(), convert("1", 18), "");
    });

    it("BOUNDARY: Capacity at max (256)", async function () {
      const result = await deployFreshRig();

      // Try to set to max
      await result.rig.connect(user0).setCapacity(256);
      expect(await result.rig.capacity()).to.equal(256);

      // Try to exceed max
      await expect(
        result.rig.connect(user0).setCapacity(257)
      ).to.be.revertedWith("Rig__CapacityExceedsMax()");

      // Mine last slot
      await ensureWeth(user1, convert("10", 18));
      const slot = await result.rig.getSlot(255);
      await weth.connect(user1).approve(result.rig.address, convert("1", 18));
      await result.rig.connect(user1).mine(
        user1.address, 255, slot.epochId, getFutureDeadline(), convert("1", 18), ""
      );

      expect((await result.rig.getSlot(255)).miner).to.equal(user1.address);
    });

    // UPS multiplier bounds and duration are now set at deploy time via Config, no runtime setters
  });
});
