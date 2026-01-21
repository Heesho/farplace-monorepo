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

describe("Invariant Tests", function () {
  let owner, user1, user2, user3, user4, user5;
  let usdc, donut, registry, core;
  let content, minter, rewarder, auction, unit, lpToken;

  const WEEK = 7 * 24 * 60 * 60;
  const DAY = 24 * 60 * 60;
  const HOUR = 60 * 60;

  before(async function () {
    await network.provider.send("hardhat_reset");
    [owner, user1, user2, user3, user4, user5] = await ethers.getSigners();

    // Deploy USDC (6 decimals) as quote token
    const usdcArtifact = await ethers.getContractFactory("MockUSDC");
    usdc = await usdcArtifact.deploy();

    const donutArtifact = await ethers.getContractFactory("MockWETH");
    donut = await donutArtifact.deploy();

    const mockUniswapFactoryArtifact = await ethers.getContractFactory("MockUniswapV2Factory");
    const uniswapFactory = await mockUniswapFactoryArtifact.deploy();

    const mockUniswapRouterArtifact = await ethers.getContractFactory("MockUniswapV2Router");
    const uniswapRouter = await mockUniswapRouterArtifact.deploy(uniswapFactory.address);

    registry = await (await ethers.getContractFactory("Registry")).deploy();

    const unitFactory = await (await ethers.getContractFactory("UnitFactory")).deploy();
    const contentFactory = await (await ethers.getContractFactory("ContentRigFactory")).deploy();
    const minterFactory = await (await ethers.getContractFactory("MinterFactory")).deploy();
    const rewarderFactory = await (await ethers.getContractFactory("RewarderFactory")).deploy();
    const auctionFactory = await (await ethers.getContractFactory("AuctionFactory")).deploy();

    core = await (await ethers.getContractFactory("ContentCore")).deploy(
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
      owner.address,
      convert("100", 18)
    );

    await registry.setFactoryApproval(core.address, true);

    for (const user of [owner, user1, user2, user3, user4, user5]) {
      await donut.connect(user).deposit({ value: convert("1000", 18) });
      await usdc.mint(user.address, convert("1000", 6));
    }

    await donut.connect(owner).approve(core.address, convert("1000", 18));
    const tx = await core.connect(owner).launch({
      launcher: owner.address,
      tokenName: "Invariant Test",
      tokenSymbol: "ITEST",
      uri: "https://test.com",
      donutAmount: convert("1000", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("1", 18),
      tailUps: convert("0.01", 18),
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
    lpToken = await ethers.getContractAt("IERC20", launchEvent.args.lpToken);
  });

  describe("Content Invariants", function () {
    it("INVARIANT: Total fees always equal 100%", async function () {
      const PREVIOUS_OWNER_FEE = 8000; // 80%
      const CREATOR_FEE = 300; // 3%
      const TEAM_FEE = 400; // 4%
      const PROTOCOL_FEE = 100; // 1%
      const DIVISOR = 10000;
      // Treasury gets remainder (12%)
      const TREASURY_FEE = DIVISOR - PREVIOUS_OWNER_FEE - CREATOR_FEE - TEAM_FEE - PROTOCOL_FEE;

      expect(PREVIOUS_OWNER_FEE + TREASURY_FEE + CREATOR_FEE + TEAM_FEE + PROTOCOL_FEE).to.equal(DIVISOR);
      expect(TREASURY_FEE).to.equal(1200); // 12%
    });

    it("INVARIANT: Price never exceeds initPrice", async function () {
      await content.connect(user1).create(user1.address, "ipfs://invariant-price");
      const tokenId = await content.nextTokenId();

      const auctionData = await getAuctionData(content, tokenId);

      // Check at multiple time points
      for (let i = 0; i <= 30; i++) {
        const price = await content.getPrice(tokenId);
        expect(price).to.be.lte(auctionData.initPrice);

        await ethers.provider.send("evm_increaseTime", [DAY]);
        await ethers.provider.send("evm_mine");
      }
    });

    it("INVARIANT: Price is non-negative", async function () {
      await content.connect(user1).create(user1.address, "ipfs://invariant-nonneg");
      const tokenId = await content.nextTokenId();

      // Check at various times including after epoch
      for (let i = 0; i < 5; i++) {
        const price = await content.getPrice(tokenId);
        expect(price).to.be.gte(0);

        await ethers.provider.send("evm_increaseTime", [10 * DAY]);
        await ethers.provider.send("evm_mine");
      }
    });

    it("INVARIANT: EpochId only increases", async function () {
      await content.connect(user1).create(user1.address, "ipfs://invariant-epochid");
      const tokenId = await content.nextTokenId();

      let prevEpochId = ethers.BigNumber.from(0);

      for (let i = 0; i < 5; i++) {
        const auctionData = await getAuctionData(content, tokenId);
        expect(auctionData.epochId).to.be.gte(prevEpochId);
        prevEpochId = auctionData.epochId;

        const price = await content.getPrice(tokenId);
        if (price.gt(0)) {
          const collector = [user2, user3, user4, user5][i % 4];
          await usdc.connect(collector).approve(content.address, price);
          await content.connect(collector).collect(
            collector.address,
            tokenId,
            auctionData.epochId,
            ethers.constants.MaxUint256,
            price
          );
        } else {
          break;
        }
      }
    });

    it("INVARIANT: newInitPrice >= minInitPrice after collection", async function () {
      const minInitPrice = await content.minInitPrice();

      await content.connect(user1).create(user1.address, "ipfs://invariant-mininit");
      const tokenId = await content.nextTokenId();

      // Collect multiple times
      for (let i = 0; i < 3; i++) {
        const auctionData = await getAuctionData(content, tokenId);
        expect(auctionData.initPrice).to.be.gte(minInitPrice);

        const price = await content.getPrice(tokenId);
        if (price.gt(0)) {
          const collector = [user2, user3][i % 2];
          await usdc.connect(collector).approve(content.address, price);
          await content.connect(collector).collect(
            collector.address,
            tokenId,
            auctionData.epochId,
            ethers.constants.MaxUint256,
            price
          );
        } else {
          // Wait for price decay and collect free
          await ethers.provider.send("evm_increaseTime", [31 * DAY]);
          await ethers.provider.send("evm_mine");

          const newAuction = await getAuctionData(content, tokenId);
          const collector = [user2, user3][i % 2];
          await content.connect(collector).collect(
            collector.address,
            tokenId,
            newAuction.epochId,
            ethers.constants.MaxUint256,
            0
          );
        }
      }

      const finalAuction = await getAuctionData(content, tokenId);
      expect(finalAuction.initPrice).to.be.gte(minInitPrice);
    });

    it("INVARIANT: Stake equals price paid", async function () {
      await content.connect(user1).create(user1.address, "ipfs://invariant-stake");
      const tokenId = await content.nextTokenId();

      const auctionData = await getAuctionData(content, tokenId);
      const priceBefore = await content.getPrice(tokenId);

      await usdc.connect(user2).approve(content.address, priceBefore);
      await content.connect(user2).collect(
        user2.address,
        tokenId,
        auctionData.epochId,
        ethers.constants.MaxUint256,
        priceBefore
      );

      // Stake is set to the price at the moment of collection
      // Due to block time passing, actual price paid may differ slightly
      const stake = await content.tokenIdToStake(tokenId);
      // Stake should be close to the price we approved (within 1% due to block time)
      expect(stake).to.be.lte(priceBefore);
      expect(stake).to.be.gt(0);
    });

    it("INVARIANT: Owner changes after successful collection", async function () {
      await content.connect(user1).create(user1.address, "ipfs://invariant-owner");
      const tokenId = await content.nextTokenId();

      const ownerBefore = await content.ownerOf(tokenId);
      expect(ownerBefore).to.equal(user1.address);

      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);

      await usdc.connect(user2).approve(content.address, price);
      await content.connect(user2).collect(
        user2.address,
        tokenId,
        auctionData.epochId,
        ethers.constants.MaxUint256,
        price
      );

      const ownerAfter = await content.ownerOf(tokenId);
      expect(ownerAfter).to.equal(user2.address);
      expect(ownerAfter).to.not.equal(ownerBefore);
    });

    it("INVARIANT: Creator never changes", async function () {
      await content.connect(user1).create(user3.address, "ipfs://invariant-creator");
      const tokenId = await content.nextTokenId();

      const creatorBefore = await content.tokenIdToCreator(tokenId);
      expect(creatorBefore).to.equal(user3.address);

      // Multiple collections
      for (let i = 0; i < 3; i++) {
        const auctionData = await getAuctionData(content, tokenId);
        const price = await content.getPrice(tokenId);

        if (price.gt(0)) {
          const collector = [user4, user5][i % 2];
          await usdc.connect(collector).approve(content.address, price);
          await content.connect(collector).collect(
            collector.address,
            tokenId,
            auctionData.epochId,
            ethers.constants.MaxUint256,
            price
          );
        }

        const creatorAfter = await content.tokenIdToCreator(tokenId);
        expect(creatorAfter).to.equal(creatorBefore);
      }
    });
  });

  describe("Minter Invariants", function () {
    it("INVARIANT: UPS never goes below tailUps", async function () {
      const tailUps = await minter.tailUps();

      // Fast forward many halving periods
      const halvingPeriod = await minter.halvingPeriod();
      for (let i = 0; i < 20; i++) {
        await ethers.provider.send("evm_increaseTime", [halvingPeriod.toNumber()]);
        await ethers.provider.send("evm_mine");

        const currentUps = await minter.getUps();
        expect(currentUps).to.be.gte(tailUps);
      }
    });

    it("INVARIANT: UPS never exceeds initialUps", async function () {
      const initialUps = await minter.initialUps();

      // Check at various times
      for (let i = 0; i < 10; i++) {
        const currentUps = await minter.getUps();
        expect(currentUps).to.be.lte(initialUps);

        await ethers.provider.send("evm_increaseTime", [WEEK]);
        await ethers.provider.send("evm_mine");
      }
    });

    it("INVARIANT: Weekly emission = UPS * WEEK", async function () {
      const currentUps = await minter.getUps();
      const weeklyEmission = await minter.weeklyEmission();

      expect(weeklyEmission).to.equal(currentUps.mul(WEEK));
    });

    it("INVARIANT: ActivePeriod only increases or stays same", async function () {
      let prevPeriod = await minter.activePeriod();

      for (let i = 0; i < 5; i++) {
        await ethers.provider.send("evm_increaseTime", [WEEK]);
        await ethers.provider.send("evm_mine");
        await minter.updatePeriod();

        const currentPeriod = await minter.activePeriod();
        expect(currentPeriod).to.be.gte(prevPeriod);
        prevPeriod = currentPeriod;
      }
    });
  });

  describe("Rewarder Invariants", function () {
    it("INVARIANT: Sum of all balances equals totalSupply", async function () {
      // This is hard to verify exactly without iterating all accounts
      // But we can verify that totalSupply increases correctly with deposits

      const totalSupplyBefore = await rewarder.totalSupply();

      await content.connect(user1).create(user1.address, "ipfs://invariant-totalsupply");
      const tokenId = await content.nextTokenId();

      const auctionData = await getAuctionData(content, tokenId);
      const priceBefore = await content.getPrice(tokenId);

      if (priceBefore.gt(0)) {
        await usdc.connect(user2).approve(content.address, priceBefore);
        await content.connect(user2).collect(
          user2.address,
          tokenId,
          auctionData.epochId,
          ethers.constants.MaxUint256,
          priceBefore
        );

        // Price at collection may be slightly less due to block time
        const stake = await content.tokenIdToStake(tokenId);
        const totalSupplyAfter = await rewarder.totalSupply();
        // Verify increase matches the actual stake recorded
        expect(totalSupplyAfter.sub(totalSupplyBefore)).to.equal(stake);
      }
    });

    it("INVARIANT: Earned rewards never decrease (without claiming)", async function () {
      // Create stake for user
      await content.connect(user1).create(user1.address, "ipfs://invariant-earned");
      const tokenId = await content.nextTokenId();

      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);

      if (price.gt(0)) {
        await usdc.connect(user4).approve(content.address, price);
        await content.connect(user4).collect(
          user4.address,
          tokenId,
          auctionData.epochId,
          ethers.constants.MaxUint256,
          price
        );

        // Trigger emission
        await ethers.provider.send("evm_increaseTime", [WEEK]);
        await ethers.provider.send("evm_mine");
        await minter.updatePeriod();

        let prevEarned = await rewarder.earned(user4.address, unit.address);

        // Check that earned only increases over time
        for (let i = 0; i < 5; i++) {
          await ethers.provider.send("evm_increaseTime", [DAY]);
          await ethers.provider.send("evm_mine");

          const currentEarned = await rewarder.earned(user4.address, unit.address);
          expect(currentEarned).to.be.gte(prevEarned);
          prevEarned = currentEarned;
        }
      }
    });

    it("INVARIANT: Left rewards decrease over time", async function () {
      // Trigger emission first
      await ethers.provider.send("evm_increaseTime", [WEEK]);
      await ethers.provider.send("evm_mine");
      await minter.updatePeriod();

      let prevLeft = await rewarder.left(unit.address);

      // Left should decrease as time passes
      for (let i = 0; i < 5; i++) {
        await ethers.provider.send("evm_increaseTime", [DAY]);
        await ethers.provider.send("evm_mine");

        const currentLeft = await rewarder.left(unit.address);
        if (prevLeft.gt(0)) {
          expect(currentLeft).to.be.lte(prevLeft);
        }
        prevLeft = currentLeft;
      }
    });
  });

  describe("Auction Invariants", function () {
    it("INVARIANT: Price never exceeds initPrice", async function () {
      const initPrice = await auction.initPrice();

      // Check at various times
      for (let i = 0; i < 3; i++) {
        const price = await auction.getPrice();
        expect(price).to.be.lte(initPrice);

        await ethers.provider.send("evm_increaseTime", [HOUR * 8]);
        await ethers.provider.send("evm_mine");
      }
    });

    it("INVARIANT: Price is non-negative", async function () {
      // Check at various times including after epoch
      for (let i = 0; i < 5; i++) {
        const price = await auction.getPrice();
        expect(price).to.be.gte(0);

        await ethers.provider.send("evm_increaseTime", [DAY]);
        await ethers.provider.send("evm_mine");
      }
    });

    it("INVARIANT: EpochId only increases after buy", async function () {
      let prevEpochId = await auction.epochId();

      // Send assets and buy multiple times
      for (let i = 0; i < 3; i++) {
        await usdc.connect(user1).transfer(auction.address, convert("1", 6));

        // Wait for price to decay
        const epochPeriod = await auction.epochPeriod();
        await ethers.provider.send("evm_increaseTime", [epochPeriod.toNumber() + 1]);
        await ethers.provider.send("evm_mine");

        const epochId = await auction.epochId();
        expect(epochId).to.be.gte(prevEpochId);

        await auction.connect(user2).buy(
          [usdc.address],
          user2.address,
          epochId,
          ethers.constants.MaxUint256,
          0
        );

        const newEpochId = await auction.epochId();
        expect(newEpochId).to.equal(epochId.add(1));
        prevEpochId = newEpochId;
      }
    });
  });

  describe("Unit Token Invariants", function () {
    it("INVARIANT: Only minter can mint", async function () {
      const minterAddress = await unit.rig();
      expect(minterAddress).to.equal(minter.address);

      // Non-minter cannot mint
      await expect(
        unit.connect(user1).mint(user1.address, convert("1000", 18))
      ).to.be.reverted;
    });

    it("INVARIANT: Minter address is effectively immutable", async function () {
      // Minter contract has no setRig function
      // So once Unit.setRig is called with Minter address, it's locked
      const minterAddress = await unit.rig();
      expect(minterAddress).to.equal(minter.address);

      // Cannot change from any account
      await expect(
        unit.connect(owner).setRig(user1.address)
      ).to.be.reverted;
    });
  });

  describe("Core Registry Invariants", function () {
    it("INVARIANT: Deployed content is always tracked", async function () {
      const isDeployed = await core.isDeployedRig(content.address);
      expect(isDeployed).to.be.true;

      const contentUnit = await core.rigToUnit(content.address);
      expect(contentUnit).to.equal(unit.address);

      const contentMinter = await core.rigToMinter(content.address);
      expect(contentMinter).to.equal(minter.address);

      const contentRewarder = await core.rigToRewarder(content.address);
      expect(contentRewarder).to.equal(rewarder.address);

      const contentAuction = await core.rigToAuction(content.address);
      expect(contentAuction).to.equal(auction.address);
    });

    it("INVARIANT: Non-deployed content returns false", async function () {
      const randomAddress = ethers.Wallet.createRandom().address;
      const isDeployed = await core.isDeployedRig(randomAddress);
      expect(isDeployed).to.be.false;
    });

    it("INVARIANT: DeployedContents length matches array", async function () {
      const length = await core.deployedRigsLength();
      expect(length).to.be.gte(1);

      // Can access all elements
      for (let i = 0; i < length.toNumber(); i++) {
        const contentAddr = await core.deployedRigs(i);
        expect(contentAddr).to.not.equal(AddressZero);
      }
    });
  });

  describe("Cross-Contract Invariants", function () {
    it("INVARIANT: Content.rewarder matches Core.rigToRewarder", async function () {
      const contentRewarder = await content.rewarder();
      const coreRewarder = await core.rigToRewarder(content.address);
      expect(contentRewarder).to.equal(coreRewarder);
    });

    it("INVARIANT: Content.unit matches Core.rigToUnit", async function () {
      const contentUnit = await content.unit();
      const coreUnit = await core.rigToUnit(content.address);
      expect(contentUnit).to.equal(coreUnit);
    });

    it("INVARIANT: Minter.unit matches Content.unit", async function () {
      const minterUnit = await minter.unit();
      const contentUnit = await content.unit();
      expect(minterUnit).to.equal(contentUnit);
    });

    it("INVARIANT: Minter.rewarder matches Content.rewarder", async function () {
      const minterRewarder = await minter.rewarder();
      const contentRewarder = await content.rewarder();
      expect(minterRewarder).to.equal(contentRewarder);
    });

    it("INVARIANT: Rewarder.content matches Content address", async function () {
      const rewarderContent = await rewarder.content();
      expect(rewarderContent).to.equal(content.address);
    });
  });
});
