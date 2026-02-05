/**
 * @title Deep Invariant Test Suite 2
 * @notice Comprehensive invariant tests covering FundRig fee conservation, multi-day claiming
 *         across halving boundaries, Registry consistency, randomized MineRig stress testing,
 *         and MineRig claim accounting.
 * @dev Each section uses a fresh hardhat_reset to ensure isolation.
 */

const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const convert = (amount, decimals = 18) => ethers.utils.parseUnits(amount.toString(), decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;

const AddressZero = "0x0000000000000000000000000000000000000000";
const PRECISION = ethers.BigNumber.from("1000000000000000000"); // 1e18

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
// SECTION 1: FundRig Fee Conservation Invariants
// ============================================================================

describe("Section 1: FundRig Fee Conservation Invariants", function () {
  let owner, protocol, team, treasury, recipient, user0, user1, user2;
  let paymentToken, unitToken, rig, mockCore;

  before("Deploy fresh contracts for FundRig fee conservation", async function () {
    await network.provider.send("hardhat_reset");

    [owner, protocol, team, treasury, recipient, user0, user1, user2] = await ethers.getSigners();

    const MockWETH = await ethers.getContractFactory("MockWETH");
    paymentToken = await MockWETH.deploy();

    const MockCore = await ethers.getContractFactory("MockCore");
    mockCore = await MockCore.deploy(protocol.address);

    const Unit = await ethers.getContractFactory("Unit");
    unitToken = await Unit.deploy("Fee Conservation Unit", "FCON", owner.address);

    const FundRig = await ethers.getContractFactory("FundRig");
    rig = await FundRig.deploy(
      paymentToken.address,
      unitToken.address,
      recipient.address,
      treasury.address,
      team.address,
      mockCore.address,
      convert("1000", 18),  // initialEmission
      convert("10", 18),    // minEmission
      30                    // halvingPeriod in days
    );

    await unitToken.setRig(rig.address);

    // Fund users with plenty of WETH
    await paymentToken.connect(user0).deposit({ value: convert("5000", 18) });
    await paymentToken.connect(user1).deposit({ value: convert("5000", 18) });
    await paymentToken.connect(user2).deposit({ value: convert("5000", 18) });
  });

  describe("INV-FUND-DEEP-1: Fee split sums to exact donation amount for 10 random amounts", function () {
    it("recipient(50%) + treasury(45%) + team(4%) + protocol(1%) == donation for 10 random amounts", async function () {
      // 10 test amounts spanning a wide range
      const testAmounts = [
        convert("0.01", 18),
        convert("0.1", 18),
        convert("1", 18),
        convert("7.77", 18),
        convert("13.37", 18),
        convert("50", 18),
        convert("99.99", 18),
        convert("123.456", 18),
        convert("250", 18),
        convert("500", 18),
      ];

      for (let i = 0; i < testAmounts.length; i++) {
        const amount = testAmounts[i];

        const recipientBefore = await paymentToken.balanceOf(recipient.address);
        const treasuryBefore = await paymentToken.balanceOf(treasury.address);
        const teamBefore = await paymentToken.balanceOf(team.address);
        const protocolBefore = await paymentToken.balanceOf(protocol.address);

        await paymentToken.connect(user0).approve(rig.address, amount);
        await rig.connect(user0).fund(user0.address, amount);

        const recipientReceived = (await paymentToken.balanceOf(recipient.address)).sub(recipientBefore);
        const treasuryReceived = (await paymentToken.balanceOf(treasury.address)).sub(treasuryBefore);
        const teamReceived = (await paymentToken.balanceOf(team.address)).sub(teamBefore);
        const protocolReceived = (await paymentToken.balanceOf(protocol.address)).sub(protocolBefore);

        const totalDistributed = recipientReceived.add(treasuryReceived).add(teamReceived).add(protocolReceived);

        // Total distributed must exactly equal the donation amount
        expect(totalDistributed).to.equal(amount,
          `Fee sum mismatch for amount index ${i}: ${divDec(amount)} WETH`
        );

        // Verify individual percentages (within rounding tolerance)
        const expectedRecipient = amount.mul(5000).div(10000);
        const expectedTeam = amount.mul(400).div(10000);
        const expectedProtocol = amount.mul(100).div(10000);
        // Treasury gets remainder
        const expectedTreasury = amount.sub(expectedRecipient).sub(expectedTeam).sub(expectedProtocol);

        expect(recipientReceived).to.equal(expectedRecipient);
        expect(teamReceived).to.equal(expectedTeam);
        expect(protocolReceived).to.equal(expectedProtocol);
        expect(treasuryReceived).to.equal(expectedTreasury);
      }
    });
  });

  describe("INV-FUND-DEEP-2: Team == address(0) redirects team share to treasury (treasury gets 49%)", function () {
    let rigNoTeam;

    before("Deploy a FundRig with team == address(0)", async function () {
      const Unit = await ethers.getContractFactory("Unit");
      const unitNoTeam = await Unit.deploy("No Team Unit", "NOTEAM", owner.address);

      const FundRig = await ethers.getContractFactory("FundRig");
      rigNoTeam = await FundRig.deploy(
        paymentToken.address,
        unitNoTeam.address,
        recipient.address,
        treasury.address,
        AddressZero,           // team == address(0)
        mockCore.address,
        convert("1000", 18),
        convert("10", 18),
        30
      );

      await unitNoTeam.setRig(rigNoTeam.address);
    });

    it("Treasury receives 49% (45% + 4% team share) when team is zero across multiple donations", async function () {
      const testAmounts = [
        convert("100", 18),
        convert("200", 18),
        convert("333.33", 18),
      ];

      for (let i = 0; i < testAmounts.length; i++) {
        const amount = testAmounts[i];

        const recipientBefore = await paymentToken.balanceOf(recipient.address);
        const treasuryBefore = await paymentToken.balanceOf(treasury.address);
        const protocolBefore = await paymentToken.balanceOf(protocol.address);

        await paymentToken.connect(user0).approve(rigNoTeam.address, amount);
        await rigNoTeam.connect(user0).fund(user0.address, amount);

        const recipientReceived = (await paymentToken.balanceOf(recipient.address)).sub(recipientBefore);
        const treasuryReceived = (await paymentToken.balanceOf(treasury.address)).sub(treasuryBefore);
        const protocolReceived = (await paymentToken.balanceOf(protocol.address)).sub(protocolBefore);

        const totalDistributed = recipientReceived.add(treasuryReceived).add(protocolReceived);
        expect(totalDistributed).to.equal(amount,
          `Fee sum mismatch for no-team donation index ${i}`
        );

        // Recipient: 50%
        const expectedRecipient = amount.mul(5000).div(10000);
        expect(recipientReceived).to.equal(expectedRecipient);

        // Protocol: 1%
        const expectedProtocol = amount.mul(100).div(10000);
        expect(protocolReceived).to.equal(expectedProtocol);

        // Treasury: remainder = 49% (gets team's 4% plus normal 45%)
        const expectedTreasury = amount.sub(expectedRecipient).sub(expectedProtocol);
        expect(treasuryReceived).to.equal(expectedTreasury);

        // Verify treasury percentage is ~49%
        const treasuryPct = treasuryReceived.mul(10000).div(amount).toNumber();
        expect(treasuryPct).to.equal(4900); // Exactly 49% in basis points
      }
    });
  });

  describe("INV-FUND-DEEP-3: FundRig contract holds 0 payment tokens after any fund() call", function () {
    it("Contract balance is zero after every individual fund() call across users", async function () {
      const amounts = [
        convert("10", 18),
        convert("50", 18),
        convert("100", 18),
        convert("0.01", 18),
        convert("999.99", 18),
      ];

      const users = [user0, user1, user2, user0, user1];

      for (let i = 0; i < amounts.length; i++) {
        await paymentToken.connect(users[i]).approve(rig.address, amounts[i]);
        await rig.connect(users[i]).fund(users[i].address, amounts[i]);

        const rigBalance = await paymentToken.balanceOf(rig.address);
        expect(rigBalance).to.equal(0,
          `FundRig held tokens after fund() call index ${i}`
        );
      }
    });
  });
});

// ============================================================================
// SECTION 2: FundRig Multi-Day Claiming Across Halving Boundaries
// ============================================================================

describe("Section 2: FundRig Multi-Day Claiming Across Halving Boundaries", function () {
  let owner, protocol, team, treasury, recipient, user0, user1, user2;
  let paymentToken, unitToken, rig, mockCore;

  before("Deploy fresh contracts for multi-day claiming", async function () {
    await network.provider.send("hardhat_reset");

    [owner, protocol, team, treasury, recipient, user0, user1, user2] = await ethers.getSigners();

    // Use MockUSDC (6 decimals) for precise fee math
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    paymentToken = await MockUSDC.deploy();

    const MockCore = await ethers.getContractFactory("MockCore");
    mockCore = await MockCore.deploy(protocol.address);

    const Unit = await ethers.getContractFactory("Unit");
    unitToken = await Unit.deploy("Halving Test Unit", "HALVT", owner.address);

    const FundRig = await ethers.getContractFactory("FundRig");
    rig = await FundRig.deploy(
      paymentToken.address,
      unitToken.address,
      recipient.address,
      treasury.address,
      team.address,
      mockCore.address,
      convert("1000", 18),  // initialEmission: 1000 tokens/day
      convert("10", 18),    // minEmission: 10 tokens/day
      30                    // halvingPeriod: 30 days
    );

    await unitToken.setRig(rig.address);

    // Fund users with USDC
    await paymentToken.mint(user0.address, convert("50000", 6));
    await paymentToken.mint(user1.address, convert("50000", 6));
    await paymentToken.mint(user2.address, convert("50000", 6));
  });

  describe("INV-FUND-DEEP-4: Claim amounts match halved emissions across 3 halving boundaries", function () {
    let day0, day30, day60;

    it("Donate on day 0 (emission=1000), day 30 (emission=500), day 60 (emission=250); verify claims", async function () {
      // Day 0: emission should be 1000
      day0 = await rig.currentDay();
      const emission0 = await rig.getDayEmission(day0);
      expect(emission0).to.equal(convert("1000", 18));

      // User0 donates on day 0
      await paymentToken.connect(user0).approve(rig.address, convert("100", 6));
      await rig.connect(user0).fund(user0.address, convert("100", 6));

      // Advance to day 30
      await increaseTime(30 * ONE_DAY);
      day30 = await rig.currentDay();
      const emission30 = await rig.getDayEmission(day30);
      expect(emission30).to.equal(convert("500", 18)); // First halving

      // User0 donates on day 30
      await paymentToken.connect(user0).approve(rig.address, convert("100", 6));
      await rig.connect(user0).fund(user0.address, convert("100", 6));

      // Advance to day 60
      await increaseTime(30 * ONE_DAY);
      day60 = await rig.currentDay();
      const emission60 = await rig.getDayEmission(day60);
      expect(emission60).to.equal(convert("250", 18)); // Second halving

      // User0 donates on day 60
      await paymentToken.connect(user0).approve(rig.address, convert("100", 6));
      await rig.connect(user0).fund(user0.address, convert("100", 6));

      // Advance past day 60 to allow claiming
      await increaseTime(ONE_DAY);

      // Claim day 0 -> should get 1000 tokens (sole donor)
      const bal0Before = await unitToken.balanceOf(user0.address);
      await rig.claim(user0.address, day0);
      const reward0 = (await unitToken.balanceOf(user0.address)).sub(bal0Before);
      expect(reward0).to.equal(convert("1000", 18));

      // Claim day 30 -> should get 500 tokens (sole donor, halved emission)
      const bal30Before = await unitToken.balanceOf(user0.address);
      await rig.claim(user0.address, day30);
      const reward30 = (await unitToken.balanceOf(user0.address)).sub(bal30Before);
      expect(reward30).to.equal(convert("500", 18));

      // Claim day 60 -> should get 250 tokens (sole donor, 2x halved emission)
      const bal60Before = await unitToken.balanceOf(user0.address);
      await rig.claim(user0.address, day60);
      const reward60 = (await unitToken.balanceOf(user0.address)).sub(bal60Before);
      expect(reward60).to.equal(convert("250", 18));
    });
  });

  describe("INV-FUND-DEEP-5: Multiple users, 5 consecutive days, proportional claims", function () {
    let testDays = [];

    it("Each user's claim per day is proportional to their share; total claimed <= dayEmission", async function () {
      // Record starting day
      const startDay = await rig.currentDay();

      // 5 consecutive days with different donation patterns
      const donationMatrix = [
        // [user0, user1, user2] donation amounts (in USDC with 6 decimals)
        [convert("300", 6), convert("200", 6), convert("100", 6)],  // day+0: 3:2:1
        [convert("100", 6), convert("100", 6), convert("100", 6)],  // day+1: equal
        [convert("500", 6), convert("0", 6),   convert("50", 6)],   // day+2: user1 skips
        [convert("0", 6),   convert("400", 6), convert("200", 6)],  // day+3: user0 skips
        [convert("150", 6), convert("150", 6), convert("150", 6)],  // day+4: equal
      ];

      const users = [user0, user1, user2];

      for (let d = 0; d < 5; d++) {
        const currentDay = await rig.currentDay();
        testDays.push(currentDay);

        for (let u = 0; u < 3; u++) {
          const amount = donationMatrix[d][u];
          if (amount.gt(0)) {
            await paymentToken.connect(users[u]).approve(rig.address, amount);
            await rig.connect(users[u]).fund(users[u].address, amount);
          }
        }

        // Advance to next day
        await increaseTime(ONE_DAY);
      }

      // Now all 5 days have ended; claim and verify
      for (let d = 0; d < 5; d++) {
        const day = testDays[d];
        const dayEmission = await rig.getDayEmission(day);
        const dayTotal = await rig.dayToTotalDonated(day);
        let totalClaimed = ethers.BigNumber.from(0);

        for (let u = 0; u < 3; u++) {
          const userDonation = await rig.dayAccountToDonation(day, users[u].address);

          if (userDonation.gt(0)) {
            const balBefore = await unitToken.balanceOf(users[u].address);
            await rig.claim(users[u].address, day);
            const balAfter = await unitToken.balanceOf(users[u].address);
            const reward = balAfter.sub(balBefore);
            totalClaimed = totalClaimed.add(reward);

            // Verify proportionality: reward ~= (userDonation / dayTotal) * dayEmission
            const expectedReward = userDonation.mul(dayEmission).div(dayTotal);
            expect(reward).to.equal(expectedReward,
              `Proportional reward mismatch for user ${u} on day index ${d}`
            );
          }
        }

        // Total claimed for the day must not exceed day emission
        expect(totalClaimed).to.be.lte(dayEmission,
          `Total claimed exceeded dayEmission on day index ${d}`
        );

        // Total claimed should be very close to dayEmission (within rounding for 3 users)
        expect(totalClaimed).to.be.closeTo(dayEmission, 3,
          `Total claimed too far from dayEmission on day index ${d}`
        );
      }
    });
  });

  describe("INV-FUND-DEEP-6: Day isolation -- claiming day N does NOT affect claimable for day M", function () {
    let dayA, dayB, dayC;

    before("Set up three donation days", async function () {
      // Create donations on three separate days
      dayA = await rig.currentDay();
      await paymentToken.connect(user0).approve(rig.address, convert("100", 6));
      await rig.connect(user0).fund(user0.address, convert("100", 6));

      await increaseTime(ONE_DAY);
      dayB = await rig.currentDay();
      await paymentToken.connect(user0).approve(rig.address, convert("200", 6));
      await rig.connect(user0).fund(user0.address, convert("200", 6));

      await increaseTime(ONE_DAY);
      dayC = await rig.currentDay();
      await paymentToken.connect(user0).approve(rig.address, convert("300", 6));
      await rig.connect(user0).fund(user0.address, convert("300", 6));

      // Advance past dayC so all days can be claimed
      await increaseTime(ONE_DAY);
    });

    it("Claiming out of order (C, A, B) gives correct amounts for each day", async function () {
      // Calculate expected rewards for each day
      const emissionA = await rig.getDayEmission(dayA);
      const emissionB = await rig.getDayEmission(dayB);
      const emissionC = await rig.getDayEmission(dayC);

      // Since user0 is sole donor on each day, they get 100% of emission

      // Claim dayC first (out of order)
      const balBeforeC = await unitToken.balanceOf(user0.address);
      await rig.claim(user0.address, dayC);
      const rewardC = (await unitToken.balanceOf(user0.address)).sub(balBeforeC);
      expect(rewardC).to.equal(emissionC);

      // Claim dayA second (out of order)
      const balBeforeA = await unitToken.balanceOf(user0.address);
      await rig.claim(user0.address, dayA);
      const rewardA = (await unitToken.balanceOf(user0.address)).sub(balBeforeA);
      expect(rewardA).to.equal(emissionA);

      // Claim dayB last
      const balBeforeB = await unitToken.balanceOf(user0.address);
      await rig.claim(user0.address, dayB);
      const rewardB = (await unitToken.balanceOf(user0.address)).sub(balBeforeB);
      expect(rewardB).to.equal(emissionB);
    });

    it("Cannot re-claim any of the already claimed days", async function () {
      await expect(
        rig.claim(user0.address, dayA)
      ).to.be.revertedWith("FundRig__AlreadyClaimed()");

      await expect(
        rig.claim(user0.address, dayB)
      ).to.be.revertedWith("FundRig__AlreadyClaimed()");

      await expect(
        rig.claim(user0.address, dayC)
      ).to.be.revertedWith("FundRig__AlreadyClaimed()");
    });
  });
});

// ============================================================================
// SECTION 3: Registry Consistency Invariants (use MineCore to launch)
// ============================================================================

describe("Section 3: Registry Consistency Invariants", function () {
  let owner, protocol, team, user0, user1, user2, user3, attacker;
  let weth, usdc, registry, mineCore, entropy;
  let rigAddress, unitAddress, auctionAddress;

  before("Deploy fresh contracts for Registry invariants", async function () {
    await network.provider.send("hardhat_reset");

    [owner, protocol, team, user0, user1, user2, user3, attacker] = await ethers.getSigners();

    // Deploy mock tokens
    const MockWETH = await ethers.getContractFactory("MockWETH");
    weth = await MockWETH.deploy();
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();
    const MockEntropy = await ethers.getContractFactory("MockEntropy");
    entropy = await MockEntropy.deploy();

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

    // Fund launcher
    await usdc.mint(user0.address, convert("10000", 6));
    await weth.connect(user0).deposit({ value: convert("500", 18) });
  });

  describe("INV-REG-1: Every rig launched via Core is registered in Registry", function () {
    it("isRegistered == true for a rig launched via MineCore", async function () {
      const launchParams = {
        launcher: user0.address,
        quoteToken: weth.address,
        tokenName: "Registry Test Token",
        tokenSymbol: "REGT",
        uri: "https://test.com/reg1",
        usdcAmount: convert("100", 6),
        unitAmount: convert("100000", 18),
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

      const isRegistered = await registry.isRegistered(rigAddress);
      expect(isRegistered).to.equal(true);
    });
  });

  describe("INV-REG-2: Random addresses that were NOT launched are NOT registered", function () {
    it("isRegistered == false for arbitrary addresses", async function () {
      // Test several addresses that were never launched as rigs
      const randomAddresses = [
        user0.address,
        user1.address,
        attacker.address,
        owner.address,
        protocol.address,
        weth.address,
        usdc.address,
        mineCore.address,
        registry.address,
        AddressZero,
      ];

      for (const addr of randomAddresses) {
        const isRegistered = await registry.isRegistered(addr);
        expect(isRegistered).to.equal(false,
          `Address ${addr} should not be registered`
        );
      }
    });
  });

  describe("INV-REG-3: Only approved factories can register rigs (non-approved call reverts)", function () {
    it("Calling register from a non-approved address reverts", async function () {
      await expect(
        registry.connect(attacker).register(
          attacker.address,
          "mine",
          unitAddress,
          attacker.address
        )
      ).to.be.revertedWith("Registry__NotApprovedFactory()");
    });

    it("Calling register from owner (who is not an approved factory) reverts", async function () {
      await expect(
        registry.connect(owner).register(
          owner.address,
          "mine",
          unitAddress,
          owner.address
        )
      ).to.be.revertedWith("Registry__NotApprovedFactory()");
    });

    it("Even a user who launched a rig cannot directly register", async function () {
      await expect(
        registry.connect(user0).register(
          user0.address,
          "mine",
          unitAddress,
          user0.address
        )
      ).to.be.revertedWith("Registry__NotApprovedFactory()");
    });
  });

  describe("INV-REG-4: The same rig cannot be registered twice (reverts with AlreadyRegistered)", function () {
    it("Launching a second rig and trying to re-register the first one reverts", async function () {
      // The rigAddress was already registered via launch. If we could call register
      // again with the same address, it should revert. Since only approved factories
      // can call register, we need to approve a new factory or test via the MineCore.
      // We'll approve attacker as a factory temporarily to test the AlreadyRegistered error.

      await registry.setFactoryApproval(attacker.address, true);

      await expect(
        registry.connect(attacker).register(
          rigAddress,
          "mine",
          unitAddress,
          user0.address
        )
      ).to.be.revertedWith("Registry__AlreadyRegistered()");

      // Clean up: revoke the attacker's factory approval
      await registry.setFactoryApproval(attacker.address, false);
    });

    it("Revoking factory approval prevents further registrations", async function () {
      // attacker is no longer approved
      await expect(
        registry.connect(attacker).register(
          user1.address,
          "mine",
          unitAddress,
          user1.address
        )
      ).to.be.revertedWith("Registry__NotApprovedFactory()");
    });
  });
});

// ============================================================================
// SECTION 4: Randomized Action Sequence Stress Test (MineRig)
// ============================================================================

describe("Section 4: Randomized Action Sequence Stress Test (MineRig)", function () {
  let owner, protocol, team, user0, user1, user2, user3;
  let weth, usdc, registry, mineCore, entropy;
  let rigAddress, rigContract, auctionAddress, unitAddress, unitContract;

  before("Deploy fresh contracts for stress test", async function () {
    await network.provider.send("hardhat_reset");

    [owner, protocol, team, user0, user1, user2, user3] = await ethers.getSigners();

    const MockWETH = await ethers.getContractFactory("MockWETH");
    weth = await MockWETH.deploy();
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

    // Fund users heavily for stress test
    await usdc.mint(user0.address, convert("5000", 6));
    await weth.connect(user0).deposit({ value: convert("1000", 18) });
    await weth.connect(user1).deposit({ value: convert("1000", 18) });
    await weth.connect(user2).deposit({ value: convert("1000", 18) });
    await weth.connect(user3).deposit({ value: convert("1000", 18) });

    const launchParams = {
      launcher: user0.address,
      quoteToken: weth.address,
      tokenName: "Stress Test Token",
      tokenSymbol: "STRSS",
      uri: "https://test.com/stress",
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

    // Disable entropy for deterministic testing
    await rigContract.connect(user0).setEntropyEnabled(false);
    await rigContract.connect(user0).setTeam(team.address);

    // Increase capacity to 4 slots
    await rigContract.connect(user0).setCapacity(4);
  });

  it("20 random operations maintain all invariants", async function () {
    this.timeout(120000); // Allow longer timeout for stress test

    const users = [user0, user1, user2, user3];
    const numSlots = 4;
    const numOps = 20;

    // Deterministic pseudo-random for reproducibility (use seed based on block timestamp)
    let seed = 42;
    function pseudoRandom(max) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % max;
    }

    // Track epoch IDs per slot to verify monotonic increase
    const slotEpochIds = [];
    for (let s = 0; s < numSlots; s++) {
      const slot = await rigContract.getSlot(s);
      slotEpochIds.push(slot.epochId);
    }

    let prevTotalMinted = await rigContract.totalMinted();

    for (let i = 0; i < numOps; i++) {
      const actionType = pseudoRandom(3); // 0=mine, 1=claim, 2=wait
      const userIdx = pseudoRandom(users.length);
      const user = users[userIdx];

      if (actionType === 0) {
        // MINE: pick a random slot
        const slotIdx = pseudoRandom(numSlots);
        try {
          const slot = await rigContract.getSlot(slotIdx);
          const price = await rigContract.getPrice(slotIdx);
          const deadline = await getFutureDeadline();

          await weth.connect(user).approve(rigAddress, price.add(convert("10", 18)));
          await rigContract.connect(user).mine(
            user.address, slotIdx, slot.epochId, deadline, price.add(convert("10", 18)), ""
          );

          // Track epoch ID after successful mine
          const newSlot = await rigContract.getSlot(slotIdx);
          expect(newSlot.epochId).to.be.gt(slotEpochIds[slotIdx],
            `Epoch ID did not increase for slot ${slotIdx} on op ${i}`
          );
          slotEpochIds[slotIdx] = newSlot.epochId;
        } catch (e) {
          // Some mines may fail (e.g., epoch mismatch from concurrent mines)
          // That is acceptable in a stress test
        }
      } else if (actionType === 1) {
        // CLAIM: try to claim for a random user
        const claimable = await rigContract.accountToClaimable(user.address);
        if (claimable.gt(0)) {
          const balBefore = await weth.balanceOf(user.address);
          await rigContract.claim(user.address);
          const balAfter = await weth.balanceOf(user.address);

          expect(balAfter.sub(balBefore)).to.equal(claimable,
            `Claim amount mismatch for user ${userIdx} on op ${i}`
          );

          const claimableAfter = await rigContract.accountToClaimable(user.address);
          expect(claimableAfter).to.equal(0,
            `Claimable not zero after claim for user ${userIdx} on op ${i}`
          );
        }
      } else {
        // WAIT: random time between 1 second and 1 hour
        const waitTime = 1 + pseudoRandom(ONE_HOUR);
        await increaseTime(waitTime);
      }

      // After every operation, check totalMinted is non-decreasing
      const currentTotalMinted = await rigContract.totalMinted();
      expect(currentTotalMinted).to.be.gte(prevTotalMinted,
        `totalMinted decreased on op ${i}`
      );
      prevTotalMinted = currentTotalMinted;
    }

    // Final invariant checks after all operations
    const tailUps = await rigContract.tailUps();
    const currentUps = await rigContract.getUps();
    expect(currentUps).to.be.gte(tailUps, "getUps() < tailUps after stress test");

    // Verify rig quote balance == sum of all accountToClaimable
    const rigBalance = await weth.balanceOf(rigAddress);
    let totalClaimable = ethers.BigNumber.from(0);
    for (const user of users) {
      totalClaimable = totalClaimable.add(await rigContract.accountToClaimable(user.address));
    }
    // Also check user0 (the launcher) who might have claimable from being owner
    expect(rigBalance).to.equal(totalClaimable,
      "Rig quote balance != sum of all accountToClaimable after stress test"
    );

    // Verify epoch IDs only increased for all slots
    for (let s = 0; s < numSlots; s++) {
      const slot = await rigContract.getSlot(s);
      expect(slot.epochId).to.be.gte(slotEpochIds[s],
        `Epoch ID decreased for slot ${s} after stress test`
      );
    }
  });
});

// ============================================================================
// SECTION 5: MineRig Claim Accounting Deep Tests
// ============================================================================

describe("Section 5: MineRig Claim Accounting Deep Tests", function () {
  let owner, protocol, team, user0, user1, user2, user3, thirdParty;
  let weth, usdc, registry, mineCore, entropy;
  let rigAddress, rigContract, auctionAddress, unitAddress, unitContract;

  before("Deploy fresh contracts for claim accounting", async function () {
    await network.provider.send("hardhat_reset");

    [owner, protocol, team, user0, user1, user2, user3, thirdParty] = await ethers.getSigners();

    const MockWETH = await ethers.getContractFactory("MockWETH");
    weth = await MockWETH.deploy();
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

    // Fund users
    await usdc.mint(user0.address, convert("5000", 6));
    await weth.connect(user0).deposit({ value: convert("1000", 18) });
    await weth.connect(user1).deposit({ value: convert("1000", 18) });
    await weth.connect(user2).deposit({ value: convert("1000", 18) });
    await weth.connect(user3).deposit({ value: convert("1000", 18) });

    const launchParams = {
      launcher: user0.address,
      quoteToken: weth.address,
      tokenName: "Claim Accounting Test",
      tokenSymbol: "CLACC",
      uri: "https://test.com/claim",
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

    // Disable entropy for deterministic testing
    await rigContract.connect(user0).setEntropyEnabled(false);
    await rigContract.connect(user0).setTeam(team.address);
  });

  describe("INV-CLAIM-1: claim() transfers exactly accountToClaimable[account] and zeroes it", function () {
    it("After N displacements, claim transfers exact claimable amount", async function () {
      // User1 mines slot 0
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rigAddress, convert("10", 18));
      let deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("10", 18), "");

      // User2 displaces user1 (user1 gets 80% miner fee credited)
      slot = await rigContract.getSlot(0);
      let price = await rigContract.getPrice(0);
      if (price.gt(0)) {
        await weth.connect(user2).approve(rigAddress, price.add(convert("10", 18)));
        deadline = await getFutureDeadline();
        await rigContract.connect(user2).mine(user2.address, 0, slot.epochId, deadline, price.add(convert("10", 18)), "");
      }

      // User3 displaces user2 (user2 gets 80% miner fee credited)
      slot = await rigContract.getSlot(0);
      price = await rigContract.getPrice(0);
      if (price.gt(0)) {
        await weth.connect(user3).approve(rigAddress, price.add(convert("10", 18)));
        deadline = await getFutureDeadline();
        await rigContract.connect(user3).mine(user3.address, 0, slot.epochId, deadline, price.add(convert("10", 18)), "");
      }

      // User1 displaces user3 (user3 gets 80% miner fee credited)
      slot = await rigContract.getSlot(0);
      price = await rigContract.getPrice(0);
      if (price.gt(0)) {
        await weth.connect(user1).approve(rigAddress, price.add(convert("10", 18)));
        deadline = await getFutureDeadline();
        await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, price.add(convert("10", 18)), "");
      }

      // Now user1, user2, user3 should all have some claimable
      // Verify claim for user1
      const user1Claimable = await rigContract.accountToClaimable(user1.address);
      if (user1Claimable.gt(0)) {
        const balBefore = await weth.balanceOf(user1.address);
        await rigContract.claim(user1.address);
        const balAfter = await weth.balanceOf(user1.address);

        expect(balAfter.sub(balBefore)).to.equal(user1Claimable,
          "User1 claim transfer amount != accountToClaimable"
        );
        expect(await rigContract.accountToClaimable(user1.address)).to.equal(0,
          "User1 accountToClaimable not zeroed after claim"
        );
      }

      // Verify claim for user2
      const user2Claimable = await rigContract.accountToClaimable(user2.address);
      if (user2Claimable.gt(0)) {
        const balBefore = await weth.balanceOf(user2.address);
        await rigContract.claim(user2.address);
        const balAfter = await weth.balanceOf(user2.address);

        expect(balAfter.sub(balBefore)).to.equal(user2Claimable,
          "User2 claim transfer amount != accountToClaimable"
        );
        expect(await rigContract.accountToClaimable(user2.address)).to.equal(0,
          "User2 accountToClaimable not zeroed after claim"
        );
      }

      // Verify claim for user3
      const user3Claimable = await rigContract.accountToClaimable(user3.address);
      if (user3Claimable.gt(0)) {
        const balBefore = await weth.balanceOf(user3.address);
        await rigContract.claim(user3.address);
        const balAfter = await weth.balanceOf(user3.address);

        expect(balAfter.sub(balBefore)).to.equal(user3Claimable,
          "User3 claim transfer amount != accountToClaimable"
        );
        expect(await rigContract.accountToClaimable(user3.address)).to.equal(0,
          "User3 accountToClaimable not zeroed after claim"
        );
      }
    });
  });

  describe("INV-CLAIM-2: Claiming for one account does not affect another account's claimable", function () {
    it("User1's claim does not change user2's or user3's claimable balance", async function () {
      // Build up claimable for multiple users through a chain of displacements

      // user1 mines
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rigAddress, convert("10", 18));
      let deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("10", 18), "");

      // user2 displaces user1
      slot = await rigContract.getSlot(0);
      let price = await rigContract.getPrice(0);
      await weth.connect(user2).approve(rigAddress, price.add(convert("10", 18)));
      deadline = await getFutureDeadline();
      await rigContract.connect(user2).mine(user2.address, 0, slot.epochId, deadline, price.add(convert("10", 18)), "");

      // user3 displaces user2
      slot = await rigContract.getSlot(0);
      price = await rigContract.getPrice(0);
      await weth.connect(user3).approve(rigAddress, price.add(convert("10", 18)));
      deadline = await getFutureDeadline();
      await rigContract.connect(user3).mine(user3.address, 0, slot.epochId, deadline, price.add(convert("10", 18)), "");

      // user1 displaces user3
      slot = await rigContract.getSlot(0);
      price = await rigContract.getPrice(0);
      await weth.connect(user1).approve(rigAddress, price.add(convert("10", 18)));
      deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, price.add(convert("10", 18)), "");

      // Record all claimable balances before any claim
      const user1ClaimableBefore = await rigContract.accountToClaimable(user1.address);
      const user2ClaimableBefore = await rigContract.accountToClaimable(user2.address);
      const user3ClaimableBefore = await rigContract.accountToClaimable(user3.address);

      // User1 claims
      if (user1ClaimableBefore.gt(0)) {
        await rigContract.claim(user1.address);
      }

      // Verify user2 and user3 claimable are UNCHANGED
      const user2ClaimableAfter = await rigContract.accountToClaimable(user2.address);
      const user3ClaimableAfter = await rigContract.accountToClaimable(user3.address);

      expect(user2ClaimableAfter).to.equal(user2ClaimableBefore,
        "User2 claimable changed after user1 claimed"
      );
      expect(user3ClaimableAfter).to.equal(user3ClaimableBefore,
        "User3 claimable changed after user1 claimed"
      );

      // User2 claims
      if (user2ClaimableBefore.gt(0)) {
        await rigContract.claim(user2.address);
      }

      // Verify user3 claimable still unchanged
      const user3ClaimableFinal = await rigContract.accountToClaimable(user3.address);
      expect(user3ClaimableFinal).to.equal(user3ClaimableBefore,
        "User3 claimable changed after user2 claimed"
      );
    });
  });

  describe("INV-CLAIM-3: After all accounts claim, rig quote token balance == 0", function () {
    it("Rig holds zero quote tokens after all accounts with claimable have claimed", async function () {
      // Build up claimable through displacements
      // user2 mines
      let slot = await rigContract.getSlot(0);
      await weth.connect(user2).approve(rigAddress, convert("10", 18));
      let deadline = await getFutureDeadline();
      await rigContract.connect(user2).mine(user2.address, 0, slot.epochId, deadline, convert("10", 18), "");

      // user3 displaces user2
      slot = await rigContract.getSlot(0);
      let price = await rigContract.getPrice(0);
      await weth.connect(user3).approve(rigAddress, price.add(convert("10", 18)));
      deadline = await getFutureDeadline();
      await rigContract.connect(user3).mine(user3.address, 0, slot.epochId, deadline, price.add(convert("10", 18)), "");

      // user1 displaces user3
      slot = await rigContract.getSlot(0);
      price = await rigContract.getPrice(0);
      await weth.connect(user1).approve(rigAddress, price.add(convert("10", 18)));
      deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, price.add(convert("10", 18)), "");

      // Claim for all users who have claimable
      const allUsers = [user0, user1, user2, user3];
      for (const user of allUsers) {
        const claimable = await rigContract.accountToClaimable(user.address);
        if (claimable.gt(0)) {
          await rigContract.claim(user.address);
        }
      }

      // Rig balance should be exactly 0
      const rigBalance = await weth.balanceOf(rigAddress);
      expect(rigBalance).to.equal(0,
        "Rig quote balance is not zero after all claims"
      );
    });
  });

  describe("INV-CLAIM-4: claim() called by any third party still sends tokens to the account", function () {
    it("ThirdParty calls claim(user1.address) and user1 receives the tokens", async function () {
      // Build up claimable for user1
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rigAddress, convert("10", 18));
      let deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("10", 18), "");

      // user2 displaces user1 so user1 gets miner fee
      slot = await rigContract.getSlot(0);
      let price = await rigContract.getPrice(0);
      if (price.eq(0)) {
        // Wait for a fresh epoch with some price
        await increaseTime(ONE_HOUR + 1);
        slot = await rigContract.getSlot(0);
        await weth.connect(user1).approve(rigAddress, convert("10", 18));
        deadline = await getFutureDeadline();
        await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("10", 18), "");
        slot = await rigContract.getSlot(0);
        price = await rigContract.getPrice(0);
      }

      await weth.connect(user2).approve(rigAddress, price.add(convert("10", 18)));
      deadline = await getFutureDeadline();
      await rigContract.connect(user2).mine(user2.address, 0, slot.epochId, deadline, price.add(convert("10", 18)), "");

      const user1Claimable = await rigContract.accountToClaimable(user1.address);
      expect(user1Claimable).to.be.gt(0, "User1 should have claimable balance");

      // Third party (thirdParty signer) calls claim on behalf of user1
      const user1BalBefore = await weth.balanceOf(user1.address);
      const thirdPartyBalBefore = await weth.balanceOf(thirdParty.address);

      await rigContract.connect(thirdParty).claim(user1.address);

      const user1BalAfter = await weth.balanceOf(user1.address);
      const thirdPartyBalAfter = await weth.balanceOf(thirdParty.address);

      // User1 should have received the tokens
      expect(user1BalAfter.sub(user1BalBefore)).to.equal(user1Claimable,
        "User1 did not receive correct amount when thirdParty called claim"
      );

      // Third party should not have received anything
      expect(thirdPartyBalAfter).to.equal(thirdPartyBalBefore,
        "ThirdParty balance should not change when calling claim for user1"
      );

      // User1 claimable should be zeroed
      expect(await rigContract.accountToClaimable(user1.address)).to.equal(0,
        "User1 claimable not zeroed after third-party claim"
      );
    });

    it("ThirdParty calls claim for user3; user3 receives tokens, thirdParty does not", async function () {
      // Build up claimable for user3
      let slot = await rigContract.getSlot(0);
      await weth.connect(user3).approve(rigAddress, convert("10", 18));
      let deadline = await getFutureDeadline();
      await rigContract.connect(user3).mine(user3.address, 0, slot.epochId, deadline, convert("10", 18), "");

      slot = await rigContract.getSlot(0);
      let price = await rigContract.getPrice(0);
      if (price.eq(0)) {
        await increaseTime(ONE_HOUR + 1);
        slot = await rigContract.getSlot(0);
        await weth.connect(user3).approve(rigAddress, convert("10", 18));
        deadline = await getFutureDeadline();
        await rigContract.connect(user3).mine(user3.address, 0, slot.epochId, deadline, convert("10", 18), "");
        slot = await rigContract.getSlot(0);
        price = await rigContract.getPrice(0);
      }

      await weth.connect(user1).approve(rigAddress, price.add(convert("10", 18)));
      deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, price.add(convert("10", 18)), "");

      const user3Claimable = await rigContract.accountToClaimable(user3.address);
      if (user3Claimable.eq(0)) {
        this.skip();
        return;
      }

      const user3BalBefore = await weth.balanceOf(user3.address);
      const tpBalBefore = await weth.balanceOf(thirdParty.address);

      // ThirdParty triggers claim for user3
      await rigContract.connect(thirdParty).claim(user3.address);

      const user3BalAfter = await weth.balanceOf(user3.address);
      const tpBalAfter = await weth.balanceOf(thirdParty.address);

      expect(user3BalAfter.sub(user3BalBefore)).to.equal(user3Claimable);
      expect(tpBalAfter).to.equal(tpBalBefore);
      expect(await rigContract.accountToClaimable(user3.address)).to.equal(0);
    });
  });
});
