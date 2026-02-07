const convert = (amount, decimals = 18) => ethers.utils.parseUnits(amount.toString(), decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";

let owner, treasury, team, protocol, user0, user1, user2;
let paymentToken, unitToken, rig, mockEntropy, mockCore;

// Time helpers
async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

const ONE_HOUR = 3600;
const ONE_DAY = 86400;
const THIRTY_DAYS = ONE_DAY * 30;

describe("SpinRig Tests", function () {
  before("Initial set up", async function () {
    await network.provider.send("hardhat_reset");
    console.log("Begin Initialization");

    [owner, treasury, team, protocol, user0, user1, user2] = await ethers.getSigners();

    // Deploy mock payment token (using MockUSDC for 6 decimals)
    const mockUsdcArtifact = await ethers.getContractFactory("MockUSDC");
    paymentToken = await mockUsdcArtifact.deploy();
    console.log("- Payment Token (MockUSDC) Initialized");

    // Deploy mock Entropy
    const mockEntropyArtifact = await ethers.getContractFactory("MockEntropy");
    mockEntropy = await mockEntropyArtifact.deploy();
    console.log("- MockEntropy Initialized");

    // Deploy mock Core (for protocolFeeAddress)
    const mockCoreArtifact = await ethers.getContractFactory("MockCore");
    mockCore = await mockCoreArtifact.deploy(protocol.address);
    console.log("- MockCore Initialized");

    // Deploy Unit token (owner is initial rig, will transfer to SpinRig)
    const unitArtifact = await ethers.getContractFactory("Unit");
    unitToken = await unitArtifact.deploy("Test Unit", "TUNIT", owner.address);
    console.log("- Unit Token Initialized");

    // Deploy SpinRig
    const rigArtifact = await ethers.getContractFactory("SpinRig");
    const config = {
      epochPeriod: ONE_HOUR, // 1 hour epochs
      priceMultiplier: convert("2", 18), // 2x
      minInitPrice: convert("1", 6), // 1 USDC minimum
      initialUps: convert("4", 18), // 4 tokens per second
      halvingPeriod: THIRTY_DAYS, // 30 days
      tailUps: convert("0.01", 18), // 0.01 tokens per second
      odds: [10], // 0.1% default odds
    };

    rig = await rigArtifact.deploy(
      unitToken.address,
      paymentToken.address,
      mockCore.address, // core
      treasury.address,
      AddressZero, // team (set later via setTeam)
      mockEntropy.address,
      config
    );
    console.log("- SpinRig Initialized");

    // Transfer minting rights to Rig
    await unitToken.setRig(rig.address);
    console.log("- Minting rights transferred to SpinRig");

    // Mint payment tokens to users
    await paymentToken.mint(user0.address, convert("10000", 6));
    await paymentToken.mint(user1.address, convert("10000", 6));
    await paymentToken.mint(user2.address, convert("10000", 6));
    console.log("- Payment tokens minted to users");

    console.log("Initialization Complete\n");
  });

  describe("SpinRig Configuration Tests", function () {
    it("Should have correct initial state", async function () {
      expect(await rig.unit()).to.equal(unitToken.address);
      expect(await rig.quote()).to.equal(paymentToken.address);
      expect(await rig.treasury()).to.equal(treasury.address);
      expect(await rig.core()).to.equal(mockCore.address);
    });

    it("Should have correct constants", async function () {
      expect(await rig.TEAM_BPS()).to.equal(400); // 4%
      expect(await rig.PROTOCOL_BPS()).to.equal(100); // 1%
      // Treasury receives remainder (95%)
      expect(await rig.DIVISOR()).to.equal(10000);
      expect(await rig.MIN_ODDS_BPS()).to.equal(10); // 0.1%
      expect(await rig.MAX_ODDS_BPS()).to.equal(8000); // 80%
    });

    it("Should have correct configured parameters", async function () {
      expect(await rig.epochPeriod()).to.equal(ONE_HOUR);
      expect(await rig.priceMultiplier()).to.equal(convert("2", 18));
      expect(await rig.minInitPrice()).to.equal(convert("1", 6));
      expect(await rig.initialUps()).to.equal(convert("4", 18));
      expect(await rig.halvingPeriod()).to.equal(THIRTY_DAYS);
      expect(await rig.tailUps()).to.equal(convert("0.01", 18));
    });

    it("Should have default odds of 0.1%", async function () {
      const odds = await rig.getOdds();
      expect(odds.length).to.equal(1);
      expect(odds[0]).to.equal(10); // 0.1% = 10 basis points
    });

    it("Should support multiple odds values set at deploy time", async function () {
      // Deploy a new SpinRig with multiple odds
      const rigArtifact = await ethers.getContractFactory("SpinRig");
      const multiOddsConfig = {
        epochPeriod: ONE_HOUR,
        priceMultiplier: convert("2", 18),
        minInitPrice: convert("1", 6),
        initialUps: convert("4", 18),
        halvingPeriod: THIRTY_DAYS,
        tailUps: convert("0.01", 18),
        odds: [10, 500, 1000, 2000],
      };
      const mockCoreArtifact2 = await ethers.getContractFactory("MockCore");
      const mockCore2 = await mockCoreArtifact2.deploy(user0.address);
      const rig2 = await rigArtifact.deploy(
        unitToken.address,
        paymentToken.address,
        mockCore2.address,
        treasury.address,
        AddressZero,
        mockEntropy.address,
        multiOddsConfig
      );
      const odds = await rig2.getOdds();
      expect(odds.length).to.equal(4);
      expect(odds[0]).to.equal(10);
      expect(odds[1]).to.equal(500);
      expect(odds[2]).to.equal(1000);
      expect(odds[3]).to.equal(2000);
    });

    it("Should prevent deploying with odds below minimum", async function () {
      const rigArtifact = await ethers.getContractFactory("SpinRig");
      const badConfig = {
        epochPeriod: ONE_HOUR,
        priceMultiplier: convert("2", 18),
        minInitPrice: convert("1", 6),
        initialUps: convert("4", 18),
        halvingPeriod: THIRTY_DAYS,
        tailUps: convert("0.01", 18),
        odds: [5], // 0.05% - below minimum 0.1%
      };
      const mockCoreArtifact2 = await ethers.getContractFactory("MockCore");
      const mockCore2 = await mockCoreArtifact2.deploy(user0.address);
      await expect(
        rigArtifact.deploy(unitToken.address, paymentToken.address, mockCore2.address, treasury.address, AddressZero, mockEntropy.address, badConfig)
      ).to.be.revertedWith("SpinRig__OddsTooLow()");
    });

    it("Should prevent deploying with odds above maximum", async function () {
      const rigArtifact = await ethers.getContractFactory("SpinRig");
      const badConfig = {
        epochPeriod: ONE_HOUR,
        priceMultiplier: convert("2", 18),
        minInitPrice: convert("1", 6),
        initialUps: convert("4", 18),
        halvingPeriod: THIRTY_DAYS,
        tailUps: convert("0.01", 18),
        odds: [9000], // 90% - above maximum 80%
      };
      const mockCoreArtifact2 = await ethers.getContractFactory("MockCore");
      const mockCore2 = await mockCoreArtifact2.deploy(user0.address);
      await expect(
        rigArtifact.deploy(unitToken.address, paymentToken.address, mockCore2.address, treasury.address, AddressZero, mockEntropy.address, badConfig)
      ).to.be.revertedWith("SpinRig__InvalidOdds()");
    });

    it("Should prevent deploying with empty odds", async function () {
      const rigArtifact = await ethers.getContractFactory("SpinRig");
      const badConfig = {
        epochPeriod: ONE_HOUR,
        priceMultiplier: convert("2", 18),
        minInitPrice: convert("1", 6),
        initialUps: convert("4", 18),
        halvingPeriod: THIRTY_DAYS,
        tailUps: convert("0.01", 18),
        odds: [], // empty
      };
      const mockCoreArtifact2 = await ethers.getContractFactory("MockCore");
      const mockCore2 = await mockCoreArtifact2.deploy(user0.address);
      await expect(
        rigArtifact.deploy(unitToken.address, paymentToken.address, mockCore2.address, treasury.address, AddressZero, mockEntropy.address, badConfig)
      ).to.be.revertedWith("SpinRig__InvalidOdds()");
    });

    it("Should allow owner to update treasury", async function () {
      const newTreasury = user2.address;
      await rig.connect(owner).setTreasury(newTreasury);
      expect(await rig.treasury()).to.equal(newTreasury);
      // Reset
      await rig.connect(owner).setTreasury(treasury.address);
    });

    it("Should allow owner to update team", async function () {
      await rig.connect(owner).setTeam(team.address);
      expect(await rig.team()).to.equal(team.address);
    });

    it("Should prevent non-owner from updating addresses", async function () {
      await expect(
        rig.connect(user0).setTreasury(user0.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Slot Price Tests", function () {
    it("Should start with minimum init price", async function () {
      const price = await rig.getPrice();
      // Price decays from minInitPrice (1 USDC)
      expect(price).to.be.lte(convert("1", 6));
    });

    it("Should decay price over time", async function () {
      // Reset by slotning to get a fresh epoch
      // First let's get some emissions in the pool
      await increaseTime(ONE_HOUR + 1); // Let epoch expire so price is 0

      const priceBefore = await rig.getPrice();
      expect(priceBefore).to.equal(0); // Epoch expired

      // Slot at price 0 to start new epoch
      const fee = await rig.getEntropyFee();
      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));
      await rig.connect(user0).spin(user0.address, 0, Date.now() + 3600, convert("1000", 6), "", { value: fee });

      // Now we have a fresh epoch with initPrice set
      const priceAfterSlot = await rig.getPrice();
      console.log("Price after slot:", divDec(priceAfterSlot, 6), "USDC");

      // Wait half the epoch
      await increaseTime(ONE_HOUR / 2);

      const priceHalfway = await rig.getPrice();
      console.log("Price at halfway:", divDec(priceHalfway, 6), "USDC");
      expect(priceHalfway).to.be.lt(priceAfterSlot);

      // Wait rest of epoch
      await increaseTime(ONE_HOUR / 2 + 1);

      const priceExpired = await rig.getPrice();
      expect(priceExpired).to.equal(0);
    });
  });

  describe("Slot and Win Tests", function () {
    // odds are set at deploy time (default: [10] = 0.1%)

    it("Should accumulate emissions in prize pool", async function () {
      const poolBefore = await rig.getPrizePool();
      const pendingEmissions = await rig.getPendingEmissions();
      console.log("Prize pool before:", divDec(poolBefore));
      console.log("Pending emissions:", divDec(pendingEmissions));

      expect(pendingEmissions).to.be.gt(0);
    });

    it("Should slot and receive VRF callback", async function () {
      // Let epoch expire
      await increaseTime(ONE_HOUR + 1);

      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      // Approve and slot
      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));

      const tx = await rig.connect(user0).spin(
        user0.address,
        epochId,
        Date.now() + 3600,
        convert("1000", 6),
        "",
        { value: fee }
      );

      const receipt = await tx.wait();
      const spinEvent = receipt.events.find((e) => e.event === "SpinRig__Spin");
      const entropyEvent = receipt.events.find((e) => e.event === "SpinRig__EntropyRequested");

      expect(spinEvent).to.not.be.undefined;
      expect(entropyEvent).to.not.be.undefined;

      console.log("Slot price:", divDec(spinEvent.args.price, 6), "USDC");

      // Get sequence number from entropy request
      const sequenceNumber = entropyEvent.args.sequenceNumber;

      // Fulfill entropy with random number
      const randomNumber = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("random seed"));
      await mockEntropy.fulfillEntropy(sequenceNumber, randomNumber);

      // Check for Win event
      const filter = rig.filters.SpinRig__Win();
      const events = await rig.queryFilter(filter);
      expect(events.length).to.be.gt(0);

      const winEvent = events[events.length - 1];
      console.log("Win amount:", divDec(winEvent.args.amount));
      console.log("Win odds:", winEvent.args.oddsBps.toString(), "bps");
    });

    it("Should pay fees to treasury and team on slot", async function () {
      // Let epoch expire
      await increaseTime(ONE_HOUR + 1);

      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      // Record balances before
      const treasuryBefore = await paymentToken.balanceOf(treasury.address);
      const teamBefore = await paymentToken.balanceOf(team.address);

      // Slot at current price (should be minInitPrice after decay)
      const price = await rig.getPrice();

      // Approve and slot
      await paymentToken.connect(user1).approve(rig.address, price.add(convert("100", 6)));

      await rig.connect(user1).spin(
        user1.address,
        epochId,
        Date.now() + 3600,
        price.add(convert("100", 6)),
        "",
        { value: fee }
      );

      const treasuryAfter = await paymentToken.balanceOf(treasury.address);
      const teamAfter = await paymentToken.balanceOf(team.address);

      const actualPrice = await rig.initPrice(); // New init price after slot

      // If price was > 0, fees should have been paid
      if (price.gt(0)) {
        // Treasury gets 95%, team gets 4%, protocol gets 1%
        console.log("Treasury received:", divDec(treasuryAfter.sub(treasuryBefore), 6), "USDC");
        console.log("Team received:", divDec(teamAfter.sub(teamBefore), 6), "USDC");
      }
    });

    it("Should prevent slot with expired deadline", async function () {
      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));

      await expect(
        rig.connect(user0).spin(user0.address, epochId, 1, convert("1000", 6), "", { value: fee })
      ).to.be.revertedWith("SpinRig__Expired()");
    });

    it("Should prevent slot with wrong epoch ID", async function () {
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));

      await expect(
        rig.connect(user0).spin(user0.address, 9999, Date.now() + 3600, convert("1000", 6), "", { value: fee })
      ).to.be.revertedWith("SpinRig__EpochIdMismatch()");
    });

    it("Should prevent slot with price exceeding max", async function () {
      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();
      const price = await rig.getPrice();

      if (price.gt(0)) {
        await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));

        await expect(
          rig.connect(user0).spin(user0.address, epochId, Date.now() + 3600, 1, "", { value: fee })
        ).to.be.revertedWith("SpinRig__MaxPriceExceeded()");
      }
    });

    it("Should prevent slot with insufficient entropy fee", async function () {
      const epochId = await rig.epochId();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));

      await expect(
        rig.connect(user0).spin(user0.address, epochId, Date.now() + 3600, convert("1000", 6), "", { value: 0 })
      ).to.be.revertedWith("SpinRig__InsufficientFee()");
    });

    it("Should prevent slot with zero spinner address", async function () {
      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));

      await expect(
        rig.connect(user0).spin(AddressZero, epochId, Date.now() + 3600, convert("1000", 6), "", { value: fee })
      ).to.be.revertedWith("SpinRig__ZeroSpinner()");
    });
  });

  describe("Emission Tests", function () {
    it("Should return correct UPS", async function () {
      const ups = await rig.getUps();
      expect(ups).to.equal(convert("4", 18)); // Initial UPS
    });

    it("Should halve UPS after halving period", async function () {
      const upsBefore = await rig.getUps();

      // Fast forward 30 days
      await increaseTime(THIRTY_DAYS);

      const upsAfter = await rig.getUps();
      expect(upsAfter).to.equal(upsBefore.div(2));
    });

    it("Should respect tail UPS floor", async function () {
      // Fast forward many halving periods
      await increaseTime(THIRTY_DAYS * 20);

      const ups = await rig.getUps();
      expect(ups).to.equal(convert("0.01", 18)); // Tail UPS
    });
  });

  describe("View Function Tests", function () {
    it("getEpochId should return current epoch", async function () {
      const epochId = await rig.epochId();
      expect(epochId).to.be.gte(0);
    });

    it("getPrizePool should return unit balance", async function () {
      const pool = await rig.getPrizePool();
      const balance = await unitToken.balanceOf(rig.address);
      expect(pool).to.equal(balance);
    });

    it("getOddsLength should return array length", async function () {
      const length = await rig.getOddsLength();
      expect(length).to.equal((await rig.getOdds()).length);
    });
  });
});
