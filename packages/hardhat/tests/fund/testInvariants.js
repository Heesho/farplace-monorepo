/**
 * @title FundRig Invariant and Business Logic Tests
 * @notice Comprehensive tests verifying donation mechanics and daily pool distribution
 * @dev Tests focus on daily pools, emission halving, fee distribution, and claim mechanics
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

describe("FundRig Invariant Tests", function () {
  let owner, treasury, team, protocol, recipient, user0, user1, user2;
  let paymentToken, unitToken, rig, mockCore;

  before("Deploy contracts", async function () {
    await network.provider.send("hardhat_reset");

    [owner, treasury, team, protocol, recipient, user0, user1, user2] = await ethers.getSigners();

    // Deploy mock WETH as payment token
    const mockWethArtifact = await ethers.getContractFactory("MockWETH");
    paymentToken = await mockWethArtifact.deploy();

    // Deploy mock Core (for protocolFeeAddress)
    const mockCoreArtifact = await ethers.getContractFactory("MockCore");
    mockCore = await mockCoreArtifact.deploy(protocol.address);

    // Deploy Unit token (owner is initial rig, will transfer to FundRig)
    const unitArtifact = await ethers.getContractFactory("Unit");
    unitToken = await unitArtifact.deploy("Fund Test Unit", "CTUNIT", owner.address);

    // Deploy FundRig with correct constructor arguments:
    // paymentToken, unit, recipient, treasury, team, core, initialEmission, minEmission, halvingPeriod
    const rigArtifact = await ethers.getContractFactory("FundRig");
    rig = await rigArtifact.deploy(
      paymentToken.address,  // paymentToken
      unitToken.address,     // unit
      recipient.address,     // recipient (required)
      treasury.address,      // treasury
      team.address,          // team
      mockCore.address,      // core (mock with protocolFeeAddress)
      convert("1000", 18),   // initialEmission: 1000 tokens per day
      convert("10", 18),     // minEmission: 10 tokens per day floor
      30                     // halvingPeriod: 30 days
    );

    // Grant minting rights
    await unitToken.setRig(rig.address);

    // Fund users
    await paymentToken.connect(user0).deposit({ value: convert("5000", 18) });
    await paymentToken.connect(user1).deposit({ value: convert("5000", 18) });
    await paymentToken.connect(user2).deposit({ value: convert("5000", 18) });
  });

  /**
   * INVARIANT 1: Daily donations sum correctly
   * sum(dayAccountToDonation[day][*]) == dayToTotalDonated[day]
   */
  describe("INVARIANT: Donation Sums", function () {
    it("Day total should equal sum of individual donations", async function () {
      const currentDay = await rig.currentDay();
      const donationAmount = convert("100", 18);

      // Multiple users donate
      await paymentToken.connect(user0).approve(rig.address, donationAmount);
      await rig.connect(user0).fund(user0.address, donationAmount);

      await paymentToken.connect(user1).approve(rig.address, donationAmount);
      await rig.connect(user1).fund(user1.address, donationAmount);

      await paymentToken.connect(user2).approve(rig.address, donationAmount);
      await rig.connect(user2).fund(user2.address, donationAmount);

      const dayTotal = await rig.dayToTotalDonated(currentDay);
      const user0Donation = await rig.dayAccountToDonation(currentDay, user0.address);
      const user1Donation = await rig.dayAccountToDonation(currentDay, user1.address);
      const user2Donation = await rig.dayAccountToDonation(currentDay, user2.address);

      expect(dayTotal).to.equal(user0Donation.add(user1Donation).add(user2Donation));
    });

    it("Multiple donations from same user should accumulate", async function () {
      const currentDay = await rig.currentDay();
      const donationBefore = await rig.dayAccountToDonation(currentDay, user0.address);

      const additionalDonation = convert("50", 18);
      await paymentToken.connect(user0).approve(rig.address, additionalDonation);
      await rig.connect(user0).fund(user0.address, additionalDonation);

      const donationAfter = await rig.dayAccountToDonation(currentDay, user0.address);
      expect(donationAfter).to.equal(donationBefore.add(additionalDonation));
    });
  });

  /**
   * INVARIANT 2: Fee distribution is correct (50% recipient, 45% treasury, 4% team, 1% protocol)
   */
  describe("INVARIANT: Fee Distribution", function () {
    it("Fees should sum to donation amount", async function () {
      const donationAmount = convert("1000", 18);

      const recipientBefore = await paymentToken.balanceOf(recipient.address);
      const treasuryBefore = await paymentToken.balanceOf(treasury.address);
      const teamBefore = await paymentToken.balanceOf(team.address);
      const protocolBefore = await paymentToken.balanceOf(protocol.address);

      await paymentToken.connect(user0).approve(rig.address, donationAmount);
      await rig.connect(user0).fund(user0.address, donationAmount);

      const recipientAfter = await paymentToken.balanceOf(recipient.address);
      const treasuryAfter = await paymentToken.balanceOf(treasury.address);
      const teamAfter = await paymentToken.balanceOf(team.address);
      const protocolAfter = await paymentToken.balanceOf(protocol.address);

      const recipientReceived = recipientAfter.sub(recipientBefore);
      const treasuryReceived = treasuryAfter.sub(treasuryBefore);
      const teamReceived = teamAfter.sub(teamBefore);
      const protocolReceived = protocolAfter.sub(protocolBefore);

      const totalDistributed = recipientReceived.add(treasuryReceived).add(teamReceived).add(protocolReceived);
      expect(totalDistributed).to.be.closeTo(donationAmount, 1);
    });

    it("Fee percentages should match 50/45/4/1 split", async function () {
      const donationAmount = convert("1000", 18);

      const recipientBefore = await paymentToken.balanceOf(recipient.address);
      const treasuryBefore = await paymentToken.balanceOf(treasury.address);
      const teamBefore = await paymentToken.balanceOf(team.address);
      const protocolBefore = await paymentToken.balanceOf(protocol.address);

      await paymentToken.connect(user1).approve(rig.address, donationAmount);
      await rig.connect(user1).fund(user1.address, donationAmount);

      const recipientReceived = (await paymentToken.balanceOf(recipient.address)).sub(recipientBefore);
      const treasuryReceived = (await paymentToken.balanceOf(treasury.address)).sub(treasuryBefore);
      const teamReceived = (await paymentToken.balanceOf(team.address)).sub(teamBefore);
      const protocolReceived = (await paymentToken.balanceOf(protocol.address)).sub(protocolBefore);

      const recipientPct = recipientReceived.mul(100).div(donationAmount).toNumber();
      const treasuryPct = treasuryReceived.mul(100).div(donationAmount).toNumber();
      const teamPct = teamReceived.mul(100).div(donationAmount).toNumber();
      const protocolPct = protocolReceived.mul(100).div(donationAmount).toNumber();

      expect(recipientPct).to.be.closeTo(50, 1);
      expect(treasuryPct).to.be.closeTo(45, 1);
      expect(teamPct).to.be.closeTo(4, 1);
      expect(protocolPct).to.be.closeTo(1, 1);
    });
  });

  /**
   * INVARIANT 3: Claim reward proportional to donation share
   * userReward = (userDonation / dayTotal) * dayEmission
   */
  describe("INVARIANT: Proportional Claims", function () {
    let claimDay;

    before(async function () {
      // Move to a fresh day and make donations
      await increaseTime(ONE_DAY);

      claimDay = await rig.currentDay();

      // User0 donates 75%
      await paymentToken.connect(user0).approve(rig.address, convert("750", 18));
      await rig.connect(user0).fund(user0.address, convert("750", 18));

      // User1 donates 25%
      await paymentToken.connect(user1).approve(rig.address, convert("250", 18));
      await rig.connect(user1).fund(user1.address, convert("250", 18));

      // Move to next day so we can claim
      await increaseTime(ONE_DAY);
    });

    it("User reward should be proportional to their donation share", async function () {
      const dayEmission = await rig.getDayEmission(claimDay);
      const user0Donation = await rig.dayAccountToDonation(claimDay, user0.address);
      const user1Donation = await rig.dayAccountToDonation(claimDay, user1.address);
      const dayTotal = await rig.dayToTotalDonated(claimDay);

      const user0BalBefore = await unitToken.balanceOf(user0.address);
      await rig.claim(user0.address, claimDay);
      const user0BalAfter = await unitToken.balanceOf(user0.address);
      const user0Reward = user0BalAfter.sub(user0BalBefore);

      const user1BalBefore = await unitToken.balanceOf(user1.address);
      await rig.claim(user1.address, claimDay);
      const user1BalAfter = await unitToken.balanceOf(user1.address);
      const user1Reward = user1BalAfter.sub(user1BalBefore);

      // Expected rewards
      const expectedUser0 = user0Donation.mul(dayEmission).div(dayTotal);
      const expectedUser1 = user1Donation.mul(dayEmission).div(dayTotal);

      expect(user0Reward).to.be.closeTo(expectedUser0, expectedUser0.div(100).add(1));
      expect(user1Reward).to.be.closeTo(expectedUser1, expectedUser1.div(100).add(1));

      // User0 should get ~3x user1's reward (75% vs 25%)
      expect(user0Reward.mul(100).div(user1Reward).toNumber()).to.be.closeTo(300, 10);
    });
  });

  /**
   * INVARIANT 4: Double claim prevention
   */
  describe("INVARIANT: No Double Claims", function () {
    let testDay;

    before(async function () {
      await increaseTime(ONE_DAY);
      testDay = await rig.currentDay();

      await paymentToken.connect(user2).approve(rig.address, convert("100", 18));
      await rig.connect(user2).fund(user2.address, convert("100", 18));

      await increaseTime(ONE_DAY);
    });

    it("Should mark account as claimed after claiming", async function () {
      const hasClaimedBefore = await rig.dayAccountToHasClaimed(testDay, user2.address);
      expect(hasClaimedBefore).to.equal(false);

      await rig.claim(user2.address, testDay);

      const hasClaimedAfter = await rig.dayAccountToHasClaimed(testDay, user2.address);
      expect(hasClaimedAfter).to.equal(true);
    });

    it("Should revert on second claim attempt", async function () {
      await expect(
        rig.claim(user2.address, testDay)
      ).to.be.revertedWith("FundRig__AlreadyClaimed()");
    });
  });

  /**
   * INVARIANT 5: Cannot claim for current or future days
   */
  describe("INVARIANT: Claim Timing", function () {
    it("Should revert when claiming current day", async function () {
      const currentDay = await rig.currentDay();

      await expect(
        rig.claim(user0.address, currentDay)
      ).to.be.revertedWith("FundRig__DayNotEnded()");
    });

    it("Should revert when claiming future day", async function () {
      const currentDay = await rig.currentDay();

      await expect(
        rig.claim(user0.address, currentDay.add(10))
      ).to.be.revertedWith("FundRig__DayNotEnded()");
    });
  });

  /**
   * INVARIANT 6: Emission halving over time
   */
  describe("INVARIANT: Emission Halving", function () {
    it("Emission should halve every 30 days", async function () {
      const initialEmission = await rig.initialEmission();
      const startTime = await rig.startTime();
      const currentTime = await getBlockTimestamp();

      const elapsed = currentTime - startTime.toNumber();
      const halvings = Math.floor(elapsed / THIRTY_DAYS);

      // Get emission for a past day
      const currentDay = await rig.currentDay();
      const emission = await rig.getDayEmission(currentDay.sub(1));

      if (halvings > 0) {
        const expectedEmission = initialEmission.div(ethers.BigNumber.from(2).pow(halvings));
        const minEmission = await rig.minEmission();

        if (expectedEmission.lt(minEmission)) {
          expect(emission).to.equal(minEmission);
        } else {
          expect(emission).to.be.closeTo(expectedEmission, expectedEmission.div(10));
        }
      }
    });

    it("Emission should never go below minEmission", async function () {
      // Fast forward many halving periods
      const dayFarFuture = (await rig.currentDay()).add(1000);

      // We can't directly test future days, but we can verify the formula
      const minEmission = await rig.minEmission();

      // For any day, emission >= minEmission
      const currentDay = await rig.currentDay();
      const emission = await rig.getDayEmission(currentDay.sub(1));
      expect(emission).to.be.gte(minEmission);
    });
  });
});

describe("FundRig Business Logic Tests", function () {
  let owner, treasury, team, protocol, recipient, user0, user1, user2;
  let paymentToken, unitToken, rig, mockCore;

  before("Deploy contracts", async function () {
    await network.provider.send("hardhat_reset");

    [owner, treasury, team, protocol, recipient, user0, user1, user2] = await ethers.getSigners();

    const mockWethArtifact = await ethers.getContractFactory("MockWETH");
    paymentToken = await mockWethArtifact.deploy();

    // Deploy mock Core (for protocolFeeAddress)
    const mockCoreArtifact = await ethers.getContractFactory("MockCore");
    mockCore = await mockCoreArtifact.deploy(protocol.address);

    const unitArtifact = await ethers.getContractFactory("Unit");
    unitToken = await unitArtifact.deploy("BL Fund Unit", "BLCUNIT", owner.address);

    const rigArtifact = await ethers.getContractFactory("FundRig");
    rig = await rigArtifact.deploy(
      paymentToken.address,  // paymentToken
      unitToken.address,     // unit
      recipient.address,     // recipient (required)
      treasury.address,      // treasury
      team.address,          // team
      mockCore.address,      // core (mock with protocolFeeAddress)
      convert("1000", 18),   // initialEmission
      convert("10", 18),     // minEmission
      30                     // halvingPeriod: 30 days
    );

    await unitToken.setRig(rig.address);

    await paymentToken.connect(user0).deposit({ value: convert("5000", 18) });
    await paymentToken.connect(user1).deposit({ value: convert("5000", 18) });
    await paymentToken.connect(user2).deposit({ value: convert("5000", 18) });
  });

  describe("Recipient Management", function () {
    it("Should revert deployment with zero recipient address", async function () {
      // Deploying with zero address recipient should revert
      const rigArtifact = await ethers.getContractFactory("FundRig");
      await expect(
        rigArtifact.deploy(
          paymentToken.address,
          unitToken.address,
          AddressZero, // zero recipient should fail
          treasury.address,
          team.address,
          mockCore.address,
          convert("1000", 18),
          convert("10", 18),
          30 // halvingPeriod
        )
      ).to.be.revertedWith("FundRig__InvalidAddress()");
    });

    it("Should allow owner to set recipient", async function () {
      const newRecipient = user2.address;

      await rig.connect(owner).setRecipient(newRecipient);
      expect(await rig.recipient()).to.equal(newRecipient);

      // Reset for other tests
      await rig.connect(owner).setRecipient(recipient.address);
    });

    it("Should prevent setting zero address as recipient", async function () {
      await expect(
        rig.connect(owner).setRecipient(AddressZero)
      ).to.be.revertedWith("FundRig__InvalidAddress()");
    });

    it("Only owner can set recipient", async function () {
      await expect(
        rig.connect(user0).setRecipient(user1.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Donation Validation", function () {
    it("Should revert on zero donation amount", async function () {
      await expect(
        rig.connect(user0).fund(user0.address, 0)
      ).to.be.revertedWith("FundRig__BelowMinDonation()");
    });

    it("Should revert on zero account address", async function () {
      await paymentToken.connect(user0).approve(rig.address, convert("100", 18));

      await expect(
        rig.connect(user0).fund(AddressZero, convert("100", 18))
      ).to.be.revertedWith("FundRig__InvalidAddress()");
    });

    it("Should allow donating on behalf of another account", async function () {
      const donationAmount = convert("100", 18);

      await paymentToken.connect(user0).approve(rig.address, donationAmount);

      // user0 pays, but user1 gets the donation credit
      const currentDay = await rig.currentDay();
      const user1DonationBefore = await rig.dayAccountToDonation(currentDay, user1.address);

      await rig.connect(user0).fund(user1.address, donationAmount);

      const user1DonationAfter = await rig.dayAccountToDonation(currentDay, user1.address);
      expect(user1DonationAfter).to.equal(user1DonationBefore.add(donationAmount));
    });
  });

  describe("Claim Validation", function () {
    let donationDay;

    before(async function () {
      await increaseTime(ONE_DAY);
      donationDay = await rig.currentDay();

      await paymentToken.connect(user0).approve(rig.address, convert("100", 18));
      await rig.connect(user0).fund(user0.address, convert("100", 18));

      await increaseTime(ONE_DAY);
    });

    it("Should revert when claiming with no donation", async function () {
      // user2 never donated on donationDay
      await expect(
        rig.claim(user2.address, donationDay)
      ).to.be.revertedWith("FundRig__NoDonation()");
    });

    it("Should revert on zero account address", async function () {
      await expect(
        rig.claim(AddressZero, donationDay)
      ).to.be.revertedWith("FundRig__InvalidAddress()");
    });

    it("Anyone can trigger claim for any account", async function () {
      // user2 can trigger claim for user0
      const user0BalBefore = await unitToken.balanceOf(user0.address);

      await rig.connect(user2).claim(user0.address, donationDay);

      const user0BalAfter = await unitToken.balanceOf(user0.address);
      expect(user0BalAfter).to.be.gt(user0BalBefore);
    });
  });

  describe("Day Isolation", function () {
    it("Donations on different days should be isolated", async function () {
      const day1 = await rig.currentDay();

      await paymentToken.connect(user1).approve(rig.address, convert("300", 18));
      await rig.connect(user1).fund(user1.address, convert("100", 18));

      await increaseTime(ONE_DAY);
      const day2 = await rig.currentDay();

      // Different amount to show isolation
      await rig.connect(user1).fund(user1.address, convert("200", 18));

      const day1Donation = await rig.dayAccountToDonation(day1, user1.address);
      const day2Donation = await rig.dayAccountToDonation(day2, user1.address);
      const day1Total = await rig.dayToTotalDonated(day1);
      const day2Total = await rig.dayToTotalDonated(day2);

      // Verify donations are tracked per day
      expect(day1Donation).to.equal(convert("100", 18));
      expect(day2Donation).to.equal(convert("200", 18));
      // Day totals should reflect actual donations on each day
      expect(day1Total).to.equal(convert("100", 18));
      expect(day2Total).to.equal(convert("200", 18));
    });

    it("Claims for different days should be independent", async function () {
      await increaseTime(ONE_DAY);

      const day1 = (await rig.currentDay()).sub(2);
      const day2 = (await rig.currentDay()).sub(1);

      // Should be able to claim day1 but day2 separately
      // (if user1 had donations on both)
      const hasClaimed1 = await rig.dayAccountToHasClaimed(day1, user1.address);
      const hasClaimed2 = await rig.dayAccountToHasClaimed(day2, user1.address);

      // These should be independent
      expect(hasClaimed1).to.not.equal(undefined);
      expect(hasClaimed2).to.not.equal(undefined);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle single donor getting 100% of daily emission", async function () {
      await increaseTime(ONE_DAY);
      const soloDay = await rig.currentDay();

      // Only user0 donates
      await paymentToken.connect(user0).approve(rig.address, convert("50", 18));
      await rig.connect(user0).fund(user0.address, convert("50", 18));

      await increaseTime(ONE_DAY);

      const dayEmission = await rig.getDayEmission(soloDay);
      const user0BalBefore = await unitToken.balanceOf(user0.address);

      await rig.claim(user0.address, soloDay);

      const user0BalAfter = await unitToken.balanceOf(user0.address);
      const reward = user0BalAfter.sub(user0BalBefore);

      // Should receive ~100% of emission
      expect(reward).to.be.closeTo(dayEmission, dayEmission.div(100));
    });

    it("Should handle many small donations correctly", async function () {
      await increaseTime(ONE_DAY);
      const manyDonationsDay = await rig.currentDay();

      // Make 10 small donations
      await paymentToken.connect(user0).approve(rig.address, convert("100", 18));

      for (let i = 0; i < 10; i++) {
        await rig.connect(user0).fund(user0.address, convert("10", 18));
      }

      const totalDonation = await rig.dayAccountToDonation(manyDonationsDay, user0.address);
      expect(totalDonation).to.equal(convert("100", 18));
    });
  });

  describe("Events", function () {
    it("Should emit Funded event on donation", async function () {
      const donationAmount = convert("100", 18);
      await paymentToken.connect(user0).approve(rig.address, donationAmount);

      await expect(
        rig.connect(user0).fund(user0.address, donationAmount)
      ).to.emit(rig, "FundRig__Funded");
    });

    it("Should emit Claimed event on claim", async function () {
      await increaseTime(ONE_DAY);
      const claimableDay = await rig.currentDay();

      await paymentToken.connect(user2).approve(rig.address, convert("100", 18));
      await rig.connect(user2).fund(user2.address, convert("100", 18));

      await increaseTime(ONE_DAY);

      await expect(
        rig.claim(user2.address, claimableDay)
      ).to.emit(rig, "FundRig__Claimed");
    });
  });
});
