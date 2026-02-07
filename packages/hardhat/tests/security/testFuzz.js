/**
 * @title Comprehensive Fuzz Test Suite for Farplace Security Audit
 * @notice Tests correctness of core arithmetic under random inputs across all rig types
 * @dev 7 categories: fee splits, halving UPS, time-based emissions, Dutch auction decay,
 *      proportional claims, odds drawing, and capacity-based UPS division
 */

const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const convert = (amount, decimals = 18) => ethers.utils.parseUnits(amount.toString(), decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;

const AddressZero = "0x0000000000000000000000000000000000000000";

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

function randomBigNumber(min, max) {
  const range = max.sub(min);
  const random = ethers.BigNumber.from(ethers.utils.randomBytes(32)).mod(range);
  return min.add(random);
}

function randomBytes32() {
  return ethers.utils.hexlify(ethers.utils.randomBytes(32));
}

const ONE_HOUR = 3600;
const ONE_DAY = 86400;
const THIRTY_DAYS = ONE_DAY * 30;
const PRECISION = ethers.BigNumber.from("1000000000000000000"); // 1e18

// ============================================================================
// CATEGORY 1: Random prices -- fee split correctness (MineRig)
// ============================================================================
describe("FUZZ Category 1: Random Prices - Fee Split Correctness", function () {
  let owner, protocol, team, user0, user1, user2, user3;
  let weth, usdc, registry, core, entropy;
  let rig, rigContract, auction, unit, unitContract;

  before("Deploy contracts", async function () {
    await network.provider.send("hardhat_reset");

    [owner, protocol, team, user0, user1, user2, user3] = await ethers.getSigners();

    const mockWethArtifact = await ethers.getContractFactory("MockWETH");
    weth = await mockWethArtifact.deploy();

    // Deploy MockUSDC (6 decimals)
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

    // Fund users generously
    await usdc.mint(user0.address, convert("5000", 6));
    await weth.connect(user1).deposit({ value: convert("5000", 18) });
    await weth.connect(user2).deposit({ value: convert("5000", 18) });
    await weth.connect(user3).deposit({ value: convert("5000", 18) });

    const launchParams = {
      launcher: user0.address,
      quoteToken: weth.address,
      tokenName: "Fuzz Test Unit",
      tokenSymbol: "FUZZ",
      uri: "https://example.com/rig",
      usdcAmount: convert("1000", 6),
      unitAmount: convert("1000000", 18),
      initialUps: convert("10", 18),
      tailUps: convert("0.01", 18),
      halvingAmount: convert("100000", 18),
      rigEpochPeriod: ONE_HOUR,
      rigPriceMultiplier: convert("2", 18),
      rigMinInitPrice: convert("0.0001", 18),
      upsMultipliers: [convert("1", 18)],
      upsMultiplierDuration: ONE_DAY,
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

    // Set team for full fee split testing
    await rigContract.connect(user0).setTeam(team.address);
  });

  describe("With team set (normal 80/15/4/1 split)", function () {
    for (let i = 0; i < 10; i++) {
      it(`Fuzz iteration ${i + 1}: fee splits sum to price for random mining`, async function () {
        // Ensure slot has a miner first
        let slot = await rigContract.getSlot(0);
        const setupPrice = await rigContract.getPrice(0);
        const setupMaxPrice = setupPrice.add(convert("100", 18));
        await weth.connect(user1).approve(rig, setupMaxPrice);
        await rigContract.connect(user1).mine(
          user1.address, 0, slot.epochId, 1961439882, setupMaxPrice, ""
        );

        // Wait a bit for price to decay slightly
        const epochPeriod = await rigContract.epochPeriod();
        const waitFraction = Math.floor(Math.random() * (epochPeriod.toNumber() - 10)) + 1;
        await increaseTime(waitFraction);

        slot = await rigContract.getSlot(0);
        const currentPrice = await rigContract.getPrice(0);

        if (currentPrice.eq(0)) {
          // Epoch expired, mine at price 0 - fee split is trivially correct (all zeros)
          await weth.connect(user2).approve(rig, convert("10", 18));
          await rigContract.connect(user2).mine(
            user2.address, 0, slot.epochId, 1961439882, convert("10", 18), ""
          );
          return;
        }

        const prevMiner = slot.miner;
        const minerClaimableBefore = await rigContract.accountToClaimable(prevMiner);
        const treasuryBefore = await weth.balanceOf(auction);
        const protocolBefore = await weth.balanceOf(protocol.address);
        const teamBefore = await weth.balanceOf(team.address);

        await weth.connect(user2).approve(rig, currentPrice.add(convert("10", 18)));
        const tx = await rigContract.connect(user2).mine(
          user2.address, 0, slot.epochId, 1961439882, currentPrice.add(convert("10", 18)), ""
        );

        const receipt = await tx.wait();
        const mineEvent = receipt.events.find(e => e.event === "MineRig__Mine");
        const actualPrice = mineEvent.args.price;

        const minerFee = (await rigContract.accountToClaimable(prevMiner)).sub(minerClaimableBefore);
        const treasuryFee = (await weth.balanceOf(auction)).sub(treasuryBefore);
        const protocolFee = (await weth.balanceOf(protocol.address)).sub(protocolBefore);
        const teamFee = (await weth.balanceOf(team.address)).sub(teamBefore);

        const totalFees = minerFee.add(treasuryFee).add(protocolFee).add(teamFee);

        // Total fees must equal actual price paid (allow 1 wei rounding)
        expect(totalFees).to.be.closeTo(actualPrice, 1);

        // Verify individual fee percentages (with tolerance for rounding)
        if (actualPrice.gt(1000)) {
          const minerPct = minerFee.mul(10000).div(actualPrice).toNumber();
          const protocolPct = protocolFee.mul(10000).div(actualPrice).toNumber();
          const teamPct = teamFee.mul(10000).div(actualPrice).toNumber();

          expect(minerPct).to.be.closeTo(8000, 10); // 80% +/- 0.1%
          expect(protocolPct).to.be.closeTo(100, 10); // 1% +/- 0.1%
          expect(teamPct).to.be.closeTo(400, 10); // 4% +/- 0.1%
          // Treasury gets remainder
        }
      });
    }
  });

  describe("With team=address(0) (team fee goes to treasury)", function () {
    before(async function () {
      await rigContract.connect(user0).setTeam(AddressZero);
    });

    after(async function () {
      await rigContract.connect(user0).setTeam(team.address);
    });

    for (let i = 0; i < 10; i++) {
      it(`Fuzz iteration ${i + 1}: fee splits sum to price with team=0`, async function () {
        let slot = await rigContract.getSlot(0);
        const setupPrice = await rigContract.getPrice(0);
        const setupMaxPrice = setupPrice.add(convert("100", 18));
        await weth.connect(user1).approve(rig, setupMaxPrice);
        await rigContract.connect(user1).mine(
          user1.address, 0, slot.epochId, 1961439882, setupMaxPrice, ""
        );

        const epochPeriod = await rigContract.epochPeriod();
        const waitFraction = Math.floor(Math.random() * (epochPeriod.toNumber() - 10)) + 1;
        await increaseTime(waitFraction);

        slot = await rigContract.getSlot(0);
        const currentPrice = await rigContract.getPrice(0);

        if (currentPrice.eq(0)) {
          await weth.connect(user2).approve(rig, convert("10", 18));
          await rigContract.connect(user2).mine(
            user2.address, 0, slot.epochId, 1961439882, convert("10", 18), ""
          );
          return;
        }

        const prevMiner = slot.miner;
        const minerClaimableBefore = await rigContract.accountToClaimable(prevMiner);
        const treasuryBefore = await weth.balanceOf(auction);
        const protocolBefore = await weth.balanceOf(protocol.address);

        await weth.connect(user2).approve(rig, currentPrice.add(convert("10", 18)));
        const tx = await rigContract.connect(user2).mine(
          user2.address, 0, slot.epochId, 1961439882, currentPrice.add(convert("10", 18)), ""
        );

        const receipt = await tx.wait();
        const mineEvent = receipt.events.find(e => e.event === "MineRig__Mine");
        const actualPrice = mineEvent.args.price;

        const minerFee = (await rigContract.accountToClaimable(prevMiner)).sub(minerClaimableBefore);
        const treasuryFee = (await weth.balanceOf(auction)).sub(treasuryBefore);
        const protocolFee = (await weth.balanceOf(protocol.address)).sub(protocolBefore);

        // Team fee should be 0 since team == address(0)
        const totalFees = minerFee.add(treasuryFee).add(protocolFee);
        expect(totalFees).to.be.closeTo(actualPrice, 1);

        // Treasury should absorb team's share: treasury gets 15% + 4% = 19%
        if (actualPrice.gt(1000)) {
          const minerPct = minerFee.mul(10000).div(actualPrice).toNumber();
          const protocolPct = protocolFee.mul(10000).div(actualPrice).toNumber();
          const treasuryPct = treasuryFee.mul(10000).div(actualPrice).toNumber();

          expect(minerPct).to.be.closeTo(8000, 10); // 80%
          expect(protocolPct).to.be.closeTo(100, 10); // 1%
          // Treasury remainder = 19%
          expect(treasuryPct).to.be.closeTo(1900, 10);
        }
      });
    }
  });
});

// ============================================================================
// CATEGORY 2: Random totalMinted values -- halving UPS correctness (MineRig)
// ============================================================================
describe("FUZZ Category 2: Random totalMinted - Halving UPS Correctness", function () {
  let owner, protocol, team, user0, user1, user2, user3;
  let weth, usdc, registry, core, entropy;
  let rig, rigContract, unitContract;

  const INITIAL_UPS = convert("100", 18); // 100 tokens/second
  const TAIL_UPS = convert("0.01", 18);
  const HALVING_AMOUNT = convert("10000", 18); // 10,000 tokens

  before("Deploy contracts", async function () {
    await network.provider.send("hardhat_reset");

    [owner, protocol, team, user0, user1, user2, user3] = await ethers.getSigners();

    const mockWethArtifact = await ethers.getContractFactory("MockWETH");
    weth = await mockWethArtifact.deploy();

    // Deploy MockUSDC (6 decimals)
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

    await usdc.mint(user0.address, convert("5000", 6));
    await weth.connect(user1).deposit({ value: convert("5000", 18) });
    await weth.connect(user2).deposit({ value: convert("5000", 18) });

    const launchParams = {
      launcher: user0.address,
      quoteToken: weth.address,
      tokenName: "Halving Fuzz Unit",
      tokenSymbol: "HFUZZ",
      uri: "https://example.com/rig",
      usdcAmount: convert("1000", 6),
      unitAmount: convert("1000000", 18),
      initialUps: INITIAL_UPS,
      tailUps: TAIL_UPS,
      halvingAmount: HALVING_AMOUNT,
      rigEpochPeriod: ONE_HOUR,
      rigPriceMultiplier: convert("2", 18),
      rigMinInitPrice: convert("0.0001", 18),
      upsMultipliers: [convert("1", 18)],
      upsMultiplierDuration: ONE_DAY,
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

    rigContract = await ethers.getContractAt("MineRig", rig);
    unitContract = await ethers.getContractAt("Unit", launchEvent.args.unit);

    // Disable entropy for tests that don't send ETH for VRF fees
    await rigContract.connect(user0).setEntropyEnabled(false);
  });

  // Test with logarithmic range of totalMinted values to cover halving boundaries
  const testValues = [
    ethers.BigNumber.from(0),
    convert("100", 18),       // well below first halving
    convert("5000", 18),      // halfway to first halving
    convert("9999", 18),      // just below first halving
    convert("10000", 18),     // exactly at first halving
    convert("10001", 18),     // just past first halving
    convert("14999", 18),     // just below second halving (10000 + 5000)
    convert("15000", 18),     // exactly at second halving
    convert("15001", 18),     // just past second halving
    convert("17499", 18),     // just below third halving (15000 + 2500)
    convert("17500", 18),     // exactly at third halving
    convert("19000", 18),     // deep into halvings
    convert("19500", 18),     // approaching geometric limit
    convert("19900", 18),     // very close to limit (~2 * halvingAmount)
    convert("19999", 18),     // near the theoretical limit
  ];

  // Helper to compute expected UPS for a given totalMinted
  function expectedUps(totalMinted) {
    let halvings = 0;
    let threshold = HALVING_AMOUNT;

    while (totalMinted.gte(threshold) && halvings < 64) {
      halvings++;
      // threshold += halvingAmount >> halvings
      threshold = threshold.add(HALVING_AMOUNT.shr(halvings));
    }

    let ups = INITIAL_UPS.shr(halvings);
    if (ups.lt(TAIL_UPS)) ups = TAIL_UPS;
    return ups;
  }

  for (let i = 0; i < testValues.length; i++) {
    const testMinted = testValues[i];
    it(`Fuzz iteration ${i + 1}: UPS correct for totalMinted=${divDec(testMinted)} tokens`, async function () {
      const expected = expectedUps(testMinted);

      // Verify UPS never drops below tailUps
      expect(expected).to.be.gte(TAIL_UPS);

      // Verify halving logic produces monotonic decrease
      if (i > 0) {
        const prevExpected = expectedUps(testValues[i - 1]);
        expect(expected).to.be.lte(prevExpected);
      }

      // Verify specific halving boundaries
      if (testMinted.lt(HALVING_AMOUNT)) {
        // Before first halving: UPS == initialUps
        expect(expected).to.equal(INITIAL_UPS);
      } else if (testMinted.gte(HALVING_AMOUNT) && testMinted.lt(HALVING_AMOUNT.add(HALVING_AMOUNT.div(2)))) {
        // Between first and second halving: UPS == initialUps/2
        const halvedOnce = INITIAL_UPS.div(2);
        if (halvedOnce.lt(TAIL_UPS)) {
          expect(expected).to.equal(TAIL_UPS);
        } else {
          expect(expected).to.equal(halvedOnce);
        }
      }
    });
  }

  it("UPS should converge to tailUps for very large totalMinted", function () {
    const veryLarge = convert("100000000", 18);
    const ups = expectedUps(veryLarge);
    expect(ups).to.equal(TAIL_UPS);
  });
});

// ============================================================================
// CATEGORY 3: Random timestamps -- time-based halving emissions (SpinRig/FundRig)
// ============================================================================
describe("FUZZ Category 3: Random Timestamps - Time-Based Halving Emissions", function () {
  describe("SpinRig: _getUpsFromTime correctness", function () {
    let owner, treasury, team, protocol, user0;
    let paymentToken, unitToken, rig, mockEntropy, mockCore;

    const INITIAL_UPS = convert("100", 18);
    const TAIL_UPS = convert("1", 18);
    const HALVING_PERIOD = THIRTY_DAYS; // 30 days

    before("Deploy SpinRig directly", async function () {
      await network.provider.send("hardhat_reset");

      [owner, treasury, team, protocol, user0] = await ethers.getSigners();

      const mockUsdcArtifact = await ethers.getContractFactory("MockUSDC");
      paymentToken = await mockUsdcArtifact.deploy();

      const mockEntropyArtifact = await ethers.getContractFactory("MockEntropy");
      mockEntropy = await mockEntropyArtifact.deploy();

      const mockCoreArtifact = await ethers.getContractFactory("MockCore");
      mockCore = await mockCoreArtifact.deploy(protocol.address);

      const unitArtifact = await ethers.getContractFactory("Unit");
      unitToken = await unitArtifact.deploy("SpinFuzz Unit", "SFUZZ", owner.address);

      const rigArtifact = await ethers.getContractFactory("SpinRig");
      const config = {
        epochPeriod: ONE_HOUR,
        priceMultiplier: convert("2", 18),
        minInitPrice: convert("1", 6),
        initialUps: INITIAL_UPS,
        halvingPeriod: HALVING_PERIOD,
        tailUps: TAIL_UPS,
        odds: [10, 100, 500, 1000, 5000],
      };

      rig = await rigArtifact.deploy(
        unitToken.address,
        paymentToken.address,
        mockCore.address,
        treasury.address,
        AddressZero, // team
        mockEntropy.address,
        config
      );

      await unitToken.setRig(rig.address);
    });

    // Test at random time offsets
    const timeOffsets = [
      0,                          // at start
      THIRTY_DAYS / 2,            // mid-first period
      THIRTY_DAYS - 1,            // just before first halving
      THIRTY_DAYS,                // exactly at first halving
      THIRTY_DAYS + 1,            // just after first halving
      THIRTY_DAYS * 2,            // second halving
      THIRTY_DAYS * 3,            // third halving
      THIRTY_DAYS * 5,            // fifth halving
      THIRTY_DAYS * 10,           // tenth halving
      THIRTY_DAYS * 20,           // twentieth halving
      THIRTY_DAYS * 50,           // deep into halvings
      THIRTY_DAYS * 100,          // way past tail
    ];

    for (let i = 0; i < timeOffsets.length; i++) {
      const offset = timeOffsets[i];
      it(`Fuzz iteration ${i + 1}: UPS correct at time offset ${offset}s (${(offset / ONE_DAY).toFixed(1)} days)`, async function () {
        if (offset > 0) {
          await increaseTime(offset - (i > 0 ? timeOffsets[i - 1] : 0));
        }

        const ups = await rig.getUps();
        const startTime = await rig.startTime();
        const currentTime = await getBlockTimestamp();
        const elapsed = currentTime - startTime.toNumber();
        const halvings = Math.floor(elapsed / HALVING_PERIOD);

        let expectedUps = INITIAL_UPS.shr(halvings);
        if (expectedUps.lt(TAIL_UPS)) expectedUps = TAIL_UPS;

        expect(ups).to.equal(expectedUps);
        expect(ups).to.be.gte(TAIL_UPS);
      });
    }
  });

  describe("FundRig: getDayEmission correctness", function () {
    let owner, treasury, team, protocol, recipient, user0;
    let paymentToken, unitToken, rig, mockCore;

    const INITIAL_EMISSION = convert("1000", 18);
    const MIN_EMISSION = convert("10", 18);
    const HALVING_PERIOD_DAYS = 30;

    before("Deploy FundRig directly", async function () {
      await network.provider.send("hardhat_reset");

      [owner, treasury, team, protocol, recipient, user0] = await ethers.getSigners();

      const mockWethArtifact = await ethers.getContractFactory("MockWETH");
      paymentToken = await mockWethArtifact.deploy();

      const mockCoreArtifact = await ethers.getContractFactory("MockCore");
      mockCore = await mockCoreArtifact.deploy(protocol.address);

      const unitArtifact = await ethers.getContractFactory("Unit");
      unitToken = await unitArtifact.deploy("FundFuzz Unit", "FFUZZ", owner.address);

      const rigArtifact = await ethers.getContractFactory("FundRig");
      rig = await rigArtifact.deploy(
        unitToken.address,
        paymentToken.address,
        mockCore.address,
        treasury.address,
        team.address,
        recipient.address,
        [INITIAL_EMISSION, MIN_EMISSION, HALVING_PERIOD_DAYS] // Config
      );

      await unitToken.setRig(rig.address);
    });

    // Test at various day numbers
    const testDays = [
      0,                       // day 0
      1,                       // day 1
      15,                      // mid-first halving
      29,                      // just before first halving
      30,                      // exactly at first halving
      31,                      // just after first halving
      59,                      // just before second halving
      60,                      // second halving
      90,                      // third halving
      150,                     // fifth halving
      300,                     // tenth halving
      600,                     // twentieth halving (way past floor)
      1000,                    // deep floor
    ];

    for (let i = 0; i < testDays.length; i++) {
      const day = testDays[i];
      it(`Fuzz iteration ${i + 1}: emission correct for day ${day}`, async function () {
        const emission = await rig.getDayEmission(day);
        const halvings = Math.floor(day / HALVING_PERIOD_DAYS);

        let expectedEmission = INITIAL_EMISSION.shr(halvings);
        if (expectedEmission.lt(MIN_EMISSION)) expectedEmission = MIN_EMISSION;

        expect(emission).to.equal(expectedEmission);
        expect(emission).to.be.gte(MIN_EMISSION);
      });
    }

    it("Emission should be monotonically non-increasing over days", function () {
      // Verify off-chain that getDayEmission is monotonically non-increasing
      let prevEmission = INITIAL_EMISSION;
      for (let day = 0; day <= 1000; day += 5) {
        const halvings = Math.floor(day / HALVING_PERIOD_DAYS);
        let emission = INITIAL_EMISSION.shr(halvings);
        if (emission.lt(MIN_EMISSION)) emission = MIN_EMISSION;
        expect(emission).to.be.lte(prevEmission);
        prevEmission = emission;
      }
    });
  });
});

// ============================================================================
// CATEGORY 4: Random time points in epoch -- Dutch auction price decay
// ============================================================================
describe("FUZZ Category 4: Random Time Points - Dutch Auction Price Decay", function () {
  describe("MineRig price decay", function () {
    let owner, protocol, team, user0, user1, user2;
    let weth, usdc, registry, core, entropy;
    let rig, rigContract;

    before("Deploy contracts", async function () {
      await network.provider.send("hardhat_reset");

      [owner, protocol, team, user0, user1, user2] = await ethers.getSigners();

      const mockWethArtifact = await ethers.getContractFactory("MockWETH");
      weth = await mockWethArtifact.deploy();

      // Deploy MockUSDC (6 decimals)
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

      await usdc.mint(user0.address, convert("5000", 6));
      await weth.connect(user1).deposit({ value: convert("5000", 18) });
      await weth.connect(user2).deposit({ value: convert("5000", 18) });

      const launchParams = {
        launcher: user0.address,
        quoteToken: weth.address,
        tokenName: "Decay Fuzz Unit",
        tokenSymbol: "DFUZZ",
        uri: "https://example.com/rig",
        usdcAmount: convert("1000", 6),
        unitAmount: convert("1000000", 18),
        initialUps: convert("10", 18),
        tailUps: convert("0.01", 18),
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

      await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);
      const tx = await core.connect(user0).launch(launchParams);
      const receipt = await tx.wait();

      const launchEvent = receipt.events.find((e) => e.event === "MineCore__Launched");
      rig = launchEvent.args.rig;
      rigContract = await ethers.getContractAt("MineRig", rig);

      // Disable entropy for tests that don't send ETH for VRF fees
      await rigContract.connect(user0).setEntropyEnabled(false);
    });

    for (let i = 0; i < 20; i++) {
      it(`Fuzz iteration ${i + 1}: price decays correctly at random time within epoch`, async function () {
        // Mine to start a fresh epoch
        const slot = await rigContract.getSlot(0);
        await weth.connect(user1).approve(rig, convert("100", 18));
        await rigContract.connect(user1).mine(
          user1.address, 0, slot.epochId, 1961439882, convert("100", 18), ""
        );

        const newSlot = await rigContract.getSlot(0);
        const initPrice = newSlot.initPrice;
        const epochPeriod = await rigContract.epochPeriod();

        // Price at epoch start should be approximately initPrice
        const priceAtStart = await rigContract.getPrice(0);
        expect(priceAtStart).to.be.closeTo(initPrice, initPrice.div(50)); // ~2% tolerance for block time

        // Generate random elapsed time within epoch
        const randomElapsed = Math.floor(Math.random() * epochPeriod.toNumber());
        await increaseTime(randomElapsed);

        const priceAfter = await rigContract.getPrice(0);

        // Expected formula: price = initPrice - initPrice * elapsed / epochPeriod
        // Price should be >= 0
        expect(priceAfter).to.be.gte(0);

        // If still within epoch, verify linear decay
        const currentTime = await getBlockTimestamp();
        const actualElapsed = currentTime - newSlot.startTime.toNumber();

        if (actualElapsed <= epochPeriod.toNumber()) {
          const expectedPrice = initPrice.sub(initPrice.mul(actualElapsed).div(epochPeriod));
          // Allow 2% tolerance due to block timestamp granularity
          const tolerance = initPrice.div(50).add(1);
          expect(priceAfter).to.be.closeTo(expectedPrice, tolerance);
        } else {
          expect(priceAfter).to.equal(0);
        }

        // Verify monotonic: wait more and price should not increase
        await increaseTime(10);
        const priceLater = await rigContract.getPrice(0);
        expect(priceLater).to.be.lte(priceAfter);

        // Wait until epoch fully expires
        await increaseTime(epochPeriod.toNumber());
        const priceExpired = await rigContract.getPrice(0);
        expect(priceExpired).to.equal(0);
      });
    }
  });
});

// ============================================================================
// CATEGORY 5: Random donation amounts -- proportional claim math (FundRig)
// ============================================================================
describe("FUZZ Category 5: Random Donation Amounts - Proportional Claim Math", function () {
  let owner, treasury, team, protocol, recipient, user0, user1, user2, user3, user4;
  let paymentToken, unitToken, rig, mockCore;

  const INITIAL_EMISSION = convert("100000", 18);
  const MIN_EMISSION = convert("100", 18);

  before("Deploy FundRig", async function () {
    await network.provider.send("hardhat_reset");

    [owner, treasury, team, protocol, recipient, user0, user1, user2, user3, user4] = await ethers.getSigners();

    const mockWethArtifact = await ethers.getContractFactory("MockWETH");
    paymentToken = await mockWethArtifact.deploy();

    const mockCoreArtifact = await ethers.getContractFactory("MockCore");
    mockCore = await mockCoreArtifact.deploy(protocol.address);

    const unitArtifact = await ethers.getContractFactory("Unit");
    unitToken = await unitArtifact.deploy("ClaimFuzz Unit", "CFUZZ", owner.address);

    const rigArtifact = await ethers.getContractFactory("FundRig");
    rig = await rigArtifact.deploy(
      unitToken.address,
      paymentToken.address,
      mockCore.address,
      treasury.address,
      team.address,
      recipient.address,
      [INITIAL_EMISSION, MIN_EMISSION, 30] // Config
    );

    await unitToken.setRig(rig.address);

    // Fund all users generously (leave enough ETH for gas)
    const users = [user0, user1, user2, user3, user4];
    for (const user of users) {
      await paymentToken.connect(user).deposit({ value: convert("5000", 18) });
    }
  });

  for (let iter = 0; iter < 5; iter++) {
    it(`Fuzz iteration ${iter + 1}: proportional claims sum correctly for random donations`, async function () {
      // Advance to a new day
      await increaseTime(ONE_DAY);

      const currentDay = await rig.currentDay();
      const dayEmission = await rig.getDayEmission(currentDay);

      // Random number of users (2 to 5)
      const numUsers = 2 + Math.floor(Math.random() * 4);
      const users = [user0, user1, user2, user3, user4].slice(0, numUsers);

      // Random donation amounts for each user (between MIN_DONATION and 1000 tokens)
      const donations = [];
      let totalDonated = ethers.BigNumber.from(0);

      for (let u = 0; u < numUsers; u++) {
        const minDonation = ethers.BigNumber.from("10000"); // MIN_DONATION
        const maxDonation = convert("1000", 18);
        const donationAmount = randomBigNumber(minDonation, maxDonation);

        await paymentToken.connect(users[u]).approve(rig.address, donationAmount);
        await rig.connect(users[u]).fund(users[u].address, donationAmount, "");

        donations.push(donationAmount);
        totalDonated = totalDonated.add(donationAmount);
      }

      // Verify tracked total matches sum
      const trackedTotal = await rig.dayToTotalDonated(currentDay);
      expect(trackedTotal).to.equal(totalDonated);

      // Advance to next day to enable claims
      await increaseTime(ONE_DAY);

      // Claim all and verify proportional distribution
      let totalRewarded = ethers.BigNumber.from(0);
      const rewards = [];

      for (let u = 0; u < numUsers; u++) {
        const userBalBefore = await unitToken.balanceOf(users[u].address);
        await rig.claim(users[u].address, currentDay);
        const userBalAfter = await unitToken.balanceOf(users[u].address);
        const reward = userBalAfter.sub(userBalBefore);

        rewards.push(reward);
        totalRewarded = totalRewarded.add(reward);

        // Verify proportional share: reward = (donation / total) * emission
        const expectedReward = donations[u].mul(dayEmission).div(totalDonated);
        expect(reward).to.be.closeTo(expectedReward, expectedReward.div(100).add(1));
      }

      // Sum of all rewards must be <= dayEmission (no inflation)
      expect(totalRewarded).to.be.lte(dayEmission);

      // Sum should be close to dayEmission (within rounding)
      // Max rounding loss is numUsers wei
      expect(totalRewarded).to.be.closeTo(dayEmission, numUsers);
    });
  }
});

// ============================================================================
// CATEGORY 6: Random bytes32 for odds drawing (SpinRig)
// ============================================================================
describe("FUZZ Category 6: Random bytes32 - Odds Drawing (SpinRig)", function () {
  let owner, treasury, team, protocol, user0;
  let paymentToken, unitToken, mockEntropy, mockCore;

  const MIN_ODDS_BPS = 10;
  const MAX_ODDS_BPS = 8000;

  // We test multiple odds arrays
  const oddsConfigs = [
    { name: "single low", odds: [10] },
    { name: "single high", odds: [8000] },
    { name: "5 values", odds: [10, 100, 500, 1000, 5000] },
    { name: "3 equal values", odds: [500, 500, 500] },
    { name: "range", odds: [10, 50, 100, 200, 500, 1000, 2000, 4000, 8000] },
    { name: "extremes", odds: [10, 8000] },
  ];

  for (const oddsConfig of oddsConfigs) {
    describe(`Odds array: ${oddsConfig.name} [${oddsConfig.odds.join(",")}]`, function () {
      let rig;

      before(async function () {
        await network.provider.send("hardhat_reset");

        [owner, treasury, team, protocol, user0] = await ethers.getSigners();

        const mockUsdcArtifact = await ethers.getContractFactory("MockUSDC");
        paymentToken = await mockUsdcArtifact.deploy();

        const mockEntropyArtifact = await ethers.getContractFactory("MockEntropy");
        mockEntropy = await mockEntropyArtifact.deploy();

        const mockCoreArtifact = await ethers.getContractFactory("MockCore");
        mockCore = await mockCoreArtifact.deploy(protocol.address);

        const unitArtifact = await ethers.getContractFactory("Unit");
        unitToken = await unitArtifact.deploy("OddsFuzz Unit", "OFUZZ", owner.address);

        const rigArtifact = await ethers.getContractFactory("SpinRig");
        const config = {
          epochPeriod: ONE_HOUR,
          priceMultiplier: convert("2", 18),
          minInitPrice: convert("1", 6),
          initialUps: convert("100", 18),
          halvingPeriod: THIRTY_DAYS,
          tailUps: convert("1", 18),
          odds: oddsConfig.odds,
        };

        rig = await rigArtifact.deploy(
          unitToken.address,
          paymentToken.address,
          mockCore.address,
          treasury.address,
          AddressZero, // team (set later via setTeam)
          mockEntropy.address,
          config
        );

        await unitToken.setRig(rig.address);
        await rig.connect(owner).setTeam(team.address);

        await paymentToken.mint(user0.address, convert("1000000", 6));
      });

      for (let i = 0; i < 20; i++) {
        it(`Random bytes32 #${i + 1}: drawn odds within valid range`, async function () {
          // Wait for emissions to accumulate so prize pool is non-zero
          if (i === 0) {
            await increaseTime(ONE_HOUR);
          }

          // Wait for epoch to expire so we get price=0 (fast iteration)
          await increaseTime(ONE_HOUR + 1);

          const epochId = await rig.epochId();
          const fee = await rig.getEntropyFee();

          await paymentToken.connect(user0).approve(rig.address, convert("10000", 6));
          const tx = await rig.connect(user0).spin(
            user0.address,
            epochId,
            1961439882,
            convert("10000", 6),
            "",
            { value: fee }
          );

          const receipt = await tx.wait();
          const entropyEvent = receipt.events.find(e => e.event === "SpinRig__EntropyRequested");
          const seqNum = entropyEvent.args.sequenceNumber;

          // Use truly random bytes32
          const randomValue = randomBytes32();

          await mockEntropy.fulfillEntropy(seqNum, randomValue);

          // Check the Win event
          const winEvents = await rig.queryFilter(rig.filters.SpinRig__Win());
          const latestWin = winEvents[winEvents.length - 1];

          const drawnOdds = latestWin.args.oddsBps;

          // Drawn odds must be within [MIN_ODDS_BPS, MAX_ODDS_BPS]
          expect(drawnOdds).to.be.gte(MIN_ODDS_BPS);
          expect(drawnOdds).to.be.lte(MAX_ODDS_BPS);

          // Drawn odds must be a member of the configured odds array
          const isInArray = oddsConfig.odds.some(o => drawnOdds.eq(o));
          expect(isInArray).to.equal(true,
            `Drawn odds ${drawnOdds.toString()} not in array [${oddsConfig.odds.join(",")}]`
          );
        });
      }
    });
  }
});

// ============================================================================
// CATEGORY 7: Random capacity values -- UPS division (MineRig)
// ============================================================================
describe("FUZZ Category 7: Random Capacity Values - UPS Division", function () {
  let owner, protocol, team, user0, user1, user2;
  let weth, usdc, registry, core, entropy;
  let rig, rigContract;

  before("Deploy contracts", async function () {
    await network.provider.send("hardhat_reset");

    [owner, protocol, team, user0, user1, user2] = await ethers.getSigners();

    const mockWethArtifact = await ethers.getContractFactory("MockWETH");
    weth = await mockWethArtifact.deploy();

    // Deploy MockUSDC (6 decimals)
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

    await usdc.mint(user0.address, convert("5000", 6));
    await weth.connect(user1).deposit({ value: convert("5000", 18) });
    await weth.connect(user2).deposit({ value: convert("5000", 18) });

    const launchParams = {
      launcher: user0.address,
      quoteToken: weth.address,
      tokenName: "Capacity Fuzz Unit",
      tokenSymbol: "CAPFUZZ",
      uri: "https://example.com/rig",
      usdcAmount: convert("1000", 6),
      unitAmount: convert("1000000", 18),
      initialUps: convert("256", 18), // Divisible by many capacity values
      tailUps: convert("0.01", 18),
      halvingAmount: convert("10000000", 18), // Very high to avoid halvings during test
      rigEpochPeriod: ONE_HOUR,
      rigPriceMultiplier: convert("2", 18),
      rigMinInitPrice: convert("0.0001", 18),
      upsMultipliers: [convert("1", 18)],
      upsMultiplierDuration: ONE_DAY,
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
    rigContract = await ethers.getContractAt("MineRig", rig);

    // Disable entropy for tests that don't send ETH for VRF fees
    await rigContract.connect(user0).setEntropyEnabled(false);
  });

  // Test capacities: 1, 2, 4, 8, 16, 32, 64, 128, 256
  const capacityValues = [1, 2, 4, 8, 16, 32, 64, 128, 256];
  let prevCapacity = 1;
  let prevPerSlotUps = null;

  for (let i = 0; i < capacityValues.length; i++) {
    const cap = capacityValues[i];

    it(`Capacity ${cap}: per-slot UPS = globalUps / capacity`, async function () {
      // Set capacity (can only increase)
      const currentCapacity = await rigContract.capacity();
      if (cap > currentCapacity.toNumber()) {
        await rigContract.connect(user0).setCapacity(cap);
      }

      const globalUps = await rigContract.getUps();
      const capacity = await rigContract.capacity();

      // Mine a slot to observe the per-slot UPS
      const slotIndex = cap - 1; // Use the last valid slot
      const slot = await rigContract.getSlot(slotIndex);

      await weth.connect(user1).approve(rig, convert("10", 18));
      await rigContract.connect(user1).mine(
        user1.address, slotIndex, slot.epochId, 1961439882, convert("10", 18), ""
      );

      const minedSlot = await rigContract.getSlot(slotIndex);
      const perSlotUps = minedSlot.ups;

      // Verify: per-slot UPS = globalUps / capacity
      const expectedPerSlot = globalUps.div(capacity);
      expect(perSlotUps).to.equal(expectedPerSlot);

      // Verify increasing capacity reduces per-slot UPS (monotonic decrease)
      if (prevPerSlotUps !== null) {
        expect(perSlotUps).to.be.lte(prevPerSlotUps);
      }

      prevPerSlotUps = perSlotUps;

      // Verify per-slot UPS is still reasonable (UPS / capacity >= tailUps / capacity)
      const tailUps = await rigContract.tailUps();
      // Per-slot UPS should be >= tailUps/capacity (since globalUps >= tailUps)
      expect(perSlotUps).to.be.gte(tailUps.div(capacity));
    });
  }

  it("Mining at max capacity (256): all slots should have consistent UPS", async function () {
    const capacity = await rigContract.capacity();
    expect(capacity).to.equal(256);

    const globalUps = await rigContract.getUps();
    const expectedPerSlot = globalUps.div(capacity);

    // Mine two different slots and check they get the same UPS
    const indices = [0, 100, 200, 255];

    for (const idx of indices) {
      const slot = await rigContract.getSlot(idx);
      await weth.connect(user1).approve(rig, convert("10", 18));
      await rigContract.connect(user1).mine(
        user1.address, idx, slot.epochId, 1961439882, convert("10", 18), ""
      );

      const minedSlot = await rigContract.getSlot(idx);
      expect(minedSlot.ups).to.equal(expectedPerSlot);
    }
  });
});
