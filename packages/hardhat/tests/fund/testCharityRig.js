const convert = (amount, decimals = 18) => ethers.utils.parseUnits(amount.toString(), decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";

let owner, recipient, treasury, team, protocol, user0, user1, user2;
let paymentToken, unitToken, rig, mockCore;

// Time helpers
async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

const ONE_DAY = 86400;
const THIRTY_DAYS = ONE_DAY * 30;
const INITIAL_EMISSION = ethers.utils.parseUnits("345600", 18);
const MIN_EMISSION = ethers.utils.parseUnits("864", 18);

describe("FundRig Tests", function () {
  before("Initial set up", async function () {
    await network.provider.send("hardhat_reset");
    console.log("Begin Initialization");

    [owner, recipient, treasury, team, protocol, user0, user1, user2] = await ethers.getSigners();

    // Deploy mock payment token (using MockUSDC.sol - 6 decimals)
    const mockUsdcArtifact = await ethers.getContractFactory("MockUSDC");
    paymentToken = await mockUsdcArtifact.deploy();
    console.log("- Payment Token (MockUSDC) Initialized");

    // Deploy mock Core (for protocolFeeAddress)
    const mockCoreArtifact = await ethers.getContractFactory("MockCore");
    mockCore = await mockCoreArtifact.deploy(protocol.address);
    console.log("- MockCore Initialized");

    // Deploy Unit token (owner is initial rig, will transfer to FundRig)
    const unitArtifact = await ethers.getContractFactory("Unit");
    unitToken = await unitArtifact.deploy("Test Unit", "TUNIT", owner.address);
    console.log("- Unit Token Initialized");

    // Deploy FundRig (recipient is now required in constructor)
    const rigArtifact = await ethers.getContractFactory("FundRig");
    rig = await rigArtifact.deploy(
      unitToken.address,
      paymentToken.address,
      mockCore.address, // core
      treasury.address,
      team.address,
      recipient.address, // recipient (required)
      [INITIAL_EMISSION, MIN_EMISSION, 30, ONE_DAY], // Config: {initialEmission, minEmission, halvingPeriod}
      "" // uri
    );
    console.log("- FundRig Initialized (with recipient)");

    // Transfer minting rights to Rig
    await unitToken.setRig(rig.address);
    console.log("- Minting rights transferred to FundRig");

    // Mint payment tokens to users
    await paymentToken.mint(user0.address, convert("5000", 6));
    await paymentToken.mint(user1.address, convert("5000", 6));
    await paymentToken.mint(user2.address, convert("5000", 6));
    console.log("- Payment tokens minted to users");

    console.log("Initialization Complete\n");
  });

  describe("Unit Token Tests", function () {
    it("Should have FundRig as rig", async function () {
      expect(await unitToken.rig()).to.equal(rig.address);
    });

    it("Should prevent non-rig from minting", async function () {
      await expect(
        unitToken.connect(user0).mint(user0.address, convert("100"))
      ).to.be.reverted;
    });

    it("Should prevent non-rig from changing rig", async function () {
      await expect(
        unitToken.connect(user0).setRig(user0.address)
      ).to.be.reverted;
    });

    it("Should have rigLocked set to true after setRig", async function () {
      expect(await unitToken.rigLocked()).to.equal(true);
    });

    it("Should prevent setRig when rigLocked is true", async function () {
      // Even if somehow rig contract could call setRig, it should be locked
      // We test by deploying a fresh Unit and calling setRig twice
      const unitArtifact = await ethers.getContractFactory("Unit");
      const freshUnit = await unitArtifact.deploy("Fresh Unit", "FRESH", owner.address);

      // First setRig should succeed
      await freshUnit.connect(owner).setRig(user0.address);
      expect(await freshUnit.rig()).to.equal(user0.address);
      expect(await freshUnit.rigLocked()).to.equal(true);

      // Second setRig should fail even from the new rig
      await expect(
        freshUnit.connect(user0).setRig(user1.address)
      ).to.be.revertedWith("Unit__RigLocked()");
    });

    it("Should allow minting before rigLocked", async function () {
      const unitArtifact = await ethers.getContractFactory("Unit");
      const freshUnit = await unitArtifact.deploy("Fresh Unit", "FRESH", owner.address);

      // rigLocked should be false initially
      expect(await freshUnit.rigLocked()).to.equal(false);

      // Initial rig (owner) can mint
      await freshUnit.connect(owner).mint(user0.address, convert("100"));
      expect(await freshUnit.balanceOf(user0.address)).to.equal(convert("100"));
    });

    it("Should allow minting after rigLocked", async function () {
      const unitArtifact = await ethers.getContractFactory("Unit");
      const freshUnit = await unitArtifact.deploy("Fresh Unit", "FRESH", owner.address);

      // Transfer rig to user0 and lock
      await freshUnit.connect(owner).setRig(user0.address);
      expect(await freshUnit.rigLocked()).to.equal(true);

      // New rig (user0) can still mint
      await freshUnit.connect(user0).mint(user1.address, convert("200"));
      expect(await freshUnit.balanceOf(user1.address)).to.equal(convert("200"));
    });
  });

  describe("FundRig Configuration Tests", function () {
    it("Should have correct initial state", async function () {
      expect(await rig.quote()).to.equal(paymentToken.address);
      expect(await rig.unit()).to.equal(unitToken.address);
      expect(await rig.treasury()).to.equal(treasury.address);
      expect(await rig.team()).to.equal(team.address);
      expect(await rig.core()).to.equal(mockCore.address);
    });

    it("Should have correct constants", async function () {
      expect(await rig.initialEmission()).to.equal(INITIAL_EMISSION);
      expect(await rig.minEmission()).to.equal(MIN_EMISSION);
      expect(await rig.halvingPeriod()).to.equal(30); // 30 days
      expect(await rig.RECIPIENT_BPS()).to.equal(5000); // 50%
      expect(await rig.TEAM_BPS()).to.equal(400); // 4%
      expect(await rig.PROTOCOL_BPS()).to.equal(100); // 1%
      // Treasury receives remainder (45%)
      expect(await rig.DIVISOR()).to.equal(10000);
    });

    it("Should have recipient set", async function () {
      expect(await rig.recipient()).to.equal(recipient.address);
    });

    it("Should allow owner to change recipient", async function () {
      const newRecipient = user2.address;
      await rig.connect(owner).setRecipient(newRecipient);
      expect(await rig.recipient()).to.equal(newRecipient);
      // Reset for other tests
      await rig.connect(owner).setRecipient(recipient.address);
      expect(await rig.recipient()).to.equal(recipient.address);
    });

    it("Should allow owner to update treasury address", async function () {
      const newTreasury = user2.address;
      await rig.connect(owner).setTreasury(newTreasury);
      expect(await rig.treasury()).to.equal(newTreasury);
      // Reset for other tests
      await rig.connect(owner).setTreasury(treasury.address);
    });

    it("Should allow owner to update team address", async function () {
      const newTeam = user2.address;
      await rig.connect(owner).setTeam(newTeam);
      expect(await rig.team()).to.equal(newTeam);
      // Reset for other tests
      await rig.connect(owner).setTeam(team.address);
    });

    it("Should prevent non-owner from updating addresses", async function () {
      await expect(
        rig.connect(user0).setTreasury(user0.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should prevent non-owner from setting recipient", async function () {
      await expect(
        rig.connect(user0).setRecipient(user0.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should prevent setting zero address for treasury", async function () {
      await expect(
        rig.connect(owner).setTreasury(AddressZero)
      ).to.be.revertedWith("FundRig__ZeroAddress()");
    });

    it("Should allow setting team address to zero", async function () {
      await rig.connect(owner).setTeam(AddressZero);
      expect(await rig.team()).to.equal(AddressZero);
      // Reset for other tests
      await rig.connect(owner).setTeam(team.address);
    });

    it("Should prevent setting zero address as recipient", async function () {
      await expect(
        rig.connect(owner).setRecipient(AddressZero)
      ).to.be.revertedWith("FundRig__ZeroAddress()");
    });
  });

  describe("Donation Tests", function () {
    it("Should revert donation without approval", async function () {
      console.log("\n*** Allowance Check ***");
      // Clear any leftover approval from previous tests
      await paymentToken.connect(user0).approve(rig.address, 0);
      await expect(
        rig.connect(user0).fund(user0.address, convert("100", 6), "")
      ).to.be.reverted;
      console.log("- Donation without approval correctly reverted");
    });

    it("Should revert deployment with zero recipient address", async function () {
      // Deploying with zero address recipient should revert
      const rigArtifact = await ethers.getContractFactory("FundRig");
      await expect(
        rigArtifact.deploy(
          unitToken.address,
          paymentToken.address,
          mockCore.address,
          treasury.address,
          team.address,
          AddressZero, // zero recipient should fail
          [INITIAL_EMISSION, MIN_EMISSION, 30, ONE_DAY], // Config
          "" // uri
        )
      ).to.be.revertedWith("FundRig__ZeroAddress()");
    });

    it("Should revert deployment with halving period too low", async function () {
      const rigArtifact = await ethers.getContractFactory("FundRig");
      await expect(
        rigArtifact.deploy(
          unitToken.address,
          paymentToken.address,
          mockCore.address,
          treasury.address,
          team.address,
          recipient.address,
          [INITIAL_EMISSION, MIN_EMISSION, 6, ONE_DAY], // Config: halvingPeriod too low (min is 7)
          "" // uri
        )
      ).to.be.revertedWith("FundRig__HalvingPeriodOutOfRange()");
    });

    it("Should revert deployment with halving period too high", async function () {
      const rigArtifact = await ethers.getContractFactory("FundRig");
      await expect(
        rigArtifact.deploy(
          unitToken.address,
          paymentToken.address,
          mockCore.address,
          treasury.address,
          team.address,
          recipient.address,
          [INITIAL_EMISSION, MIN_EMISSION, 366, ONE_DAY], // Config: halvingPeriod too high (max is 365)
          "" // uri
        )
      ).to.be.revertedWith("FundRig__HalvingPeriodOutOfRange()");
    });

    it("Should correctly split donations (50/45/4/1)", async function () {
      console.log("\n*** Split Check ***");

      // Record initial balances
      const recipientBefore = await paymentToken.balanceOf(recipient.address);
      const treasuryBefore = await paymentToken.balanceOf(treasury.address);
      const teamBefore = await paymentToken.balanceOf(team.address);
      const protocolBefore = await paymentToken.balanceOf(protocol.address);

      // Approve and donate 1000 tokens
      const donationAmount = convert("1000", 6);
      await paymentToken.connect(user0).approve(rig.address, donationAmount);
      await rig.connect(user0).fund(user0.address, donationAmount, "");

      // Check balances after
      const recipientAfter = await paymentToken.balanceOf(recipient.address);
      const treasuryAfter = await paymentToken.balanceOf(treasury.address);
      const teamAfter = await paymentToken.balanceOf(team.address);
      const protocolAfter = await paymentToken.balanceOf(protocol.address);

      const recipientReceived = recipientAfter.sub(recipientBefore);
      const treasuryReceived = treasuryAfter.sub(treasuryBefore);
      const teamReceived = teamAfter.sub(teamBefore);
      const protocolReceived = protocolAfter.sub(protocolBefore);

      console.log("Donation Amount:", divDec(donationAmount, 6));
      console.log("Recipient Received:", divDec(recipientReceived, 6), "(expected: 500)");
      console.log("Treasury Received:", divDec(treasuryReceived, 6), "(expected: 450)");
      console.log("Team Received:", divDec(teamReceived, 6), "(expected: 40)");
      console.log("Protocol Received:", divDec(protocolReceived, 6), "(expected: 10)");

      // Verify splits: 50% recipient, 45% treasury (remainder), 4% team, 1% protocol
      expect(recipientReceived).to.equal(convert("500", 6)); // 50%
      expect(treasuryReceived).to.equal(convert("450", 6)); // 45%
      expect(teamReceived).to.equal(convert("40", 6)); // 4%
      expect(protocolReceived).to.equal(convert("10", 6)); // 1%

      console.log("- Split verification passed!");
    });

    it("Should emit FundRig__Funded event", async function () {
      const donationAmount = convert("100", 6);
      await paymentToken.connect(user1).approve(rig.address, donationAmount);

      const currentDay = await rig.currentEpoch();

      await expect(rig.connect(user1).fund(user1.address, donationAmount, ""))
        .to.emit(rig, "FundRig__Funded")
        .withArgs(user1.address, user1.address, donationAmount, currentDay, "");
    });

    it("Should track daily donations correctly", async function () {
      const day = await rig.currentEpoch();
      const user0Donation = await rig.epochAccountToDonation(day, user0.address);
      const dayTotal = await rig.epochToTotalDonated(day);

      expect(user0Donation).to.equal(convert("1000", 6)); // 1000 from split check
      expect(dayTotal).to.be.gt(0);
    });

    it("Should prevent zero amount donation", async function () {
      await expect(
        rig.connect(user0).fund(user0.address, 0, "")
      ).to.be.revertedWith("FundRig__BelowMinDonation()");
    });

    it("Should prevent donation to zero address account", async function () {
      await paymentToken.connect(user0).approve(rig.address, convert("100", 6));
      await expect(
        rig.connect(user0).fund(AddressZero, convert("100", 6), "")
      ).to.be.revertedWith("FundRig__ZeroAddress()");
    });

    it("Should redirect team fees to treasury when team address is zero", async function () {
      // Set team address to zero
      await rig.connect(owner).setTeam(AddressZero);

      // Record initial balances
      const recipientBefore = await paymentToken.balanceOf(recipient.address);
      const treasuryBefore = await paymentToken.balanceOf(treasury.address);
      const protocolBefore = await paymentToken.balanceOf(protocol.address);

      // Donate 1000 tokens
      const donationAmount = convert("1000", 6);
      await paymentToken.connect(user0).approve(rig.address, donationAmount);
      await rig.connect(user0).fund(user0.address, donationAmount, "");

      // Check balances after
      const recipientAfter = await paymentToken.balanceOf(recipient.address);
      const treasuryAfter = await paymentToken.balanceOf(treasury.address);
      const protocolAfter = await paymentToken.balanceOf(protocol.address);

      const recipientReceived = recipientAfter.sub(recipientBefore);
      const treasuryReceived = treasuryAfter.sub(treasuryBefore);
      const protocolReceived = protocolAfter.sub(protocolBefore);

      // Recipient gets 50%, protocol gets 1%, treasury gets 44% + 4% (team fee) = 48%
      // Total: 1000 - 500 (recipient) - 10 (protocol) = 490 treasury
      expect(recipientReceived).to.equal(convert("500", 6)); // 50%
      expect(protocolReceived).to.equal(convert("10", 6)); // 1%
      expect(treasuryReceived).to.equal(convert("490", 6)); // 44% + 5% (remainder)

      // Reset team address for other tests
      await rig.connect(owner).setTeam(team.address);
    });

    it("Should allow anyone to donate on behalf of another account", async function () {
      // user2 donates on behalf of user0
      const user0DonationBefore = await rig.epochAccountToDonation(await rig.currentEpoch(), user0.address);

      await paymentToken.connect(user2).approve(rig.address, convert("100", 6));
      await rig.connect(user2).fund(user0.address, convert("100", 6), "");

      const user0DonationAfter = await rig.epochAccountToDonation(await rig.currentEpoch(), user0.address);
      expect(user0DonationAfter.sub(user0DonationBefore)).to.equal(convert("100", 6));
    });
  });

  describe("Claiming Tests", function () {
    it("Should prevent claiming before day ends", async function () {
      const currentDay = await rig.currentEpoch();
      await expect(
        rig.connect(user0).claim(user0.address, currentDay)
      ).to.be.revertedWith("FundRig__EpochNotEnded()");
    });

    it("Should distribute Unit proportionally (25%/75%)", async function () {
      console.log("\n*** Proportional Claiming ***");

      // Start fresh on a new day
      await increaseTime(ONE_DAY + 1);

      const newDay = await rig.currentEpoch();
      console.log("New day:", newDay.toString());

      // User A donates 100 tokens
      await paymentToken.connect(user0).approve(rig.address, convert("100", 6));
      await rig.connect(user0).fund(user0.address, convert("100", 6), "");

      // User B donates 300 tokens
      await paymentToken.connect(user1).approve(rig.address, convert("300", 6));
      await rig.connect(user1).fund(user1.address, convert("300", 6), "");

      // Advance to next day
      await increaseTime(ONE_DAY + 1);

      // Get emission for that day
      const dayEmission = await rig.getEpochEmission(newDay);
      console.log("Day Emission:", divDec(dayEmission));

      // Calculate expected rewards
      // User A: 100/400 = 25% of emission
      // User B: 300/400 = 75% of emission
      const expectedUserA = dayEmission.mul(100).div(400);
      const expectedUserB = dayEmission.mul(300).div(400);

      console.log("Expected User A (25%):", divDec(expectedUserA));
      console.log("Expected User B (75%):", divDec(expectedUserB));

      // Check pending rewards
      const pendingA = await rig.getPendingReward(newDay, user0.address);
      const pendingB = await rig.getPendingReward(newDay, user1.address);

      expect(pendingA).to.equal(expectedUserA);
      expect(pendingB).to.equal(expectedUserB);

      // Claim rewards
      const balanceABefore = await unitToken.balanceOf(user0.address);
      const balanceBBefore = await unitToken.balanceOf(user1.address);

      await rig.connect(user0).claim(user0.address, newDay);
      await rig.connect(user1).claim(user1.address, newDay);

      const balanceAAfter = await unitToken.balanceOf(user0.address);
      const balanceBAfter = await unitToken.balanceOf(user1.address);

      const receivedA = balanceAAfter.sub(balanceABefore);
      const receivedB = balanceBAfter.sub(balanceBBefore);

      console.log("User A received:", divDec(receivedA));
      console.log("User B received:", divDec(receivedB));

      expect(receivedA).to.equal(expectedUserA);
      expect(receivedB).to.equal(expectedUserB);

      // Verify User B got 75% (3x User A)
      expect(receivedB).to.equal(receivedA.mul(3));
      console.log("- User B correctly received 3x User A's reward (75% vs 25%)");
    });

    it("Should prevent double claiming", async function () {
      const previousDay = (await rig.currentEpoch()).sub(1);
      await expect(
        rig.connect(user0).claim(user0.address, previousDay)
      ).to.be.revertedWith("FundRig__AlreadyClaimed()");
    });

    it("Should prevent claiming with no donation", async function () {
      const previousDay = (await rig.currentEpoch()).sub(1);
      await expect(
        rig.connect(user2).claim(user2.address, previousDay)
      ).to.be.revertedWith("FundRig__NoDonation()");
    });

    it("Should emit FundRig__Claimed event", async function () {
      // Setup a new day with donation
      await increaseTime(ONE_DAY + 1);
      const newDay = await rig.currentEpoch();

      await paymentToken.connect(user2).approve(rig.address, convert("100", 6));
      await rig.connect(user2).fund(user2.address, convert("100", 6), "");

      // Advance to claim
      await increaseTime(ONE_DAY + 1);

      const expectedReward = await rig.getPendingReward(newDay, user2.address);

      await expect(rig.connect(user2).claim(user2.address, newDay))
        .to.emit(rig, "FundRig__Claimed")
        .withArgs(user2.address, expectedReward, newDay);
    });

    it("Should return 0 for pending reward if day not ended", async function () {
      const currentDay = await rig.currentEpoch();
      const pending = await rig.getPendingReward(currentDay, user0.address);
      expect(pending).to.equal(0);
    });

    it("Should return 0 for pending reward if already claimed", async function () {
      // user0 already claimed for the day we tested proportional claiming
      const claimedDay = (await rig.currentEpoch()).sub(2); // 2 days ago
      const pending = await rig.getPendingReward(claimedDay, user0.address);
      expect(pending).to.equal(0);
    });

    it("Should allow anyone to claim on behalf of another account", async function () {
      // Setup a new day with donation from user0
      await increaseTime(ONE_DAY + 1);
      const newDay = await rig.currentEpoch();

      await paymentToken.connect(user0).approve(rig.address, convert("200", 6));
      await rig.connect(user0).fund(user0.address, convert("200", 6), "");

      // Advance to claim
      await increaseTime(ONE_DAY + 1);

      const balanceBefore = await unitToken.balanceOf(user0.address);

      // user1 claims on behalf of user0
      await rig.connect(user1).claim(user0.address, newDay);

      const balanceAfter = await unitToken.balanceOf(user0.address);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });
  });

  describe("Emission Halving Tests", function () {
    it("Should return correct emission for day 0", async function () {
      const emission = await rig.getEpochEmission(0);
      expect(emission).to.equal(INITIAL_EMISSION);
    });

    it("Should return same emission within first 30 days", async function () {
      const emission0 = await rig.getEpochEmission(0);
      const emission15 = await rig.getEpochEmission(15);
      const emission29 = await rig.getEpochEmission(29);

      expect(emission0).to.equal(emission15);
      expect(emission0).to.equal(emission29);
    });

    it("Should halve emission after 30 days", async function () {
      const emission0 = await rig.getEpochEmission(0);
      const emission30 = await rig.getEpochEmission(30);

      expect(emission30).to.equal(emission0.div(2));
    });

    it("Should halve emission multiple times", async function () {
      const emission0 = await rig.getEpochEmission(0);
      const emission60 = await rig.getEpochEmission(60);
      const emission90 = await rig.getEpochEmission(90);

      expect(emission60).to.equal(emission0.div(4)); // 2 halvings
      expect(emission90).to.equal(emission0.div(8)); // 3 halvings
    });

    it("Should respect minimum emission floor", async function () {
      // After many halvings, should hit floor
      const emission720 = await rig.getEpochEmission(720); // 24 halvings
      const emission1000 = await rig.getEpochEmission(1000);

      expect(emission720).to.be.gte(MIN_EMISSION);
      expect(emission1000).to.equal(MIN_EMISSION);
    });
  });

  describe("View Function Tests", function () {
    it("currentDay should track correctly", async function () {
      const day = await rig.currentEpoch();

      await increaseTime(ONE_DAY);
      const nextDay = await rig.currentEpoch();

      expect(nextDay).to.equal(day.add(1));
    });

    it("getDayTotal should return total donations for a day", async function () {
      const day = await rig.currentEpoch();

      await paymentToken.connect(user0).approve(rig.address, convert("100", 6));
      await rig.connect(user0).fund(user0.address, convert("100", 6), "");

      const total = await rig.epochToTotalDonated(day);
      expect(total).to.be.gt(0);
    });

    it("getUserDonation should return user donation for a day", async function () {
      const day = await rig.currentEpoch();
      const donation = await rig.epochAccountToDonation(day, user0.address);
      expect(donation).to.equal(convert("100", 6));
    });
  });

  describe("Custom Epoch Duration Tests", function () {
    let shortRig, shortUnit;
    const ONE_HOUR = 3600;

    before(async function () {
      // Deploy a FundRig with 1 hour epoch duration
      const unitArtifact = await ethers.getContractFactory("Unit");
      shortUnit = await unitArtifact.deploy("Short Epoch Unit", "SUNIT", owner.address);

      const mockCoreArtifact = await ethers.getContractFactory("MockCore");
      const shortMockCore = await mockCoreArtifact.deploy(protocol.address);

      const rigArtifact = await ethers.getContractFactory("FundRig");
      shortRig = await rigArtifact.deploy(
        shortUnit.address,
        paymentToken.address,
        shortMockCore.address,
        treasury.address,
        team.address,
        recipient.address,
        [INITIAL_EMISSION, MIN_EMISSION, 30, ONE_HOUR], // Config: 1 hour epochs
        ""
      );

      await shortUnit.setRig(shortRig.address);

      // Fund users
      await paymentToken.mint(user0.address, convert("5000", 6));
    });

    it("Should have correct epoch duration", async function () {
      expect(await shortRig.epochDuration()).to.equal(ONE_HOUR);
    });

    it("currentDay should advance after one epoch (1 hour)", async function () {
      const day0 = await shortRig.currentEpoch();
      expect(day0).to.equal(0);

      await increaseTime(ONE_HOUR);
      const day1 = await shortRig.currentEpoch();
      expect(day1).to.equal(1);
    });

    it("Should allow claiming after epoch ends", async function () {
      // Donate in current epoch
      const epoch = await shortRig.currentEpoch();
      await paymentToken.connect(user0).approve(shortRig.address, convert("100", 6));
      await shortRig.connect(user0).fund(user0.address, convert("100", 6), "");

      // Advance one epoch
      await increaseTime(ONE_HOUR);

      // Should be claimable now
      const balBefore = await shortUnit.balanceOf(user0.address);
      await shortRig.claim(user0.address, epoch);
      const balAfter = await shortUnit.balanceOf(user0.address);
      expect(balAfter).to.be.gt(balBefore);
    });

    it("Halving should work with epoch-based periods", async function () {
      // halvingPeriod=30, so after 30 epochs emission should halve
      const emission0 = await shortRig.getEpochEmission(0);
      const emission30 = await shortRig.getEpochEmission(30);
      expect(emission30).to.equal(emission0.div(2));
    });

    it("Should revert deployment with epoch duration too short", async function () {
      const unitArtifact = await ethers.getContractFactory("Unit");
      const tmpUnit = await unitArtifact.deploy("Tmp", "TMP", owner.address);

      const rigArtifact = await ethers.getContractFactory("FundRig");
      await expect(
        rigArtifact.deploy(
          tmpUnit.address,
          paymentToken.address,
          mockCore.address,
          treasury.address,
          team.address,
          recipient.address,
          [INITIAL_EMISSION, MIN_EMISSION, 30, 3599], // Config: less than 1 hour
          ""
        )
      ).to.be.revertedWith("FundRig__EpochDurationOutOfRange()");
    });

    it("Should revert deployment with epoch duration too long", async function () {
      const unitArtifact = await ethers.getContractFactory("Unit");
      const tmpUnit = await unitArtifact.deploy("Tmp2", "TMP2", owner.address);

      const rigArtifact = await ethers.getContractFactory("FundRig");
      await expect(
        rigArtifact.deploy(
          tmpUnit.address,
          paymentToken.address,
          mockCore.address,
          treasury.address,
          team.address,
          recipient.address,
          [INITIAL_EMISSION, MIN_EMISSION, 30, 7 * 86400 + 1], // Config: more than 7 days
          ""
        )
      ).to.be.revertedWith("FundRig__EpochDurationOutOfRange()");
    });
  });

  describe("RecipientSet Event Tests", function () {
    it("Should emit RecipientSet event when changing recipient", async function () {
      await expect(rig.connect(owner).setRecipient(user2.address))
        .to.emit(rig, "FundRig__RecipientSet")
        .withArgs(user2.address);

      // Cleanup
      await rig.connect(owner).setRecipient(recipient.address);
    });
  });

  describe("Funded Event Tests", function () {
    it("Should include correct args in Funded event", async function () {
      const amount = convert("100", 6);
      await paymentToken.connect(user0).approve(rig.address, amount);

      const epoch = await rig.currentEpoch();

      await expect(rig.connect(user0).fund(user0.address, amount, "test-uri"))
        .to.emit(rig, "FundRig__Funded")
        .withArgs(user0.address, user0.address, amount, epoch, "test-uri");
    });
  });

  describe("MIN_DONATION Boundary Tests", function () {
    it("Should revert donation below MIN_DONATION (10000)", async function () {
      await paymentToken.connect(user0).approve(rig.address, 9999);
      await expect(
        rig.connect(user0).fund(user0.address, 9999, "")
      ).to.be.revertedWith("FundRig__BelowMinDonation()");
    });

    it("Should accept donation at exactly MIN_DONATION (10000)", async function () {
      await paymentToken.connect(user0).approve(rig.address, 10000);
      await expect(
        rig.connect(user0).fund(user0.address, 10000, "")
      ).to.not.be.reverted;
    });
  });

  describe("Epoch Boundary Precision Tests", function () {
    let precisionRig, precisionUnit;
    const TWO_HOURS = 7200;

    before(async function () {
      const unitArtifact = await ethers.getContractFactory("Unit");
      precisionUnit = await unitArtifact.deploy("Precision Unit", "PUNIT", owner.address);

      const mockCoreArtifact = await ethers.getContractFactory("MockCore");
      const precMockCore = await mockCoreArtifact.deploy(protocol.address);

      const rigArtifact = await ethers.getContractFactory("FundRig");
      precisionRig = await rigArtifact.deploy(
        precisionUnit.address,
        paymentToken.address,
        precMockCore.address,
        treasury.address,
        team.address,
        recipient.address,
        [INITIAL_EMISSION, MIN_EMISSION, 30, TWO_HOURS], // 2-hour epochs
        ""
      );

      await precisionUnit.setRig(precisionRig.address);
      await paymentToken.mint(user0.address, convert("5000", 6));
    });

    it("Should start at epoch 0", async function () {
      expect(await precisionRig.currentEpoch()).to.equal(0);
    });

    it("Should stay in epoch 0 before epochDuration elapses", async function () {
      // Advance 1 hour 59 minutes (just under 2 hours)
      await increaseTime(TWO_HOURS - 60);
      expect(await precisionRig.currentEpoch()).to.equal(0);
    });

    it("Should advance to epoch 1 at exactly epochDuration", async function () {
      // Advance remaining 60 seconds to hit 2 hours
      await increaseTime(60);
      expect(await precisionRig.currentEpoch()).to.equal(1);
    });

    it("Should allow claiming epoch 0 after it ends", async function () {
      // Go back to fresh state — donate in epoch 0 was not done, so deploy fresh
      const unitArtifact = await ethers.getContractFactory("Unit");
      const tmpUnit = await unitArtifact.deploy("Epoch Claim Unit", "ECUNIT", owner.address);

      const mockCoreArtifact = await ethers.getContractFactory("MockCore");
      const tmpCore = await mockCoreArtifact.deploy(protocol.address);

      const rigArtifact = await ethers.getContractFactory("FundRig");
      const tmpRig = await rigArtifact.deploy(
        tmpUnit.address,
        paymentToken.address,
        tmpCore.address,
        treasury.address,
        team.address,
        recipient.address,
        [INITIAL_EMISSION, MIN_EMISSION, 30, TWO_HOURS],
        ""
      );
      await tmpUnit.setRig(tmpRig.address);

      // Donate in epoch 0
      await paymentToken.connect(user0).approve(tmpRig.address, convert("100", 6));
      await tmpRig.connect(user0).fund(user0.address, convert("100", 6), "");

      // Still in epoch 0 — cannot claim
      await expect(
        tmpRig.claim(user0.address, 0)
      ).to.be.revertedWith("FundRig__EpochNotEnded()");

      // Advance past epoch boundary
      await increaseTime(TWO_HOURS);

      // Now can claim epoch 0
      const balBefore = await tmpUnit.balanceOf(user0.address);
      await tmpRig.claim(user0.address, 0);
      const balAfter = await tmpUnit.balanceOf(user0.address);
      expect(balAfter).to.be.gt(balBefore);
    });

    it("Should track multiple rapid epochs correctly", async function () {
      const unitArtifact = await ethers.getContractFactory("Unit");
      const tmpUnit = await unitArtifact.deploy("Rapid Unit", "RUNIT", owner.address);

      const mockCoreArtifact = await ethers.getContractFactory("MockCore");
      const tmpCore = await mockCoreArtifact.deploy(protocol.address);

      const ONE_HOUR = 3600;
      const rigArtifact = await ethers.getContractFactory("FundRig");
      const tmpRig = await rigArtifact.deploy(
        tmpUnit.address,
        paymentToken.address,
        tmpCore.address,
        treasury.address,
        team.address,
        recipient.address,
        [INITIAL_EMISSION, MIN_EMISSION, 30, ONE_HOUR], // 1-hour epochs
        ""
      );
      await tmpUnit.setRig(tmpRig.address);

      // Donate across 3 epochs
      for (let i = 0; i < 3; i++) {
        const epoch = await tmpRig.currentEpoch();
        await paymentToken.connect(user0).approve(tmpRig.address, convert("50", 6));
        await tmpRig.connect(user0).fund(user0.address, convert("50", 6), "");

        const donation = await tmpRig.epochAccountToDonation(epoch, user0.address);
        expect(donation).to.equal(convert("50", 6));

        await increaseTime(ONE_HOUR);
      }

      // Should be at epoch 3 now
      expect(await tmpRig.currentEpoch()).to.equal(3);

      // Claim all 3 epochs
      for (let i = 0; i < 3; i++) {
        const balBefore = await tmpUnit.balanceOf(user0.address);
        await tmpRig.claim(user0.address, i);
        const balAfter = await tmpUnit.balanceOf(user0.address);
        expect(balAfter).to.be.gt(balBefore);
      }
    });
  });
});
