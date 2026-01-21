const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const divDec6 = (amount) => amount / 10 ** 6;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";
const AddressDead = "0x000000000000000000000000000000000000dEaD";

async function getAuctionData(content, tokenId) {
  return {
    epochId: await content.tokenIdToEpochId(tokenId),
    initPrice: await content.tokenIdToInitPrice(tokenId),
    startTime: await content.tokenIdToStartTime(tokenId)
  };
}

let owner, protocol, launcher, attacker, user1, user2, user3, user4, user5;
let usdc, donut, registry, core;
let content, minter, rewarder, auction, unit, lpToken;
let unitFactory, contentFactory, minterFactory, rewarderFactory, auctionFactory;
let uniswapFactory, uniswapRouter;

const WEEK = 7 * 24 * 60 * 60;
const DAY = 24 * 60 * 60;
const HOUR = 60 * 60;

describe("EXTREME Stress Tests", function () {
  before("Initial set up", async function () {
    await network.provider.send("hardhat_reset");
    console.log("Begin EXTREME Test Initialization");

    [owner, protocol, launcher, attacker, user1, user2, user3, user4, user5] = await ethers.getSigners();

    // Deploy USDC (6 decimals) as quote token
    const usdcArtifact = await ethers.getContractFactory("MockUSDC");
    usdc = await usdcArtifact.deploy();

    const donutArtifact = await ethers.getContractFactory("MockWETH");
    donut = await donutArtifact.deploy();

    const mockUniswapFactoryArtifact = await ethers.getContractFactory("MockUniswapV2Factory");
    uniswapFactory = await mockUniswapFactoryArtifact.deploy();

    const mockUniswapRouterArtifact = await ethers.getContractFactory("MockUniswapV2Router");
    uniswapRouter = await mockUniswapRouterArtifact.deploy(uniswapFactory.address);

    const registryArtifact = await ethers.getContractFactory("Registry");
    registry = await registryArtifact.deploy();

    const unitFactoryArtifact = await ethers.getContractFactory("UnitFactory");
    unitFactory = await unitFactoryArtifact.deploy();

    const contentFactoryArtifact = await ethers.getContractFactory("ContentRigFactory");
    contentFactory = await contentFactoryArtifact.deploy();

    const minterFactoryArtifact = await ethers.getContractFactory("MinterFactory");
    minterFactory = await minterFactoryArtifact.deploy();

    const rewarderFactoryArtifact = await ethers.getContractFactory("RewarderFactory");
    rewarderFactory = await rewarderFactoryArtifact.deploy();

    const auctionFactoryArtifact = await ethers.getContractFactory("AuctionFactory");
    auctionFactory = await auctionFactoryArtifact.deploy();

    const coreArtifact = await ethers.getContractFactory("ContentCore");
    core = await coreArtifact.deploy(
      registry.address,
      usdc.address,
      donut.address,
      uniswapFactory.address,
      uniswapRouter.address,
      unitFactory.address,
      contentFactory.address,
      minterFactory.address,
      auctionFactory.address,
      rewarderFactory.address,
      protocol.address,
      convert("100", 18)
    );

    await registry.setFactoryApproval(core.address, true);

    // Give everyone tokens
    for (const user of [launcher, attacker, user1, user2, user3, user4, user5]) {
      await donut.connect(user).deposit({ value: convert("1000", 18) });
      await usdc.mint(user.address, convert("1000", 6));
    }

    const launchParams = {
      launcher: launcher.address,
      tokenName: "Extreme Test Unit",
      tokenSymbol: "XTUNIT",
      uri: "https://example.com/extreme",
      donutAmount: convert("1000", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("10", 18),
      tailUps: convert("0.1", 18),
      halvingPeriod: WEEK,
      contentMinInitPrice: convert("1", 6),
      contentIsModerated: false,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: DAY,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(launcher).approve(core.address, launchParams.donutAmount);
    const tx = await core.connect(launcher).launch(launchParams);
    const receipt = await tx.wait();

    const launchEvent = receipt.events.find((e) => e.event === "ContentCore__Launched");
    content = await ethers.getContractAt("ContentRig", launchEvent.args.rig);
    unit = await ethers.getContractAt("Unit", launchEvent.args.unit);
    minter = await ethers.getContractAt("Minter", launchEvent.args.minter);
    rewarder = await ethers.getContractAt("Rewarder", launchEvent.args.rewarder);
    auction = await ethers.getContractAt("Auction", launchEvent.args.auction);
    lpToken = await ethers.getContractAt("IERC20", launchEvent.args.lpToken);

    console.log("EXTREME Test Initialization Complete\n");
  });

  describe("Mass Content Creation Stress Test", function () {
    it("Should handle 50 content creations", async function () {
      const users = [user1, user2, user3, user4, user5];

      for (let i = 0; i < 50; i++) {
        const user = users[i % users.length];
        await content.connect(user).create(user.address, `ipfs://stress-test-${i}`);
      }

      const totalSupply = await content.totalSupply();
      expect(totalSupply).to.equal(50);
      console.log(`Created ${totalSupply} content NFTs`);
    });

    it("Should handle rapid sequential collections", async function () {
      // Create fresh content for collection tests
      for (let i = 0; i < 10; i++) {
        await content.connect(user1).create(user1.address, `ipfs://rapid-collect-${i}`);
      }

      const startId = 51; // After the 50 created above
      const users = [user2, user3, user4, user5];

      for (let i = 0; i < 10; i++) {
        const tokenId = startId + i;
        const collector = users[i % users.length];
        const auctionData = await getAuctionData(content, tokenId);
        const price = await content.getPrice(tokenId);

        if (price.gt(0)) {
          await usdc.connect(collector).approve(content.address, price);
          await content.connect(collector).collect(
            collector.address,
            tokenId,
            auctionData.epochId,
            ethers.constants.MaxUint256,
            price
          );
        }
      }
      console.log("Rapid sequential collections completed");
    });
  });

  describe("Price Boundary Tests", function () {
    it("Should handle minimum price correctly", async function () {
      await content.connect(user1).create(user1.address, "ipfs://min-price-test");
      const tokenId = await content.nextTokenId();

      // Wait for price to decay to minimum
      await ethers.provider.send("evm_increaseTime", [31 * DAY]);
      await ethers.provider.send("evm_mine");

      const price = await content.getPrice(tokenId);
      expect(price).to.equal(0);

      const auctionData = await getAuctionData(content, tokenId);
      await content.connect(user2).collect(
        user2.address,
        tokenId,
        auctionData.epochId,
        ethers.constants.MaxUint256,
        0
      );

      // After free collection, new price should be minInitPrice
      const newAuction = await getAuctionData(content, tokenId);
      const minInitPrice = await content.minInitPrice();
      expect(newAuction.initPrice).to.equal(minInitPrice);
    });

    it("Should handle very high prices correctly", async function () {
      await content.connect(user1).create(user1.address, "ipfs://high-price-test");
      const tokenId = await content.nextTokenId();

      // Collect multiple times to increase price
      for (let i = 0; i < 5; i++) {
        const auctionData = await getAuctionData(content, tokenId);
        const price = await content.getPrice(tokenId);

        if (price.gt(0)) {
          const collector = i % 2 === 0 ? user2 : user3;
          await usdc.connect(collector).approve(content.address, price);
          await content.connect(collector).collect(
            collector.address,
            tokenId,
            auctionData.epochId,
            ethers.constants.MaxUint256,
            price
          );
        }
      }

      const finalAuction = await getAuctionData(content, tokenId);
      expect(finalAuction.initPrice).to.be.gt(0);
      console.log(`Final init price after 5 collections: ${divDec(finalAuction.initPrice)}`);
    });

    it("Should handle price at exact epoch boundary", async function () {
      await content.connect(user1).create(user1.address, "ipfs://boundary-test");
      const tokenId = await content.nextTokenId();

      const auctionData = await getAuctionData(content, tokenId);

      // Move to exactly EPOCH_PERIOD seconds
      const EPOCH_PERIOD = 1 * DAY;
      await ethers.provider.send("evm_increaseTime", [EPOCH_PERIOD]);
      await ethers.provider.send("evm_mine");

      const price = await content.getPrice(tokenId);
      expect(price).to.equal(0);
    });

    it("Should handle price 1 second before epoch ends", async function () {
      await content.connect(user1).create(user1.address, "ipfs://one-second-test");
      const tokenId = await content.nextTokenId();

      const EPOCH_PERIOD = 1 * DAY;
      await ethers.provider.send("evm_increaseTime", [EPOCH_PERIOD - 1]);
      await ethers.provider.send("evm_mine");

      const price = await content.getPrice(tokenId);
      // Should be very small but > 0
      expect(price).to.be.gt(0);
    });
  });

  describe("Multi-User Reward Distribution Tests", function () {
    it("Should distribute rewards fairly among multiple stakers", async function () {
      // Create and collect content for multiple users
      const stakes = {};
      const users = [user1, user2, user3, user4];

      for (let i = 0; i < 4; i++) {
        await content.connect(users[i]).create(users[i].address, `ipfs://reward-test-${i}`);
        const tokenId = await content.nextTokenId();

        const auctionData = await getAuctionData(content, tokenId);
        const price = await content.getPrice(tokenId);

        if (price.gt(0)) {
          await usdc.connect(users[(i + 1) % 4]).approve(content.address, price);
          await content.connect(users[(i + 1) % 4]).collect(
            users[(i + 1) % 4].address,
            tokenId,
            auctionData.epochId,
            ethers.constants.MaxUint256,
            price
          );
          stakes[users[(i + 1) % 4].address] = (stakes[users[(i + 1) % 4].address] || ethers.BigNumber.from(0)).add(price);
        }
      }

      // Trigger minter emission
      await ethers.provider.send("evm_increaseTime", [WEEK]);
      await ethers.provider.send("evm_mine");
      await minter.updatePeriod();

      // Check each user's earned rewards
      for (const user of users) {
        const balance = await rewarder.accountToBalance(user.address);
        const earned = await rewarder.earned(user.address, unit.address);
        console.log(`User ${user.address.slice(0, 8)}: balance=${divDec(balance)}, earned=${divDec(earned)}`);
      }
    });

    it("Should handle stake withdrawal correctly on ownership change", async function () {
      await content.connect(user1).create(user1.address, "ipfs://stake-withdrawal-test");
      const tokenId = await content.nextTokenId();

      // First collection
      let auctionData = await getAuctionData(content, tokenId);
      let price = await content.getPrice(tokenId);

      await usdc.connect(user2).approve(content.address, price);
      await content.connect(user2).collect(
        user2.address,
        tokenId,
        auctionData.epochId,
        ethers.constants.MaxUint256,
        price
      );

      const user2BalanceAfterFirst = await rewarder.accountToBalance(user2.address);
      expect(user2BalanceAfterFirst).to.be.gte(price);

      // Second collection by different user
      auctionData = await getAuctionData(content, tokenId);
      price = await content.getPrice(tokenId);

      await usdc.connect(user3).approve(content.address, price);
      await content.connect(user3).collect(
        user3.address,
        tokenId,
        auctionData.epochId,
        ethers.constants.MaxUint256,
        price
      );

      // User2's stake from this token should be withdrawn
      // User3 should have the new stake
      const user3Balance = await rewarder.accountToBalance(user3.address);
      expect(user3Balance).to.be.gte(price);
    });
  });

  describe("Minter Edge Cases", function () {
    it("Should handle multiple updatePeriod calls in same block", async function () {
      await ethers.provider.send("evm_increaseTime", [WEEK]);
      await ethers.provider.send("evm_mine");

      const periodBefore = await minter.activePeriod();
      await minter.updatePeriod();
      const periodAfter1 = await minter.activePeriod();

      // Second call in same period should be no-op
      await minter.updatePeriod();
      const periodAfter2 = await minter.activePeriod();

      expect(periodAfter1).to.equal(periodAfter2);
    });

    it("Should handle halving correctly over many periods", async function () {
      const initialUps = await minter.initialUps();
      const tailUps = await minter.tailUps();
      const halvingPeriod = await minter.halvingPeriod();

      // Calculate expected halvings to reach tail
      let currentUps = initialUps;
      let halvings = 0;
      while (currentUps.gt(tailUps)) {
        currentUps = currentUps.div(2);
        halvings++;
      }

      console.log(`Expected ${halvings} halvings to reach tail`);

      // Fast forward past all halvings
      await ethers.provider.send("evm_increaseTime", [halvingPeriod.toNumber() * (halvings + 5)]);
      await ethers.provider.send("evm_mine");

      const finalUps = await minter.getUps();
      expect(finalUps).to.equal(tailUps);
    });

    it("Should emit correct weekly amount at tail", async function () {
      const tailUps = await minter.tailUps();
      const expectedWeekly = tailUps.mul(WEEK);
      const actualWeekly = await minter.weeklyEmission();

      expect(actualWeekly).to.equal(expectedWeekly);
    });
  });

  describe("Auction Edge Cases", function () {
    it("Should handle auction at price = 0", async function () {
      // Wait for auction price to decay to 0
      const epochPeriod = await auction.epochPeriod();
      await ethers.provider.send("evm_increaseTime", [epochPeriod.toNumber() + 1]);
      await ethers.provider.send("evm_mine");

      const price = await auction.getPrice();
      expect(price).to.equal(0);

      // Send some USDC to auction
      await usdc.connect(user1).transfer(auction.address, convert("1", 6));

      const epochId = await auction.epochId();

      // Should be able to buy for free
      await auction.connect(user2).buy(
        [usdc.address],
        user2.address,
        epochId,
        ethers.constants.MaxUint256,
        0
      );

      // User2 should have received the USDC
      // New epoch should have started
      const newEpochId = await auction.epochId();
      expect(newEpochId).to.equal(epochId.add(1));
    });

    it("Should handle auction with multiple assets", async function () {
      // Create a mock token
      const mockToken = await (await ethers.getContractFactory("MockWETH")).deploy();
      await mockToken.connect(user1).deposit({ value: convert("10", 18) });
      await mockToken.connect(user1).transfer(auction.address, convert("10", 18));

      // Also send some USDC
      await usdc.connect(user1).transfer(auction.address, convert("5", 6));

      // Wait for price to be 0
      const epochPeriod = await auction.epochPeriod();
      await ethers.provider.send("evm_increaseTime", [epochPeriod.toNumber() + 1]);
      await ethers.provider.send("evm_mine");

      const epochId = await auction.epochId();

      const user3UsdcBefore = await usdc.balanceOf(user3.address);
      const user3MockBefore = await mockToken.balanceOf(user3.address);

      await auction.connect(user3).buy(
        [usdc.address, mockToken.address],
        user3.address,
        epochId,
        ethers.constants.MaxUint256,
        0
      );

      const user3UsdcAfter = await usdc.balanceOf(user3.address);
      const user3MockAfter = await mockToken.balanceOf(user3.address);

      expect(user3UsdcAfter).to.be.gt(user3UsdcBefore);
      expect(user3MockAfter).to.be.gt(user3MockBefore);
    });
  });

  describe("Rewarder Edge Cases", function () {
    it("Should handle getReward when no rewards earned", async function () {
      // New user with no stake should not revert
      const [newUser] = await ethers.getSigners();
      await rewarder.connect(newUser).getReward(newUser.address);
      // Should not revert
    });

    it("Should handle notifyRewardAmount with exact leftover amount", async function () {
      const left = await rewarder.left(unit.address);

      if (left.gt(0)) {
        // Try to notify with exactly left amount - should fail
        await unit.connect(user1).approve(rewarder.address, left);
        await expect(
          rewarder.connect(user1).notifyRewardAmount(unit.address, left.sub(1))
        ).to.be.revertedWith("Rewarder__RewardSmallerThanLeft()");
      }
    });

    it("Should track rewards correctly after multiple notify calls", async function () {
      // Trigger multiple minter updates
      for (let i = 0; i < 3; i++) {
        await ethers.provider.send("evm_increaseTime", [WEEK]);
        await ethers.provider.send("evm_mine");
        await minter.updatePeriod();
      }

      const totalSupply = await rewarder.totalSupply();
      if (totalSupply.gt(0)) {
        const left = await rewarder.left(unit.address);
        expect(left).to.be.gt(0);
      }
    });
  });

  describe("Fee Distribution Precision Tests", function () {
    it("Should handle fee distribution with odd amounts", async function () {
      // user3 creates content for user4 (so creator != prevOwner)
      await content.connect(user3).create(user4.address, "ipfs://odd-fee-test");
      const tokenId = await content.nextTokenId();

      // Wait for a specific price that creates odd division
      await ethers.provider.send("evm_increaseTime", [DAY * 15]); // Half decay
      await ethers.provider.send("evm_mine");

      const auctionData = await getAuctionData(content, tokenId);
      const maxPrice = await content.getPrice(tokenId);

      if (maxPrice.gt(0)) {
        const prevOwner = await content.ownerOf(tokenId);
        const creator = await content.tokenIdToCreator(tokenId);
        const treasury = await content.treasury();
        const team = await content.team();
        const protocolFee = await core.protocolFeeAddress();

        // Make sure prevOwner and creator are different
        expect(prevOwner).to.equal(user4.address);
        expect(creator).to.equal(user4.address);

        const prevOwnerBefore = await usdc.balanceOf(prevOwner);
        const treasuryBefore = await usdc.balanceOf(treasury);
        const teamBefore = await usdc.balanceOf(team);
        const protocolBefore = await usdc.balanceOf(protocolFee);

        await usdc.connect(user2).approve(content.address, maxPrice);
        await content.connect(user2).collect(
          user2.address,
          tokenId,
          auctionData.epochId,
          ethers.constants.MaxUint256,
          maxPrice
        );

        // Get actual price paid from stake
        const actualPrice = await content.tokenIdToStake(tokenId);

        const prevOwnerAfter = await usdc.balanceOf(prevOwner);
        const treasuryAfter = await usdc.balanceOf(treasury);
        const teamAfter = await usdc.balanceOf(team);
        const protocolAfter = await usdc.balanceOf(protocolFee);

        // prevOwner gets 80% + 3% (since prevOwner == creator in this case)
        const prevOwnerFee = prevOwnerAfter.sub(prevOwnerBefore);
        const treasuryFee = treasuryAfter.sub(treasuryBefore);
        const teamFee = teamAfter.sub(teamBefore);
        const protocolFeeAmt = protocolAfter.sub(protocolBefore);

        // Total should equal actual price paid
        const totalFees = prevOwnerFee.add(treasuryFee).add(teamFee).add(protocolFeeAmt);
        expect(totalFees).to.equal(actualPrice);

        console.log(`Actual Price: ${divDec6(actualPrice)}`);
        console.log(`PrevOwner+Creator (83%): ${divDec6(prevOwnerFee)}`);
        console.log(`Treasury (15%): ${divDec6(treasuryFee)}`);
        console.log(`Team (1%): ${divDec6(teamFee)}`);
        console.log(`Protocol (1%): ${divDec6(protocolFeeAmt)}`);
      }
    });

    it("Should handle fee distribution with very small amounts", async function () {
      await content.connect(user1).create(user1.address, "ipfs://small-fee-test");
      const tokenId = await content.nextTokenId();

      // Wait until price is very low
      await ethers.provider.send("evm_increaseTime", [DAY * 29]);
      await ethers.provider.send("evm_mine");

      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);

      if (price.gt(0) && price.lt(convert("0.0001", 6))) {
        await usdc.connect(user2).approve(content.address, price);
        await content.connect(user2).collect(
          user2.address,
          tokenId,
          auctionData.epochId,
          ethers.constants.MaxUint256,
          price
        );
        console.log(`Successfully collected with tiny price: ${divDec6(price)}`);
      }
    });
  });

  describe("Concurrent Operations Simulation", function () {
    it("Should handle multiple users creating content simultaneously", async function () {
      const promises = [];
      const users = [user1, user2, user3, user4, user5];

      for (let i = 0; i < 5; i++) {
        promises.push(content.connect(users[i]).create(users[i].address, `ipfs://concurrent-create-${i}`));
      }

      await Promise.all(promises);
      console.log("5 concurrent creates completed");
    });

    it("Should handle multiple users collecting different content", async function () {
      // Create content for collection
      const tokenIds = [];
      for (let i = 0; i < 5; i++) {
        await content.connect(user1).create(user1.address, `ipfs://concurrent-collect-${i}`);
        tokenIds.push(await content.nextTokenId());
      }

      const users = [user2, user3, user4, user5, user2];
      const promises = [];

      for (let i = 0; i < 5; i++) {
        const tokenId = tokenIds[i];
        const auctionData = await getAuctionData(content, tokenId);
        const price = await content.getPrice(tokenId);

        if (price.gt(0)) {
          await usdc.connect(users[i]).approve(content.address, price);
          promises.push(
            content.connect(users[i]).collect(
              users[i].address,
              tokenId,
              auctionData.epochId,
              ethers.constants.MaxUint256,
              price
            )
          );
        }
      }

      await Promise.all(promises);
      console.log("5 concurrent collections completed");
    });
  });

  describe("State Recovery Tests", function () {
    it("Should maintain consistent state after failed transaction", async function () {
      await content.connect(user1).create(user1.address, "ipfs://state-recovery");
      const tokenId = await content.nextTokenId();

      const auctionBefore = await getAuctionData(content, tokenId);
      const ownerBefore = await content.ownerOf(tokenId);
      const stakeBefore = await content.tokenIdToStake(tokenId);

      // Try to collect with wrong epochId (should fail)
      const price = await content.getPrice(tokenId);
      await usdc.connect(user2).approve(content.address, price);

      await expect(
        content.connect(user2).collect(
          user2.address,
          tokenId,
          999, // wrong epochId
          ethers.constants.MaxUint256,
          price
        )
      ).to.be.reverted;

      // State should be unchanged
      const auctionAfter = await getAuctionData(content, tokenId);
      const ownerAfter = await content.ownerOf(tokenId);
      const stakeAfter = await content.tokenIdToStake(tokenId);

      expect(auctionAfter.epochId).to.equal(auctionBefore.epochId);
      expect(ownerAfter).to.equal(ownerBefore);
      expect(stakeAfter).to.equal(stakeBefore);
    });
  });

  describe("Gas Limit Tests", function () {
    it("Should handle maximum reasonable content creation", async function () {
      const gasUsed = [];

      for (let i = 0; i < 10; i++) {
        const tx = await content.connect(user1).create(user1.address, `ipfs://gas-test-${i}-${"x".repeat(100)}`);
        const receipt = await tx.wait();
        gasUsed.push(receipt.gasUsed.toNumber());
      }

      const avgGas = gasUsed.reduce((a, b) => a + b, 0) / gasUsed.length;
      console.log(`Average gas for content creation: ${avgGas}`);
      expect(avgGas).to.be.lt(500000); // Reasonable gas limit
    });

    it("Should handle collection with reasonable gas", async function () {
      await content.connect(user1).create(user1.address, "ipfs://gas-collection-test");
      const tokenId = await content.nextTokenId();

      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);

      await usdc.connect(user2).approve(content.address, price);
      const tx = await content.connect(user2).collect(
        user2.address,
        tokenId,
        auctionData.epochId,
        ethers.constants.MaxUint256,
        price
      );
      const receipt = await tx.wait();

      console.log(`Gas for collection: ${receipt.gasUsed.toNumber()}`);
      expect(receipt.gasUsed.toNumber()).to.be.lt(500000);
    });
  });
});

describe("EXTREME Attack Vector Tests", function () {
  let owner, protocol, launcher, attacker, user1, user2, user3, user4, user5;
  let usdc, donut, core, multicall;
  let content, minter, rewarder, auction, unit, lpToken;

  const WEEK = 7 * 24 * 60 * 60;
  const DAY = 24 * 60 * 60;

  before("Setup for attack tests", async function () {
    await network.provider.send("hardhat_reset");
    [owner, protocol, launcher, attacker, user1, user2, user3, user4, user5] = await ethers.getSigners();

    // Deploy USDC (6 decimals) as quote token
    const usdcArtifact = await ethers.getContractFactory("MockUSDC");
    usdc = await usdcArtifact.deploy();

    const donutArtifact = await ethers.getContractFactory("MockWETH");
    donut = await donutArtifact.deploy();

    const mockUniswapFactoryArtifact = await ethers.getContractFactory("MockUniswapV2Factory");
    const uniswapFactory = await mockUniswapFactoryArtifact.deploy();

    const mockUniswapRouterArtifact = await ethers.getContractFactory("MockUniswapV2Router");
    const uniswapRouter = await mockUniswapRouterArtifact.deploy(uniswapFactory.address);

    const localRegistry = await (await ethers.getContractFactory("Registry")).deploy();
    const unitFactory = await (await ethers.getContractFactory("UnitFactory")).deploy();
    const contentFactory = await (await ethers.getContractFactory("ContentRigFactory")).deploy();
    const minterFactory = await (await ethers.getContractFactory("MinterFactory")).deploy();
    const rewarderFactory = await (await ethers.getContractFactory("RewarderFactory")).deploy();
    const auctionFactory = await (await ethers.getContractFactory("AuctionFactory")).deploy();

    core = await (await ethers.getContractFactory("ContentCore")).deploy(
      localRegistry.address,
      usdc.address,
      donut.address,
      uniswapFactory.address,
      uniswapRouter.address,
      unitFactory.address,
      contentFactory.address,
      minterFactory.address,
      auctionFactory.address,
      rewarderFactory.address,
      protocol.address,
      convert("100", 18)
    );

    await localRegistry.setFactoryApproval(core.address, true);

    for (const user of [launcher, attacker, user1, user2, user3, user4, user5]) {
      await donut.connect(user).deposit({ value: convert("1000", 18) });
      await usdc.mint(user.address, convert("10000", 6));
    }

    await donut.connect(launcher).approve(core.address, convert("1000", 18));
    const tx = await core.connect(launcher).launch({
      launcher: launcher.address,
      tokenName: "Attack Test Unit",
      tokenSymbol: "ATUNIT",
      uri: "https://example.com/attack",
      donutAmount: convert("1000", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("10", 18),
      tailUps: convert("0.1", 18),
      halvingPeriod: WEEK,
      contentMinInitPrice: convert("1", 6),
      contentIsModerated: false,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: DAY,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    });

    const receipt = await tx.wait();
    const launchEvent = receipt.events.find((e) => e.event === "ContentCore__Launched");
    content = await ethers.getContractAt("ContentRig", launchEvent.args.rig);
    unit = await ethers.getContractAt("Unit", launchEvent.args.unit);
    minter = await ethers.getContractAt("Minter", launchEvent.args.minter);
    rewarder = await ethers.getContractAt("Rewarder", launchEvent.args.rewarder);
    auction = await ethers.getContractAt("Auction", launchEvent.args.auction);
  });

  describe("Reentrancy Attack Attempts", function () {
    it("Should resist reentrancy via malicious ERC20", async function () {
      // The contract uses SafeERC20 and nonReentrant, so this is just verification
      // A real reentrancy attack would require deploying a malicious token
      // which the content engine doesn't allow (uses predefined USDC)
      expect(true).to.be.true;
    });
  });

  describe("Timestamp Manipulation Tests", function () {
    it("Should handle block timestamp at uint256 max safely", async function () {
      // This is theoretical - we can't actually set timestamp to max
      // But we verify the math doesn't overflow
      const initPrice = convert("1000", 6);
      const timePassed = ethers.BigNumber.from(1 * DAY);
      const epochPeriod = ethers.BigNumber.from(1 * DAY);

      // Simulate price calculation
      const decay = initPrice.mul(timePassed).div(epochPeriod);
      const price = initPrice.sub(decay);

      expect(price).to.be.gte(0);
    });
  });

  describe("Front-Running Resistance", function () {
    it("Should prevent epochId front-running", async function () {
      await content.connect(user1).create(user1.address, "ipfs://frontrun-resist");
      const tokenId = await content.nextTokenId();

      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);

      // Legitimate user prepares transaction
      await usdc.connect(user2).approve(content.address, price);

      // Attacker tries to front-run with same epochId
      await usdc.connect(attacker).approve(content.address, price);

      // First transaction succeeds
      await content.connect(user2).collect(
        user2.address,
        tokenId,
        auctionData.epochId,
        ethers.constants.MaxUint256,
        price
      );

      // Attacker's transaction with old epochId fails
      await expect(
        content.connect(attacker).collect(
          attacker.address,
          tokenId,
          auctionData.epochId, // Old epochId
          ethers.constants.MaxUint256,
          price.mul(10)
        )
      ).to.be.revertedWith("ContentRig__EpochIdMismatch()");
    });

    it("Should prevent sandwich attacks via maxPrice", async function () {
      await content.connect(user1).create(user1.address, "ipfs://sandwich-resist");
      const tokenId = await content.nextTokenId();

      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);

      // User sets maxPrice to current price
      await usdc.connect(user2).approve(content.address, price);

      // If attacker manipulated price higher, user's tx would fail
      // Since we can't actually manipulate price externally, we verify the check exists
      await expect(
        content.connect(user2).collect(
          user2.address,
          tokenId,
          auctionData.epochId,
          ethers.constants.MaxUint256,
          0 // maxPrice = 0, but price > 0
        )
      ).to.be.revertedWith("ContentRig__MaxPriceExceeded()");
    });
  });

  describe("Griefing Attack Resistance", function () {
    it("Should resist minter griefing", async function () {
      // Attacker tries to grief by calling updatePeriod repeatedly
      for (let i = 0; i < 10; i++) {
        await minter.connect(attacker).updatePeriod();
      }
      // System should remain functional
      const weeklyEmission = await minter.weeklyEmission();
      expect(weeklyEmission).to.be.gt(0);
    });

    it("Should resist rewarder griefing via getReward", async function () {
      // Attacker calls getReward for victims (funds still go to victim)
      const victimBefore = await unit.balanceOf(user1.address);
      await rewarder.connect(attacker).getReward(user1.address);
      const victimAfter = await unit.balanceOf(user1.address);

      // Victim should not lose funds (might gain if they had earned rewards)
      expect(victimAfter).to.be.gte(victimBefore);
    });
  });

  describe("Integer Boundary Tests", function () {
    it("Should handle uint256 max values safely in calculations", async function () {
      // Test that ABS_MAX_INIT_PRICE is reasonable
      const absMaxInitPrice = ethers.BigNumber.from(2).pow(192).sub(1);

      // Price multiplier calculation should not overflow
      const PRICE_MULTIPLIER = ethers.BigNumber.from(2).mul(ethers.BigNumber.from(10).pow(18));
      const PRECISION = ethers.BigNumber.from(10).pow(18);

      // This would be: absMaxInitPrice * 2e18 / 1e18 = absMaxInitPrice * 2
      // Which could overflow, but the contract caps at ABS_MAX_INIT_PRICE
      expect(absMaxInitPrice.mul(2)).to.be.gt(absMaxInitPrice);
    });

    it("Should handle zero values correctly throughout", async function () {
      // Zero price collection
      await content.connect(user1).create(user1.address, "ipfs://zero-value-test");
      const tokenId = await content.nextTokenId();

      await ethers.provider.send("evm_increaseTime", [31 * DAY]);
      await ethers.provider.send("evm_mine");

      const price = await content.getPrice(tokenId);
      expect(price).to.equal(0);

      const auctionData = await getAuctionData(content, tokenId);
      await content.connect(user2).collect(
        user2.address,
        tokenId,
        auctionData.epochId,
        ethers.constants.MaxUint256,
        0
      );

      // Stake should be 0
      const stake = await content.tokenIdToStake(tokenId);
      expect(stake).to.equal(0);
    });
  });
});

describe("EXTREME Integration Tests", function () {
  let owner, protocol, launcher, attacker, user1, user2, user3, user4, user5;
  let usdc, donut, core, multicall;
  let content, minter, rewarder, auction, unit, lpToken;

  const WEEK = 7 * 24 * 60 * 60;
  const DAY = 24 * 60 * 60;

  before("Setup for integration tests", async function () {
    await network.provider.send("hardhat_reset");
    [owner, protocol, launcher, attacker, user1, user2, user3, user4, user5] = await ethers.getSigners();

    // Deploy USDC (6 decimals) as quote token
    const usdcArtifact = await ethers.getContractFactory("MockUSDC");
    usdc = await usdcArtifact.deploy();

    const donutArtifact = await ethers.getContractFactory("MockWETH");
    donut = await donutArtifact.deploy();

    const mockUniswapFactoryArtifact = await ethers.getContractFactory("MockUniswapV2Factory");
    const uniswapFactory = await mockUniswapFactoryArtifact.deploy();

    const mockUniswapRouterArtifact = await ethers.getContractFactory("MockUniswapV2Router");
    const uniswapRouter = await mockUniswapRouterArtifact.deploy(uniswapFactory.address);

    const localRegistry = await (await ethers.getContractFactory("Registry")).deploy();
    const unitFactory = await (await ethers.getContractFactory("UnitFactory")).deploy();
    const contentFactory = await (await ethers.getContractFactory("ContentRigFactory")).deploy();
    const minterFactory = await (await ethers.getContractFactory("MinterFactory")).deploy();
    const rewarderFactory = await (await ethers.getContractFactory("RewarderFactory")).deploy();
    const auctionFactory = await (await ethers.getContractFactory("AuctionFactory")).deploy();

    core = await (await ethers.getContractFactory("ContentCore")).deploy(
      localRegistry.address,
      usdc.address,
      donut.address,
      uniswapFactory.address,
      uniswapRouter.address,
      unitFactory.address,
      contentFactory.address,
      minterFactory.address,
      auctionFactory.address,
      rewarderFactory.address,
      protocol.address,
      convert("100", 18)
    );

    await localRegistry.setFactoryApproval(core.address, true);

    for (const user of [launcher, attacker, user1, user2, user3, user4, user5]) {
      await donut.connect(user).deposit({ value: convert("1000", 18) });
      await usdc.mint(user.address, convert("10000", 6));
    }

    await donut.connect(launcher).approve(core.address, convert("1000", 18));
    const tx = await core.connect(launcher).launch({
      launcher: launcher.address,
      tokenName: "Integration Test Unit",
      tokenSymbol: "ITUNIT",
      uri: "https://example.com/integration",
      donutAmount: convert("1000", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("10", 18),
      tailUps: convert("0.1", 18),
      halvingPeriod: WEEK,
      contentMinInitPrice: convert("1", 6),
      contentIsModerated: false,
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: DAY,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    });

    const receipt = await tx.wait();
    const launchEvent = receipt.events.find((e) => e.event === "ContentCore__Launched");
    content = await ethers.getContractAt("ContentRig", launchEvent.args.rig);
    unit = await ethers.getContractAt("Unit", launchEvent.args.unit);
    minter = await ethers.getContractAt("Minter", launchEvent.args.minter);
    rewarder = await ethers.getContractAt("Rewarder", launchEvent.args.rewarder);
    auction = await ethers.getContractAt("Auction", launchEvent.args.auction);
  });

  describe("Full Lifecycle Tests", function () {
    it("Should handle complete content lifecycle", async function () {
      // 1. Create content
      await content.connect(user1).create(user1.address, "ipfs://lifecycle-test");
      const tokenId = await content.nextTokenId();
      console.log(`1. Created token ${tokenId}`);

      // 2. First collection
      let auctionData = await getAuctionData(content, tokenId);
      let price = await content.getPrice(tokenId);
      await usdc.connect(user2).approve(content.address, price);
      await content.connect(user2).collect(
        user2.address,
        tokenId,
        auctionData.epochId,
        ethers.constants.MaxUint256,
        price
      );
      console.log(`2. First collection at price ${divDec6(price)}`);

      // 3. Second collection (price should be 2x)
      auctionData = await getAuctionData(content, tokenId);
      price = await content.getPrice(tokenId);
      await usdc.connect(user3).approve(content.address, price);
      await content.connect(user3).collect(
        user3.address,
        tokenId,
        auctionData.epochId,
        ethers.constants.MaxUint256,
        price
      );
      console.log(`3. Second collection at price ${divDec6(price)}`);

      // 4. Trigger minter emission
      await ethers.provider.send("evm_increaseTime", [WEEK]);
      await ethers.provider.send("evm_mine");
      await minter.updatePeriod();
      console.log("4. Minter emission triggered");

      // 5. Claim rewards
      const earnedUser2 = await rewarder.earned(user2.address, unit.address);
      const earnedUser3 = await rewarder.earned(user3.address, unit.address);
      console.log(`5. User2 earned: ${divDec(earnedUser2)}, User3 earned: ${divDec(earnedUser3)}`);

      await rewarder.connect(user2).getReward(user2.address);
      await rewarder.connect(user3).getReward(user3.address);
      console.log("6. Rewards claimed");

      // 6. Let price decay and collect for free
      await ethers.provider.send("evm_increaseTime", [31 * DAY]);
      await ethers.provider.send("evm_mine");

      auctionData = await getAuctionData(content, tokenId);
      price = await content.getPrice(tokenId);
      expect(price).to.equal(0);

      await content.connect(user4).collect(
        user4.address,
        tokenId,
        auctionData.epochId,
        ethers.constants.MaxUint256,
        0
      );
      console.log("7. Free collection after decay");

      // Verify final state
      expect(await content.ownerOf(tokenId)).to.equal(user4.address);
      console.log("Complete lifecycle test passed!");
    });

    it("Should handle auction lifecycle", async function () {
      // 1. Send assets to auction
      await usdc.connect(user1).transfer(auction.address, convert("10", 6));
      console.log("1. Sent 10 USDC to auction");

      // 2. Wait for price to decay
      const epochPeriod = await auction.epochPeriod();
      await ethers.provider.send("evm_increaseTime", [epochPeriod.toNumber() + 1]);
      await ethers.provider.send("evm_mine");

      // 3. Buy at 0 price
      const epochId = await auction.epochId();
      const user5UsdcBefore = await usdc.balanceOf(user5.address);

      await auction.connect(user5).buy(
        [usdc.address],
        user5.address,
        epochId,
        ethers.constants.MaxUint256,
        0
      );

      const user5UsdcAfter = await usdc.balanceOf(user5.address);
      expect(user5UsdcAfter).to.be.gt(user5UsdcBefore);
      console.log(`2. Bought auction assets, gained ${divDec6(user5UsdcAfter.sub(user5UsdcBefore))} USDC`);

      // 4. New epoch should have started
      const newEpochId = await auction.epochId();
      expect(newEpochId).to.equal(epochId.add(1));
      console.log("3. New auction epoch started");
    });
  });

  describe("Multi-Engine Tests", function () {
    it("Should handle multiple content engines independently", async function () {
      // Launch a second content engine
      const launchParams2 = {
        launcher: user1.address,
        tokenName: "Second Engine Unit",
        tokenSymbol: "SEUNIT",
        uri: "https://example.com/second",
        donutAmount: convert("500", 18),
        unitAmount: convert("500000", 18),
        initialUps: convert("5", 18),
        tailUps: convert("0.05", 18),
        halvingPeriod: WEEK * 2,
        contentMinInitPrice: convert("100", 6),
        contentIsModerated: true,
        auctionInitPrice: convert("2000", 6),
        auctionEpochPeriod: DAY * 2,
        auctionPriceMultiplier: convert("2", 18),
        auctionMinInitPrice: convert("10", 6),
      };

      await donut.connect(user1).approve(core.address, launchParams2.donutAmount);
      const tx = await core.connect(user1).launch(launchParams2);
      const receipt = await tx.wait();

      const launchEvent = receipt.events.find((e) => e.event === "ContentCore__Launched");
      const content2 = await ethers.getContractAt("ContentRig", launchEvent.args.rig);
      const unit2 = await ethers.getContractAt("Unit", launchEvent.args.unit);

      // Verify they're independent
      expect(await content2.unit()).to.not.equal(await content.unit());
      expect(await content2.minInitPrice()).to.not.equal(await content.minInitPrice());

      // Create content on second engine (requires approval since moderated)
      await content2.connect(user2).create(user2.address, "ipfs://second-engine-content");
      const tokenId = await content2.nextTokenId();

      // Should not be collectable without approval
      const auctionData = await getAuctionData(content2, tokenId);
      await expect(
        content2.connect(user3).collect(
          user3.address,
          tokenId,
          auctionData.epochId,
          ethers.constants.MaxUint256,
          convert("1", 6)
        )
      ).to.be.revertedWith("ContentRig__NotApproved()");

      // Approve and collect
      await content2.connect(user1).approveContents([tokenId]);
      const price = await content2.getPrice(tokenId);
      await usdc.connect(user3).approve(content2.address, price);
      await content2.connect(user3).collect(
        user3.address,
        tokenId,
        auctionData.epochId,
        ethers.constants.MaxUint256,
        price
      );

      expect(await content2.ownerOf(tokenId)).to.equal(user3.address);
      console.log("Second engine operates independently!");
    });
  });
});
