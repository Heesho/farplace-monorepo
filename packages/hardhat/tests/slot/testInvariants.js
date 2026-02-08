/**
 * @title SpinRig Invariant and Business Logic Tests
 * @notice Comprehensive tests verifying slot machine mechanics and intended behavior
 * @dev Tests focus on prize pool, emissions, odds, and VRF integration
 */

const convert = (amount, decimals = 18) => ethers.utils.parseUnits(amount.toString(), decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function getBlockTimestamp() {
  const block = await ethers.provider.getBlock("latest");
  return block.timestamp;
}

const ONE_HOUR = 3600;
const ONE_DAY = 86400;
const THIRTY_DAYS = ONE_DAY * 30;
const PRECISION = ethers.BigNumber.from("1000000000000000000");

describe("SpinRig Invariant Tests", function () {
  let owner, treasury, team, protocol, user0, user1, user2;
  let paymentToken, unitToken, rig, mockEntropy, mockCore;

  before("Deploy contracts", async function () {
    await network.provider.send("hardhat_reset");

    [owner, treasury, team, protocol, user0, user1, user2] = await ethers.getSigners();

    // Deploy mock USDC (6 decimals)
    const mockUsdcArtifact = await ethers.getContractFactory("MockUSDC");
    paymentToken = await mockUsdcArtifact.deploy();

    // Deploy mock Entropy
    const mockEntropyArtifact = await ethers.getContractFactory("MockEntropy");
    mockEntropy = await mockEntropyArtifact.deploy();

    // Deploy mock Core (for protocolFeeAddress)
    const mockCoreArtifact = await ethers.getContractFactory("MockCore");
    mockCore = await mockCoreArtifact.deploy(protocol.address);

    // Deploy Unit token (owner is initial rig, will transfer to SpinRig)
    const unitArtifact = await ethers.getContractFactory("Unit");
    unitToken = await unitArtifact.deploy("Slot Test Unit", "STUNIT", owner.address);

    // Deploy SpinRig with testable parameters
    const rigArtifact = await ethers.getContractFactory("SpinRig");
    const config = {
      epochPeriod: ONE_HOUR,
      priceMultiplier: convert("2", 18),
      minInitPrice: convert("1", 6), // 1 USDC
      initialUps: convert("100", 18), // High for testing
      halvingPeriod: THIRTY_DAYS,
      tailUps: convert("1", 18),
      odds: [10],
    };

    rig = await rigArtifact.deploy(
      unitToken.address,
      paymentToken.address,
      mockCore.address,
      treasury.address,
      AddressZero, // team (set later via setTeam)
      mockEntropy.address,
      config,
      ""
    );

    // Grant minting rights
    await unitToken.setRig(rig.address);

    // Set team
    await rig.connect(owner).setTeam(team.address);

    // Fund users with USDC
    await paymentToken.mint(user0.address, convert("100000", 6));
    await paymentToken.mint(user1.address, convert("100000", 6));
    await paymentToken.mint(user2.address, convert("100000", 6));
  });

  /**
   * INVARIANT 1: Prize pool equals contract's Unit balance
   * getPrizePool() == unitToken.balanceOf(rig)
   */
  describe("INVARIANT: Prize Pool Equals Unit Balance", function () {
    it("Prize pool should always equal contract's Unit balance", async function () {
      const prizePool = await rig.getPrizePool();
      const actualBalance = await unitToken.balanceOf(rig.address);

      expect(prizePool).to.equal(actualBalance);
    });

    it("Prize pool should increase after emissions are minted", async function () {
      const poolBefore = await rig.getPrizePool();

      // Wait for emissions to accumulate
      await increaseTime(ONE_HOUR);

      // Slot to trigger emission minting
      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));
      await rig.connect(user0).spin(
        user0.address,
        epochId,
        1961439882,
        convert("1000", 6),
        "",
        { value: fee }
      );

      const poolAfter = await rig.getPrizePool();
      expect(poolAfter).to.be.gt(poolBefore);

      // Verify balance matches
      const balance = await unitToken.balanceOf(rig.address);
      expect(poolAfter).to.equal(balance);
    });
  });

  /**
   * INVARIANT 2: Price decay formula is correct
   * price = initPrice - (initPrice * timePassed / epochPeriod)
   */
  describe("INVARIANT: Price Decay Formula", function () {
    beforeEach(async function () {
      // Slot to start fresh epoch
      await increaseTime(ONE_HOUR + 1);
      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));
      await rig.connect(user0).spin(
        user0.address,
        epochId,
        1961439882,
        convert("1000", 6),
        "",
        { value: fee }
      );
    });

    it("Price should equal initPrice at epoch start", async function () {
      const initPrice = await rig.initPrice();
      const price = await rig.getPrice();

      // Allow small tolerance for block time
      const tolerance = initPrice.div(100);
      expect(price).to.be.closeTo(initPrice, tolerance);
    });

    it("Price should be ~50% at epoch midpoint", async function () {
      const initPrice = await rig.initPrice();
      const epochPeriod = await rig.epochPeriod();

      await increaseTime(epochPeriod.toNumber() / 2);

      const price = await rig.getPrice();
      const expected = initPrice.div(2);
      const tolerance = expected.div(5); // 20% tolerance

      expect(price).to.be.closeTo(expected, tolerance);
    });

    it("Price should be 0 after epoch expires", async function () {
      const epochPeriod = await rig.epochPeriod();
      await increaseTime(epochPeriod.toNumber() + 1);

      const price = await rig.getPrice();
      expect(price).to.equal(0);
    });

    it("Price should never be negative", async function () {
      // Test at various extreme time points
      for (let i = 0; i < 5; i++) {
        const price = await rig.getPrice();
        expect(price).to.be.gte(0);
        await increaseTime(ONE_DAY);
      }
    });
  });

  /**
   * INVARIANT 3: Fee distribution is correct (95% treasury, 4% team, 1% protocol)
   */
  describe("INVARIANT: Fee Distribution", function () {
    it("Fees should sum to price paid", async function () {
      // Start fresh epoch with known price
      await increaseTime(ONE_HOUR + 1);
      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user1).approve(rig.address, convert("1000", 6));
      await rig.connect(user1).spin(
        user1.address,
        epochId,
        1961439882,
        convert("1000", 6),
        "",
        { value: fee }
      );

      // Now get the actual price for next slot
      const price = await rig.getPrice();

      if (price.eq(0)) {
        this.skip();
      }

      const treasuryBefore = await paymentToken.balanceOf(treasury.address);
      const teamBefore = await paymentToken.balanceOf(team.address);
      const protocolBefore = await paymentToken.balanceOf(protocol.address);

      const newEpochId = await rig.epochId();
      await paymentToken.connect(user2).approve(rig.address, price.add(convert("1000", 6)));
      const tx = await rig.connect(user2).spin(
        user2.address,
        newEpochId,
        1961439882,
        price.add(convert("1000", 6)),
        "",
        { value: fee }
      );

      // Get actual price from event
      const receipt = await tx.wait();
      const spinEvent = receipt.events.find(e => e.event === "SpinRig__Spin");
      const actualPrice = spinEvent.args.price;

      const treasuryAfter = await paymentToken.balanceOf(treasury.address);
      const teamAfter = await paymentToken.balanceOf(team.address);
      const protocolAfter = await paymentToken.balanceOf(protocol.address);

      const treasuryReceived = treasuryAfter.sub(treasuryBefore);
      const teamReceived = teamAfter.sub(teamBefore);
      const protocolReceived = protocolAfter.sub(protocolBefore);
      const totalFees = treasuryReceived.add(teamReceived).add(protocolReceived);

      expect(totalFees).to.be.closeTo(actualPrice, 1);
    });

    it("Treasury should receive 95%, team 4%, protocol 1%", async function () {
      // Get a fresh slot with known price
      await increaseTime(ONE_HOUR + 1);
      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));
      await rig.connect(user0).spin(
        user0.address,
        epochId,
        1961439882,
        convert("1000", 6),
        "",
        { value: fee }
      );

      const price = await rig.getPrice();

      if (price.lt(convert("1", 6))) {
        this.skip();
      }

      const treasuryBefore = await paymentToken.balanceOf(treasury.address);
      const teamBefore = await paymentToken.balanceOf(team.address);
      const protocolBefore = await paymentToken.balanceOf(protocol.address);

      const newEpochId = await rig.epochId();
      await paymentToken.connect(user1).approve(rig.address, price);
      await rig.connect(user1).spin(
        user1.address,
        newEpochId,
        1961439882,
        price,
        "",
        { value: fee }
      );

      const treasuryReceived = (await paymentToken.balanceOf(treasury.address)).sub(treasuryBefore);
      const teamReceived = (await paymentToken.balanceOf(team.address)).sub(teamBefore);
      const protocolReceived = (await paymentToken.balanceOf(protocol.address)).sub(protocolBefore);

      const treasuryPct = treasuryReceived.mul(100).div(price).toNumber();
      const teamPct = teamReceived.mul(100).div(price).toNumber();
      const protocolPct = protocolReceived.mul(100).div(price).toNumber();

      expect(treasuryPct).to.be.closeTo(95, 1);
      expect(teamPct).to.be.closeTo(4, 1);
      expect(protocolPct).to.be.closeTo(1, 1);
    });
  });

  /**
   * INVARIANT 4: Emission rate halves correctly over time
   */
  describe("INVARIANT: Emission Halving", function () {
    it("UPS should halve after halving period", async function () {
      const initialUps = await rig.initialUps();
      const startTime = await rig.startTime();
      const currentTime = await getBlockTimestamp();
      const halvingPeriod = await rig.halvingPeriod();

      const elapsed = currentTime - startTime.toNumber();
      const halvings = Math.floor(elapsed / halvingPeriod.toNumber());

      const ups = await rig.getUps();

      if (halvings > 0) {
        const expectedUps = initialUps.div(ethers.BigNumber.from(2).pow(halvings));
        const tailUps = await rig.tailUps();

        if (expectedUps.lt(tailUps)) {
          expect(ups).to.equal(tailUps);
        } else {
          expect(ups).to.equal(expectedUps);
        }
      } else {
        expect(ups).to.equal(initialUps);
      }
    });

    it("UPS should never go below tailUps", async function () {
      // Fast forward many halving periods
      await increaseTime(THIRTY_DAYS * 50);

      const ups = await rig.getUps();
      const tailUps = await rig.tailUps();

      expect(ups).to.be.gte(tailUps);
    });
  });

  /**
   * INVARIANT 5: Odds validation
   */
  describe("INVARIANT: Odds Constraints", function () {
    it("All odds should be >= MIN_ODDS_BPS (0.1%)", async function () {
      const odds = await rig.getOdds();
      const minOdds = await rig.MIN_ODDS_BPS();

      for (let i = 0; i < odds.length; i++) {
        expect(odds[i]).to.be.gte(minOdds);
      }
    });

    it("All odds should be <= MAX_ODDS_BPS (80%)", async function () {
      const odds = await rig.getOdds();
      const maxOdds = await rig.MAX_ODDS_BPS();

      for (let i = 0; i < odds.length; i++) {
        expect(odds[i]).to.be.lte(maxOdds);
      }
    });

    it("Should reject odds below minimum at deploy time", async function () {
      const rigArtifact = await ethers.getContractFactory("SpinRig");
      const badConfig = {
        epochPeriod: ONE_HOUR,
        priceMultiplier: convert("2", 18),
        minInitPrice: convert("1", 6),
        initialUps: convert("100", 18),
        halvingPeriod: THIRTY_DAYS,
        tailUps: convert("1", 18),
        odds: [5],
      };
      const mockCoreArtifact2 = await ethers.getContractFactory("MockCore");
      const mockCore2 = await mockCoreArtifact2.deploy(protocol.address);
      await expect(
        rigArtifact.deploy(unitToken.address, paymentToken.address, mockCore2.address, treasury.address, AddressZero, mockEntropy.address, badConfig, "")
      ).to.be.revertedWith("SpinRig__OddsTooLow()");
    });

    it("Should reject odds above maximum at deploy time", async function () {
      const rigArtifact = await ethers.getContractFactory("SpinRig");
      const badConfig = {
        epochPeriod: ONE_HOUR,
        priceMultiplier: convert("2", 18),
        minInitPrice: convert("1", 6),
        initialUps: convert("100", 18),
        halvingPeriod: THIRTY_DAYS,
        tailUps: convert("1", 18),
        odds: [9000],
      };
      const mockCoreArtifact2 = await ethers.getContractFactory("MockCore");
      const mockCore2 = await mockCoreArtifact2.deploy(protocol.address);
      await expect(
        rigArtifact.deploy(unitToken.address, paymentToken.address, mockCore2.address, treasury.address, AddressZero, mockEntropy.address, badConfig, "")
      ).to.be.revertedWith("SpinRig__InvalidOdds()");
    });

    it("Should reject empty odds array at deploy time", async function () {
      const rigArtifact = await ethers.getContractFactory("SpinRig");
      const badConfig = {
        epochPeriod: ONE_HOUR,
        priceMultiplier: convert("2", 18),
        minInitPrice: convert("1", 6),
        initialUps: convert("100", 18),
        halvingPeriod: THIRTY_DAYS,
        tailUps: convert("1", 18),
        odds: [],
      };
      const mockCoreArtifact2 = await ethers.getContractFactory("MockCore");
      const mockCore2 = await mockCoreArtifact2.deploy(protocol.address);
      await expect(
        rigArtifact.deploy(unitToken.address, paymentToken.address, mockCore2.address, treasury.address, AddressZero, mockEntropy.address, badConfig, "")
      ).to.be.revertedWith("SpinRig__InvalidOdds()");
    });
  });

  /**
   * INVARIANT 6: Epoch ID increments on each slot
   */
  describe("INVARIANT: Epoch ID Increments", function () {
    it("Epoch ID should increment by 1 after each slot", async function () {
      const epochIdBefore = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));
      await rig.connect(user0).spin(
        user0.address,
        epochIdBefore,
        1961439882,
        convert("1000", 6),
        "",
        { value: fee }
      );

      const epochIdAfter = await rig.epochId();
      expect(epochIdAfter).to.equal(epochIdBefore.add(1));
    });
  });
});

describe("SpinRig Business Logic Tests", function () {
  let owner, treasury, team, protocol, user0, user1, user2;
  let paymentToken, unitToken, rig, mockEntropy, mockCore;

  before("Deploy contracts", async function () {
    await network.provider.send("hardhat_reset");

    [owner, treasury, team, protocol, user0, user1, user2] = await ethers.getSigners();

    const mockUsdcArtifact = await ethers.getContractFactory("MockUSDC");
    paymentToken = await mockUsdcArtifact.deploy();

    const mockEntropyArtifact = await ethers.getContractFactory("MockEntropy");
    mockEntropy = await mockEntropyArtifact.deploy();

    // Deploy mock Core (for protocolFeeAddress)
    const mockCoreArtifact = await ethers.getContractFactory("MockCore");
    mockCore = await mockCoreArtifact.deploy(protocol.address);

    const unitArtifact = await ethers.getContractFactory("Unit");
    unitToken = await unitArtifact.deploy("Business Logic Unit", "BLUNIT", owner.address);

    const rigArtifact = await ethers.getContractFactory("SpinRig");
    const config = {
      epochPeriod: ONE_HOUR,
      priceMultiplier: convert("2", 18),
      minInitPrice: convert("1", 6),
      initialUps: convert("100", 18),
      halvingPeriod: THIRTY_DAYS,
      tailUps: convert("1", 18),
      odds: [5000], // 50% payout
    };

    rig = await rigArtifact.deploy(
      unitToken.address,
      paymentToken.address,
      mockCore.address,
      treasury.address,
      AddressZero, // team (set later via setTeam)
      mockEntropy.address,
      config,
      ""
    );

    await unitToken.setRig(rig.address);
    await rig.connect(owner).setTeam(team.address);

    await paymentToken.mint(user0.address, convert("100000", 6));
    await paymentToken.mint(user1.address, convert("100000", 6));
    await paymentToken.mint(user2.address, convert("100000", 6));
  });

  describe("Slot and Win Flow", function () {
    it("Should complete full slot-callback-win flow", async function () {
      // Wait for emissions to accumulate
      await increaseTime(ONE_HOUR);

      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();
      const poolBefore = await rig.getPrizePool();

      console.log("Prize pool before:", divDec(poolBefore));

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));
      const tx = await rig.connect(user0).spin(
        user0.address,
        epochId,
        1961439882,
        convert("1000", 6),
        "",
        { value: fee }
      );

      const receipt = await tx.wait();
      const entropyEvent = receipt.events.find(e => e.event === "SpinRig__EntropyRequested");
      expect(entropyEvent).to.not.be.undefined;

      const sequenceNumber = entropyEvent.args.sequenceNumber;

      // Get user balance before callback
      const userBalBefore = await unitToken.balanceOf(user0.address);

      // Fulfill entropy
      const randomNumber = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test"));
      await mockEntropy.fulfillEntropy(sequenceNumber, randomNumber);

      // Check win event
      const winEvents = await rig.queryFilter(rig.filters.SpinRig__Win());
      expect(winEvents.length).to.be.gt(0);

      const latestWin = winEvents[winEvents.length - 1];
      console.log("Win amount:", divDec(latestWin.args.amount));
      console.log("Win odds:", latestWin.args.oddsBps.toString(), "bps");

      // User should have received tokens
      const userBalAfter = await unitToken.balanceOf(user0.address);
      expect(userBalAfter).to.be.gt(userBalBefore);
    });

    it("Win amount should equal pool * oddsBps / DIVISOR", async function () {
      // Accumulate emissions
      await increaseTime(ONE_HOUR * 2);

      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user1).approve(rig.address, convert("1000", 6));
      const tx = await rig.connect(user1).spin(
        user1.address,
        epochId,
        1961439882,
        convert("1000", 6),
        "",
        { value: fee }
      );

      const receipt = await tx.wait();
      const entropyEvent = receipt.events.find(e => e.event === "SpinRig__EntropyRequested");
      const sequenceNumber = entropyEvent.args.sequenceNumber;

      // Note the pool at callback time
      const poolAtCallback = await rig.getPrizePool();

      // Fulfill entropy
      const randomNumber = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test2"));
      await mockEntropy.fulfillEntropy(sequenceNumber, randomNumber);

      // Get win event
      const winEvents = await rig.queryFilter(rig.filters.SpinRig__Win());
      const latestWin = winEvents[winEvents.length - 1];

      const odds = latestWin.args.oddsBps;
      const winAmount = latestWin.args.amount;

      // Verify: winAmount = pool * odds / 10000
      // Note: pool might have changed slightly, so allow some tolerance
      const expectedWin = poolAtCallback.mul(odds).div(10000);
      expect(winAmount).to.be.closeTo(expectedWin, expectedWin.div(10).add(1));
    });
  });

  describe("Slippage Protection", function () {
    it("Should revert with expired deadline", async function () {
      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));

      await expect(
        rig.connect(user0).spin(user0.address, epochId, 1, convert("1000", 6), "", { value: fee })
      ).to.be.revertedWith("SpinRig__DeadlinePassed()");
    });

    it("Should revert with wrong epoch ID", async function () {
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));

      await expect(
        rig.connect(user0).spin(
          user0.address,
          99999,
          1961439882,
          convert("1000", 6),
          "",
          { value: fee }
        )
      ).to.be.revertedWith("SpinRig__EpochIdMismatch()");
    });

    it("Should revert if price exceeds maxPrice", async function () {
      // Slot to reset epoch with high price
      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));
      await rig.connect(user0).spin(
        user0.address,
        epochId,
        1961439882,
        convert("1000", 6),
        "",
        { value: fee }
      );

      // Now try to slot with maxPrice = 0
      const newEpochId = await rig.epochId();
      const price = await rig.getPrice();

      if (price.gt(0)) {
        await paymentToken.connect(user1).approve(rig.address, convert("1000", 6));

        await expect(
          rig.connect(user1).spin(
            user1.address,
            newEpochId,
            1961439882,
            0, // maxPrice = 0
            "",
            { value: fee }
          )
        ).to.be.revertedWith("SpinRig__MaxPriceExceeded()");
      }
    });

    it("Should revert with insufficient entropy fee", async function () {
      const epochId = await rig.epochId();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));

      await expect(
        rig.connect(user0).spin(
          user0.address,
          epochId,
          1961439882,
          convert("1000", 6),
          "",
          { value: 0 }
        )
      ).to.be.revertedWith("SpinRig__InsufficientFee()");
    });

    it("Should revert with zero spinner address", async function () {
      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));

      await expect(
        rig.connect(user0).spin(
          AddressZero,
          epochId,
          1961439882,
          convert("1000", 6),
          "",
          { value: fee }
        )
      ).to.be.revertedWith("SpinRig__ZeroAddress()");
    });
  });

  describe("Access Control", function () {
    it("Only owner can set treasury", async function () {
      await expect(
        rig.connect(user0).setTreasury(user0.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Only owner can set team", async function () {
      await expect(
        rig.connect(user0).setTeam(user0.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Emission Accumulation", function () {
    it("Pending emissions should increase over time", async function () {
      const pendingBefore = await rig.getPendingEmissions();

      await increaseTime(ONE_HOUR);

      const pendingAfter = await rig.getPendingEmissions();
      expect(pendingAfter).to.be.gt(pendingBefore);
    });

    it("Slotning should mint pending emissions to prize pool", async function () {
      await increaseTime(ONE_HOUR);

      const pendingBefore = await rig.getPendingEmissions();
      const poolBefore = await rig.getPrizePool();

      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));
      await rig.connect(user0).spin(
        user0.address,
        epochId,
        1961439882,
        convert("1000", 6),
        "",
        { value: fee }
      );

      const pendingAfter = await rig.getPendingEmissions();
      const poolAfter = await rig.getPrizePool();

      // Pending should reset to near 0
      expect(pendingAfter).to.be.lt(pendingBefore);

      // Pool should have increased by approximately pendingBefore
      const poolIncrease = poolAfter.sub(poolBefore);
      expect(poolIncrease).to.be.closeTo(pendingBefore, pendingBefore.div(10));
    });
  });

  describe("Price Multiplier", function () {
    it("New initPrice should be price * multiplier", async function () {
      // Slot to get fresh epoch
      await increaseTime(ONE_HOUR + 1);
      let epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));
      await rig.connect(user0).spin(
        user0.address,
        epochId,
        1961439882,
        convert("1000", 6),
        "",
        { value: fee }
      );

      // Get current price and slot again
      const price = await rig.getPrice();
      const priceMultiplier = await rig.priceMultiplier();

      if (price.eq(0)) {
        this.skip();
      }

      epochId = await rig.epochId();
      await paymentToken.connect(user1).approve(rig.address, price);
      await rig.connect(user1).spin(
        user1.address,
        epochId,
        1961439882,
        price,
        "",
        { value: fee }
      );

      const newInitPrice = await rig.initPrice();
      const expectedInitPrice = price.mul(priceMultiplier).div(PRECISION);

      expect(newInitPrice).to.be.closeTo(expectedInitPrice, expectedInitPrice.div(100).add(1));
    });

    it("New initPrice should never be below minInitPrice", async function () {
      // Wait for price to decay to 0
      await increaseTime(ONE_HOUR + 1);

      const price = await rig.getPrice();
      expect(price).to.equal(0);

      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();
      const minInitPrice = await rig.minInitPrice();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));
      await rig.connect(user0).spin(
        user0.address,
        epochId,
        1961439882,
        convert("1000", 6),
        "",
        { value: fee }
      );

      const newInitPrice = await rig.initPrice();
      expect(newInitPrice).to.equal(minInitPrice);
    });
  });
});
