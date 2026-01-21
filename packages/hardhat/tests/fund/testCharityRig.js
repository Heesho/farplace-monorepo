const convert = (amount, decimals = 18) => ethers.utils.parseUnits(amount.toString(), decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";

let owner, recipient, recipient2, treasury, team, protocol, user0, user1, user2;
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
const MIN_DONATION = ethers.utils.parseUnits("0.01", 18); // 0.01 tokens (ensures non-zero fees)

describe("FundRig Tests", function () {
  before("Initial set up", async function () {
    await network.provider.send("hardhat_reset");
    console.log("Begin Initialization");

    [owner, recipient, recipient2, treasury, team, protocol, user0, user1, user2] = await ethers.getSigners();

    // Deploy mock payment token (using MockWETH.sol)
    const mockWethArtifact = await ethers.getContractFactory("MockWETH");
    paymentToken = await mockWethArtifact.deploy();
    console.log("- Payment Token (MockWETH) Initialized");

    // Deploy mock Core (for protocolFeeAddress)
    const mockCoreArtifact = await ethers.getContractFactory("MockCore");
    mockCore = await mockCoreArtifact.deploy(protocol.address);
    console.log("- MockCore Initialized");

    // Deploy Unit token
    const unitArtifact = await ethers.getContractFactory("Unit");
    unitToken = await unitArtifact.deploy("Test Unit", "TUNIT");
    console.log("- Unit Token Initialized");

    // Deploy FundRig
    const rigArtifact = await ethers.getContractFactory("FundRig");
    rig = await rigArtifact.deploy(
      paymentToken.address,
      unitToken.address,
      treasury.address,
      team.address,
      mockCore.address, // core
      INITIAL_EMISSION,
      MIN_EMISSION,
      MIN_DONATION
    );
    console.log("- FundRig Initialized");

    // Whitelist recipient addresses
    await rig.addRecipient(recipient.address);
    await rig.addRecipient(recipient2.address);
    console.log("- Recipients whitelisted");

    // Transfer minting rights to Rig
    await unitToken.setRig(rig.address);
    console.log("- Minting rights transferred to FundRig");

    // Mint payment tokens to users
    await paymentToken.connect(user0).deposit({ value: convert("5000") });
    await paymentToken.connect(user1).deposit({ value: convert("5000") });
    await paymentToken.connect(user2).deposit({ value: convert("5000") });
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
  });

  describe("FundRig Configuration Tests", function () {
    it("Should have correct initial state", async function () {
      expect(await rig.paymentToken()).to.equal(paymentToken.address);
      expect(await rig.unit()).to.equal(unitToken.address);
      expect(await rig.treasury()).to.equal(treasury.address);
      expect(await rig.team()).to.equal(team.address);
      expect(await rig.core()).to.equal(mockCore.address);
    });

    it("Should have correct constants", async function () {
      expect(await rig.initialEmission()).to.equal(INITIAL_EMISSION);
      expect(await rig.minEmission()).to.equal(MIN_EMISSION);
      expect(await rig.HALVING_PERIOD()).to.equal(THIRTY_DAYS);
      expect(await rig.RECIPIENT_BPS()).to.equal(5000); // 50%
      expect(await rig.TEAM_BPS()).to.equal(400); // 4%
      expect(await rig.PROTOCOL_BPS()).to.equal(100); // 1%
      // Treasury receives remainder (45%)
      expect(await rig.DIVISOR()).to.equal(10000);
    });

    it("Should have whitelisted recipients", async function () {
      expect(await rig.accountToIsRecipient(recipient.address)).to.equal(true);
      expect(await rig.accountToIsRecipient(recipient2.address)).to.equal(true);
      expect(await rig.accountToIsRecipient(user0.address)).to.equal(false);
    });

    it("Should allow owner to add recipient", async function () {
      const newRecipient = user2.address;
      await rig.connect(owner).addRecipient(newRecipient);
      expect(await rig.accountToIsRecipient(newRecipient)).to.equal(true);
      // Remove for other tests
      await rig.connect(owner).removeRecipient(newRecipient);
    });

    it("Should allow owner to remove recipient", async function () {
      await rig.connect(owner).removeRecipient(recipient2.address);
      expect(await rig.accountToIsRecipient(recipient2.address)).to.equal(false);
      // Re-add for other tests
      await rig.connect(owner).addRecipient(recipient2.address);
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

    it("Should prevent non-owner from adding recipient", async function () {
      await expect(
        rig.connect(user0).addRecipient(user0.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should prevent setting zero address for treasury", async function () {
      await expect(
        rig.connect(owner).setTreasury(AddressZero)
      ).to.be.revertedWith("FundRig__InvalidAddress()");
    });

    it("Should allow setting team address to zero", async function () {
      await rig.connect(owner).setTeam(AddressZero);
      expect(await rig.team()).to.equal(AddressZero);
      // Reset for other tests
      await rig.connect(owner).setTeam(team.address);
    });

    it("Should prevent adding zero address as recipient", async function () {
      await expect(
        rig.connect(owner).addRecipient(AddressZero)
      ).to.be.revertedWith("FundRig__InvalidAddress()");
    });
  });

  describe("Donation Tests", function () {
    it("Should revert donation without approval", async function () {
      console.log("\n*** Allowance Check ***");
      await expect(
        rig.connect(user0).donate(user0.address, recipient.address, convert("100"))
      ).to.be.reverted;
      console.log("- Donation without approval correctly reverted");
    });

    it("Should revert donation to non-whitelisted recipient", async function () {
      await paymentToken.connect(user0).approve(rig.address, convert("100"));
      await expect(
        rig.connect(user0).donate(user0.address, user1.address, convert("100"))
      ).to.be.revertedWith("FundRig__NotRecipient()");
    });

    it("Should correctly split donations (50/45/4/1)", async function () {
      console.log("\n*** Split Check ***");

      // Record initial balances
      const recipientBefore = await paymentToken.balanceOf(recipient.address);
      const treasuryBefore = await paymentToken.balanceOf(treasury.address);
      const teamBefore = await paymentToken.balanceOf(team.address);
      const protocolBefore = await paymentToken.balanceOf(protocol.address);

      // Approve and donate 1000 tokens
      const donationAmount = convert("1000");
      await paymentToken.connect(user0).approve(rig.address, donationAmount);
      await rig.connect(user0).donate(user0.address, recipient.address, donationAmount);

      // Check balances after
      const recipientAfter = await paymentToken.balanceOf(recipient.address);
      const treasuryAfter = await paymentToken.balanceOf(treasury.address);
      const teamAfter = await paymentToken.balanceOf(team.address);
      const protocolAfter = await paymentToken.balanceOf(protocol.address);

      const recipientReceived = recipientAfter.sub(recipientBefore);
      const treasuryReceived = treasuryAfter.sub(treasuryBefore);
      const teamReceived = teamAfter.sub(teamBefore);
      const protocolReceived = protocolAfter.sub(protocolBefore);

      console.log("Donation Amount:", divDec(donationAmount));
      console.log("Recipient Received:", divDec(recipientReceived), "(expected: 500)");
      console.log("Treasury Received:", divDec(treasuryReceived), "(expected: 450)");
      console.log("Team Received:", divDec(teamReceived), "(expected: 40)");
      console.log("Protocol Received:", divDec(protocolReceived), "(expected: 10)");

      // Verify splits: 50% recipient, 45% treasury (remainder), 4% team, 1% protocol
      expect(recipientReceived).to.equal(convert("500")); // 50%
      expect(treasuryReceived).to.equal(convert("450")); // 45%
      expect(teamReceived).to.equal(convert("40")); // 4%
      expect(protocolReceived).to.equal(convert("10")); // 1%

      console.log("- Split verification passed!");
    });

    it("Should allow donations to different recipients", async function () {
      const recipientBefore = await paymentToken.balanceOf(recipient.address);
      const recipient2Before = await paymentToken.balanceOf(recipient2.address);

      // Donate to first recipient
      await paymentToken.connect(user1).approve(rig.address, convert("200"));
      await rig.connect(user1).donate(user1.address, recipient.address, convert("100"));

      // Donate to second recipient
      await rig.connect(user1).donate(user1.address, recipient2.address, convert("100"));

      const recipientAfter = await paymentToken.balanceOf(recipient.address);
      const recipient2After = await paymentToken.balanceOf(recipient2.address);

      expect(recipientAfter.sub(recipientBefore)).to.equal(convert("50")); // 50% of 100
      expect(recipient2After.sub(recipient2Before)).to.equal(convert("50")); // 50% of 100
    });

    it("Should emit FundRig__Donated event", async function () {
      const donationAmount = convert("100");
      await paymentToken.connect(user1).approve(rig.address, donationAmount);

      const currentDay = await rig.currentDay();

      await expect(rig.connect(user1).donate(user1.address, recipient.address, donationAmount))
        .to.emit(rig, "FundRig__Donated")
        .withArgs(user1.address, recipient.address, donationAmount, currentDay);
    });

    it("Should track daily donations correctly", async function () {
      const day = await rig.currentDay();
      const user0Donation = await rig.getUserDonation(day, user0.address);
      const dayTotal = await rig.getDayTotal(day);

      expect(user0Donation).to.equal(convert("1000"));
      expect(dayTotal).to.be.gt(0);
    });

    it("Should prevent zero amount donation", async function () {
      await expect(
        rig.connect(user0).donate(user0.address, recipient.address, 0)
      ).to.be.revertedWith("FundRig__BelowMinDonation()");
    });

    it("Should prevent donation to zero address account", async function () {
      await paymentToken.connect(user0).approve(rig.address, convert("100"));
      await expect(
        rig.connect(user0).donate(AddressZero, recipient.address, convert("100"))
      ).to.be.revertedWith("FundRig__InvalidAddress()");
    });

    it("Should redirect team fees to treasury when team address is zero", async function () {
      // Set team address to zero
      await rig.connect(owner).setTeam(AddressZero);

      // Record initial balances
      const recipientBefore = await paymentToken.balanceOf(recipient.address);
      const treasuryBefore = await paymentToken.balanceOf(treasury.address);
      const protocolBefore = await paymentToken.balanceOf(protocol.address);

      // Donate 1000 tokens
      const donationAmount = convert("1000");
      await paymentToken.connect(user0).approve(rig.address, donationAmount);
      await rig.connect(user0).donate(user0.address, recipient.address, donationAmount);

      // Check balances after
      const recipientAfter = await paymentToken.balanceOf(recipient.address);
      const treasuryAfter = await paymentToken.balanceOf(treasury.address);
      const protocolAfter = await paymentToken.balanceOf(protocol.address);

      const recipientReceived = recipientAfter.sub(recipientBefore);
      const treasuryReceived = treasuryAfter.sub(treasuryBefore);
      const protocolReceived = protocolAfter.sub(protocolBefore);

      // Recipient gets 50%, protocol gets 1%, treasury gets 44% + 4% (team fee) = 48%
      // Total: 1000 - 500 (recipient) - 10 (protocol) = 490 treasury
      expect(recipientReceived).to.equal(convert("500")); // 50%
      expect(protocolReceived).to.equal(convert("10")); // 1%
      expect(treasuryReceived).to.equal(convert("490")); // 44% + 5% (remainder)

      // Reset team address for other tests
      await rig.connect(owner).setTeam(team.address);
    });

    it("Should allow anyone to donate on behalf of another account", async function () {
      // user2 donates on behalf of user0
      const user0DonationBefore = await rig.getUserDonation(await rig.currentDay(), user0.address);

      await paymentToken.connect(user2).approve(rig.address, convert("100"));
      await rig.connect(user2).donate(user0.address, recipient.address, convert("100"));

      const user0DonationAfter = await rig.getUserDonation(await rig.currentDay(), user0.address);
      expect(user0DonationAfter.sub(user0DonationBefore)).to.equal(convert("100"));
    });
  });

  describe("Claiming Tests", function () {
    it("Should prevent claiming before day ends", async function () {
      const currentDay = await rig.currentDay();
      await expect(
        rig.connect(user0).claim(user0.address, currentDay)
      ).to.be.revertedWith("FundRig__DayNotEnded()");
    });

    it("Should distribute Unit proportionally (25%/75%)", async function () {
      console.log("\n*** Proportional Claiming ***");

      // Start fresh on a new day
      await increaseTime(ONE_DAY + 1);

      const newDay = await rig.currentDay();
      console.log("New day:", newDay.toString());

      // User A donates 100 tokens
      await paymentToken.connect(user0).approve(rig.address, convert("100"));
      await rig.connect(user0).donate(user0.address, recipient.address, convert("100"));

      // User B donates 300 tokens
      await paymentToken.connect(user1).approve(rig.address, convert("300"));
      await rig.connect(user1).donate(user1.address, recipient.address, convert("300"));

      // Advance to next day
      await increaseTime(ONE_DAY + 1);

      // Get emission for that day
      const dayEmission = await rig.getDayEmission(newDay);
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
      const previousDay = (await rig.currentDay()).sub(1);
      await expect(
        rig.connect(user0).claim(user0.address, previousDay)
      ).to.be.revertedWith("FundRig__AlreadyClaimed()");
    });

    it("Should prevent claiming with no donation", async function () {
      const previousDay = (await rig.currentDay()).sub(1);
      await expect(
        rig.connect(user2).claim(user2.address, previousDay)
      ).to.be.revertedWith("FundRig__NoDonation()");
    });

    it("Should emit FundRig__Claimed event", async function () {
      // Setup a new day with donation
      await increaseTime(ONE_DAY + 1);
      const newDay = await rig.currentDay();

      await paymentToken.connect(user2).approve(rig.address, convert("100"));
      await rig.connect(user2).donate(user2.address, recipient.address, convert("100"));

      // Advance to claim
      await increaseTime(ONE_DAY + 1);

      const expectedReward = await rig.getPendingReward(newDay, user2.address);

      await expect(rig.connect(user2).claim(user2.address, newDay))
        .to.emit(rig, "FundRig__Claimed")
        .withArgs(user2.address, expectedReward, newDay);
    });

    it("Should return 0 for pending reward if day not ended", async function () {
      const currentDay = await rig.currentDay();
      const pending = await rig.getPendingReward(currentDay, user0.address);
      expect(pending).to.equal(0);
    });

    it("Should return 0 for pending reward if already claimed", async function () {
      // user0 already claimed for the day we tested proportional claiming
      const claimedDay = (await rig.currentDay()).sub(2); // 2 days ago
      const pending = await rig.getPendingReward(claimedDay, user0.address);
      expect(pending).to.equal(0);
    });

    it("Should allow anyone to claim on behalf of another account", async function () {
      // Setup a new day with donation from user0
      await increaseTime(ONE_DAY + 1);
      const newDay = await rig.currentDay();

      await paymentToken.connect(user0).approve(rig.address, convert("200"));
      await rig.connect(user0).donate(user0.address, recipient.address, convert("200"));

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
      const emission = await rig.getDayEmission(0);
      expect(emission).to.equal(INITIAL_EMISSION);
    });

    it("Should return same emission within first 30 days", async function () {
      const emission0 = await rig.getDayEmission(0);
      const emission15 = await rig.getDayEmission(15);
      const emission29 = await rig.getDayEmission(29);

      expect(emission0).to.equal(emission15);
      expect(emission0).to.equal(emission29);
    });

    it("Should halve emission after 30 days", async function () {
      const emission0 = await rig.getDayEmission(0);
      const emission30 = await rig.getDayEmission(30);

      expect(emission30).to.equal(emission0.div(2));
    });

    it("Should halve emission multiple times", async function () {
      const emission0 = await rig.getDayEmission(0);
      const emission60 = await rig.getDayEmission(60);
      const emission90 = await rig.getDayEmission(90);

      expect(emission60).to.equal(emission0.div(4)); // 2 halvings
      expect(emission90).to.equal(emission0.div(8)); // 3 halvings
    });

    it("Should respect minimum emission floor", async function () {
      // After many halvings, should hit floor
      const emission720 = await rig.getDayEmission(720); // 24 halvings
      const emission1000 = await rig.getDayEmission(1000);

      expect(emission720).to.be.gte(MIN_EMISSION);
      expect(emission1000).to.equal(MIN_EMISSION);
    });
  });

  describe("View Function Tests", function () {
    it("currentDay should track correctly", async function () {
      const day = await rig.currentDay();

      await increaseTime(ONE_DAY);
      const nextDay = await rig.currentDay();

      expect(nextDay).to.equal(day.add(1));
    });

    it("getDayTotal should return total donations for a day", async function () {
      const day = await rig.currentDay();

      await paymentToken.connect(user0).approve(rig.address, convert("100"));
      await rig.connect(user0).donate(user0.address, recipient.address, convert("100"));

      const total = await rig.getDayTotal(day);
      expect(total).to.be.gt(0);
    });

    it("getUserDonation should return user donation for a day", async function () {
      const day = await rig.currentDay();
      const donation = await rig.getUserDonation(day, user0.address);
      expect(donation).to.equal(convert("100"));
    });
  });
});
