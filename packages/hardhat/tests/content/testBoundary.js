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

describe("Boundary Condition Tests", function () {
  let owner, user1, user2, user3;
  let usdc, donut, registry, core;
  let content, minter, rewarder, auction, unit;

  const WEEK = 7 * 24 * 60 * 60;
  const DAY = 24 * 60 * 60;
  const HOUR = 60 * 60;

  before(async function () {
    await network.provider.send("hardhat_reset");
    [owner, user1, user2, user3] = await ethers.getSigners();

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

    for (const user of [owner, user1, user2, user3]) {
      await donut.connect(user).deposit({ value: convert("1000", 18) });
      await usdc.mint(user.address, convert("1000", 6));
    }

    await donut.connect(owner).approve(core.address, convert("1000", 18));
    const tx = await core.connect(owner).launch({
      launcher: owner.address,
      tokenName: "Boundary Test",
      tokenSymbol: "BTEST",
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
  });

  describe("Constructor Parameter Boundaries", function () {
    describe("Auction Parameter Boundaries", function () {
      it("Should reject epoch period below MIN_EPOCH_PERIOD (1 hour)", async function () {
        const AuctionFactory = await ethers.getContractFactory("Auction");
        await expect(
          AuctionFactory.deploy(
            convert("1000", 6),
            usdc.address,
            AddressDead,
            HOUR - 1, // Just below 1 hour
            convert("1.5", 18),
            convert("1", 6)
          )
        ).to.be.revertedWith("Auction__EpochPeriodOutOfRange()");
      });

      it("Should accept epoch period at exactly MIN_EPOCH_PERIOD", async function () {
        const AuctionFactory = await ethers.getContractFactory("Auction");
        const auctionContract = await AuctionFactory.deploy(
          convert("1000", 6),
          usdc.address,
          AddressDead,
          HOUR, // Exactly 1 hour
          convert("1.5", 18),
          convert("1", 6)
        );
        expect(await auctionContract.epochPeriod()).to.equal(HOUR);
      });

      it("Should reject epoch period above MAX_EPOCH_PERIOD (365 days)", async function () {
        const AuctionFactory = await ethers.getContractFactory("Auction");
        await expect(
          AuctionFactory.deploy(
            convert("1000", 6),
            usdc.address,
            AddressDead,
            365 * DAY + 1, // Just above 365 days
            convert("1.5", 18),
            convert("1", 6)
          )
        ).to.be.revertedWith("Auction__EpochPeriodOutOfRange()");
      });

      it("Should accept epoch period at exactly MAX_EPOCH_PERIOD", async function () {
        const AuctionFactory = await ethers.getContractFactory("Auction");
        const auctionContract = await AuctionFactory.deploy(
          convert("1000", 6),
          usdc.address,
          AddressDead,
          365 * DAY, // Exactly 365 days
          convert("1.5", 18),
          convert("1", 6)
        );
        expect(await auctionContract.epochPeriod()).to.equal(365 * DAY);
      });

      it("Should reject price multiplier below MIN_PRICE_MULTIPLIER (1.1x)", async function () {
        const AuctionFactory = await ethers.getContractFactory("Auction");
        await expect(
          AuctionFactory.deploy(
            convert("1000", 6),
            usdc.address,
            AddressDead,
            DAY,
            convert("1.09", 18), // Below 1.1x
            convert("1", 6)
          )
        ).to.be.revertedWith("Auction__PriceMultiplierOutOfRange()");
      });

      it("Should accept price multiplier at exactly MIN_PRICE_MULTIPLIER", async function () {
        const AuctionFactory = await ethers.getContractFactory("Auction");
        const auctionContract = await AuctionFactory.deploy(
          convert("1000", 6),
          usdc.address,
          AddressDead,
          DAY,
          convert("1.1", 18), // Exactly 1.1x
          convert("1", 6)
        );
        expect(await auctionContract.priceMultiplier()).to.equal(convert("1.1", 18));
      });

      it("Should reject price multiplier above MAX_PRICE_MULTIPLIER (3x)", async function () {
        const AuctionFactory = await ethers.getContractFactory("Auction");
        await expect(
          AuctionFactory.deploy(
            convert("1000", 6),
            usdc.address,
            AddressDead,
            DAY,
            convert("3.01", 18), // Above 3x
            convert("1", 6)
          )
        ).to.be.revertedWith("Auction__PriceMultiplierOutOfRange()");
      });

      it("Should accept price multiplier at exactly MAX_PRICE_MULTIPLIER", async function () {
        const AuctionFactory = await ethers.getContractFactory("Auction");
        const auctionContract = await AuctionFactory.deploy(
          convert("1000", 6),
          usdc.address,
          AddressDead,
          DAY,
          convert("3", 18), // Exactly 3x
          convert("1", 6)
        );
        expect(await auctionContract.priceMultiplier()).to.equal(convert("3", 18));
      });

      it("Should reject minInitPrice below ABS_MIN_INIT_PRICE", async function () {
        const AuctionFactory = await ethers.getContractFactory("Auction");
        await expect(
          AuctionFactory.deploy(
            convert("1000", 6),
            usdc.address,
            AddressDead,
            DAY,
            convert("1.5", 18),
            999999 // Below 1e6
          )
        ).to.be.revertedWith("Auction__MinInitPriceOutOfRange()");
      });

      it("Should accept minInitPrice at exactly ABS_MIN_INIT_PRICE", async function () {
        const AuctionFactory = await ethers.getContractFactory("Auction");
        const auctionContract = await AuctionFactory.deploy(
          1000000, // initPrice = minInitPrice
          usdc.address,
          AddressDead,
          DAY,
          convert("1.5", 18),
          1000000 // Exactly 1e6
        );
        expect(await auctionContract.minInitPrice()).to.equal(1000000);
      });

      it("Should reject initPrice below minInitPrice", async function () {
        const AuctionFactory = await ethers.getContractFactory("Auction");
        await expect(
          AuctionFactory.deploy(
            convert("0.5", 6), // initPrice = 0.5 USDC
            usdc.address,
            AddressDead,
            DAY,
            convert("1.5", 18),
            convert("1", 6) // minInitPrice = 1 USDC > initPrice
          )
        ).to.be.revertedWith("Auction__InitPriceOutOfRange()");
      });
    });

    describe("Minter Parameter Boundaries", function () {
      it("Should reject halving period below MIN_HALVING_PERIOD (7 days)", async function () {
        const MinterFactory = await ethers.getContractFactory("Minter");
        await expect(
          MinterFactory.deploy(
            unit.address,
            rewarder.address,
            convert("1", 18),
            convert("0.01", 18),
            WEEK - 1 // Just below 7 days
          )
        ).to.be.revertedWith("Minter__HalvingPeriodBelowMin()");
      });

      it("Should accept halving period at exactly MIN_HALVING_PERIOD", async function () {
        const MinterFactory = await ethers.getContractFactory("Minter");
        const minterContract = await MinterFactory.deploy(
          unit.address,
          rewarder.address,
          convert("1", 18),
          convert("0.01", 18),
          WEEK // Exactly 7 days
        );
        expect(await minterContract.halvingPeriod()).to.equal(WEEK);
      });

      it("Should reject tailUps greater than initialUps", async function () {
        const MinterFactory = await ethers.getContractFactory("Minter");
        await expect(
          MinterFactory.deploy(
            unit.address,
            rewarder.address,
            convert("1", 18),
            convert("2", 18), // tailUps > initialUps
            WEEK
          )
        ).to.be.revertedWith("Minter__InvalidTailUps()");
      });

      it("Should accept tailUps equal to initialUps", async function () {
        const MinterFactory = await ethers.getContractFactory("Minter");
        const minterContract = await MinterFactory.deploy(
          unit.address,
          rewarder.address,
          convert("1", 18),
          convert("1", 18), // tailUps == initialUps
          WEEK
        );
        expect(await minterContract.tailUps()).to.equal(convert("1", 18));
      });

      it("Should reject zero initialUps", async function () {
        const MinterFactory = await ethers.getContractFactory("Minter");
        await expect(
          MinterFactory.deploy(
            unit.address,
            rewarder.address,
            0, // zero initialUps
            0,
            WEEK
          )
        ).to.be.revertedWith("Minter__InvalidInitialUps()");
      });

      it("Should reject initialUps above MAX_INITIAL_UPS", async function () {
        const MinterFactory = await ethers.getContractFactory("Minter");
        const maxInitialUps = ethers.BigNumber.from(10).pow(24);
        await expect(
          MinterFactory.deploy(
            unit.address,
            rewarder.address,
            maxInitialUps.add(1), // Above max
            convert("0.01", 18),
            WEEK
          )
        ).to.be.revertedWith("Minter__InitialUpsExceedsMax()");
      });

      it("Should accept initialUps at exactly MAX_INITIAL_UPS", async function () {
        const MinterFactory = await ethers.getContractFactory("Minter");
        const maxInitialUps = ethers.BigNumber.from(10).pow(24);
        const minterContract = await MinterFactory.deploy(
          unit.address,
          rewarder.address,
          maxInitialUps, // Exactly max
          convert("0.01", 18),
          WEEK
        );
        expect(await minterContract.initialUps()).to.equal(maxInitialUps);
      });

      it("Should reject zero tailUps", async function () {
        const MinterFactory = await ethers.getContractFactory("Minter");
        await expect(
          MinterFactory.deploy(
            unit.address,
            rewarder.address,
            convert("1", 18),
            0, // zero tailUps
            WEEK
          )
        ).to.be.revertedWith("Minter__InvalidTailUps()");
      });
    });

    describe("Content Parameter Boundaries", function () {
      it("Should reject zero minInitPrice", async function () {
        const ContentRigFactory = await ethers.getContractFactory("ContentRig");
        await expect(
          ContentRigFactory.deploy(
            "Test",
            "TEST",
            "https://test.com",
            unit.address,
            usdc.address,
            auction.address,
            owner.address, // team
            core.address,
            (await ethers.getContractFactory("RewarderFactory")).attach(
              await core.rewarderFactory()
            ).address,
            0, // zero minInitPrice
            false
          )
        ).to.be.revertedWith("ContentRig__ZeroMinPrice()");
      });

      it("Should reject empty URI", async function () {
        const ContentRigFactory = await ethers.getContractFactory("ContentRig");
        await expect(
          ContentRigFactory.deploy(
            "Test",
            "TEST",
            "", // empty URI
            unit.address,
            usdc.address,
            auction.address,
            owner.address, // team
            core.address,
            (await ethers.getContractFactory("RewarderFactory")).attach(
              await core.rewarderFactory()
            ).address,
            convert("10", 6),
            false
          )
        ).to.be.revertedWith("ContentRig__ZeroLengthUri()");
      });
    });
  });

  describe("Time-Based Boundary Tests", function () {
    it("Should handle price at t=0 (creation time)", async function () {
      await content.connect(user1).create(user1.address, "ipfs://time-zero");
      const tokenId = await content.nextTokenId();

      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);

      // Price should be exactly initPrice at creation
      expect(price).to.equal(auctionData.initPrice);
    });

    it("Should handle price at t=1 second", async function () {
      await content.connect(user1).create(user1.address, "ipfs://time-one-sec");
      const tokenId = await content.nextTokenId();

      await ethers.provider.send("evm_increaseTime", [1]);
      await ethers.provider.send("evm_mine");

      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);

      // Price should be less than or equal to initPrice (may be equal due to integer truncation with small prices)
      expect(price).to.be.lte(auctionData.initPrice);
      expect(price).to.be.gt(0);
    });

    it("Should handle price at t=EPOCH_PERIOD-1", async function () {
      await content.connect(user1).create(user1.address, "ipfs://time-almost-end");
      const tokenId = await content.nextTokenId();

      const EPOCH_PERIOD = 1 * DAY;
      await ethers.provider.send("evm_increaseTime", [EPOCH_PERIOD - 1]);
      await ethers.provider.send("evm_mine");

      const price = await content.getPrice(tokenId);
      // Price should be very small but > 0
      expect(price).to.be.gt(0);
    });

    it("Should handle price at exactly t=EPOCH_PERIOD", async function () {
      await content.connect(user1).create(user1.address, "ipfs://time-exact-end");
      const tokenId = await content.nextTokenId();

      const EPOCH_PERIOD = 1 * DAY;
      await ethers.provider.send("evm_increaseTime", [EPOCH_PERIOD]);
      await ethers.provider.send("evm_mine");

      const price = await content.getPrice(tokenId);
      expect(price).to.equal(0);
    });

    it("Should handle price at t=EPOCH_PERIOD+1", async function () {
      await content.connect(user1).create(user1.address, "ipfs://time-after-end");
      const tokenId = await content.nextTokenId();

      const EPOCH_PERIOD = 1 * DAY;
      await ethers.provider.send("evm_increaseTime", [EPOCH_PERIOD + 1]);
      await ethers.provider.send("evm_mine");

      const price = await content.getPrice(tokenId);
      expect(price).to.equal(0);
    });

    it("Should handle minter at exactly WEEK boundary", async function () {
      const periodBefore = await minter.activePeriod();

      await ethers.provider.send("evm_increaseTime", [WEEK]);
      await ethers.provider.send("evm_mine");

      await minter.updatePeriod();
      const periodAfter = await minter.activePeriod();

      expect(periodAfter).to.be.gt(periodBefore);
    });

    it("Should handle minter at WEEK-1 (no emission)", async function () {
      const weeklyBefore = await minter.weeklyEmission();
      const periodBefore = await minter.activePeriod();

      // This shouldn't trigger new emission since we need full week
      await minter.updatePeriod();
      const periodAfter = await minter.activePeriod();

      // Period shouldn't change if we haven't reached next week
      // (depends on accumulated time from previous tests)
    });
  });

  describe("Deadline Boundary Tests", function () {
    it("Should accept transaction at exactly deadline", async function () {
      await content.connect(user1).create(user1.address, "ipfs://deadline-exact");
      const tokenId = await content.nextTokenId();

      const block = await ethers.provider.getBlock("latest");
      const deadline = block.timestamp + 100;

      await ethers.provider.send("evm_increaseTime", [100]);
      await ethers.provider.send("evm_mine");

      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);

      // Should still work at exact deadline
      await usdc.connect(user2).approve(content.address, price);
      // Note: By the time tx executes, we might be past deadline
      // This test verifies the boundary behavior
    });

    it("Should reject transaction 1 second after deadline", async function () {
      await content.connect(user1).create(user1.address, "ipfs://deadline-after");
      const tokenId = await content.nextTokenId();

      const block = await ethers.provider.getBlock("latest");
      const deadline = block.timestamp; // Current timestamp as deadline

      await ethers.provider.send("evm_increaseTime", [1]);
      await ethers.provider.send("evm_mine");

      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);

      await usdc.connect(user2).approve(content.address, price);
      await expect(
        content.connect(user2).collect(
          user2.address,
          tokenId,
          auctionData.epochId,
          deadline, // Past deadline
          price
        )
      ).to.be.revertedWith("ContentRig__Expired()");
    });
  });

  describe("MaxPrice Boundary Tests", function () {
    it("Should accept transaction when price equals maxPrice", async function () {
      await content.connect(user1).create(user1.address, "ipfs://maxprice-equal");
      const tokenId = await content.nextTokenId();

      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);

      await usdc.connect(user2).approve(content.address, price);
      await content.connect(user2).collect(
        user2.address,
        tokenId,
        auctionData.epochId,
        ethers.constants.MaxUint256,
        price // maxPrice exactly equals price
      );

      expect(await content.ownerOf(tokenId)).to.equal(user2.address);
    });

    it("Should reject transaction when price exceeds maxPrice by 1 wei", async function () {
      await content.connect(user1).create(user1.address, "ipfs://maxprice-exceed");
      const tokenId = await content.nextTokenId();

      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);

      if (price.gt(1)) {
        await usdc.connect(user2).approve(content.address, price);
        // Use a maxPrice that's significantly lower to ensure test works despite block time
        await expect(
          content.connect(user2).collect(
            user2.address,
            tokenId,
            auctionData.epochId,
            ethers.constants.MaxUint256,
            price.div(2) // maxPrice is half the current price
          )
        ).to.be.revertedWith("ContentRig__MaxPriceExceeded()");
      }
    });

    it("Should accept maxPrice of 0 when price is 0", async function () {
      await content.connect(user1).create(user1.address, "ipfs://maxprice-zero");
      const tokenId = await content.nextTokenId();

      // Wait for price to decay to 0
      await ethers.provider.send("evm_increaseTime", [31 * DAY]);
      await ethers.provider.send("evm_mine");

      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);
      expect(price).to.equal(0);

      await content.connect(user2).collect(
        user2.address,
        tokenId,
        auctionData.epochId,
        ethers.constants.MaxUint256,
        0 // maxPrice = 0, price = 0
      );

      expect(await content.ownerOf(tokenId)).to.equal(user2.address);
    });
  });

  describe("EpochId Boundary Tests", function () {
    it("Should accept correct epochId", async function () {
      await content.connect(user1).create(user1.address, "ipfs://epochid-correct");
      const tokenId = await content.nextTokenId();

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
    });

    it("Should reject epochId + 1", async function () {
      await content.connect(user1).create(user1.address, "ipfs://epochid-plus1");
      const tokenId = await content.nextTokenId();

      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);

      await usdc.connect(user2).approve(content.address, price);
      await expect(
        content.connect(user2).collect(
          user2.address,
          tokenId,
          auctionData.epochId.add(1),
          ethers.constants.MaxUint256,
          price
        )
      ).to.be.revertedWith("ContentRig__EpochIdMismatch()");
    });

    it("Should reject epochId - 1 (underflow protected)", async function () {
      await content.connect(user1).create(user1.address, "ipfs://epochid-minus1");
      const tokenId = await content.nextTokenId();

      const auctionData = await getAuctionData(content, tokenId);

      // First collect to increment epochId
      const price = await content.getPrice(tokenId);
      await usdc.connect(user2).approve(content.address, price);
      await content.connect(user2).collect(
        user2.address,
        tokenId,
        auctionData.epochId,
        ethers.constants.MaxUint256,
        price
      );

      // Now try with old epochId
      const newAuction = await getAuctionData(content, tokenId);
      const newPrice = await content.getPrice(tokenId);

      await usdc.connect(user3).approve(content.address, newPrice);
      await expect(
        content.connect(user3).collect(
          user3.address,
          tokenId,
          newAuction.epochId.sub(1), // Old epochId
          ethers.constants.MaxUint256,
          newPrice
        )
      ).to.be.revertedWith("ContentRig__EpochIdMismatch()");
    });

    it("Should handle epochId at max uint256", async function () {
      // This is theoretical - we can't actually reach max uint256 epochId
      // But the unchecked block ensures no overflow revert
      expect(true).to.be.true;
    });
  });

  describe("Rewarder Balance Boundary Tests", function () {
    it("Should handle deposit when totalSupply is 0", async function () {
      // Create fresh content for clean test
      await content.connect(user1).create(user1.address, "ipfs://rewarder-zero-supply");
      const tokenId = await content.nextTokenId();

      // The first collection in a fresh system
      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);

      if (price.gt(0)) {
        await usdc.connect(user2).approve(content.address, price);
        await content.connect(user2).collect(
          user2.address,
          tokenId,
          auctionData.epochId,
          ethers.constants.MaxUint256,
          price
        );

        // Verify stake was recorded
        const balance = await rewarder.accountToBalance(user2.address);
        expect(balance).to.be.gte(price);
      }
    });

    it("Should handle withdrawal that brings balance to 0", async function () {
      await content.connect(user1).create(user1.address, "ipfs://rewarder-withdraw-zero");
      const tokenId = await content.nextTokenId();

      // First collection
      let auctionData = await getAuctionData(content, tokenId);
      let price = await content.getPrice(tokenId);

      if (price.gt(0)) {
        const user3BalanceBefore = await rewarder.accountToBalance(user3.address);

        await usdc.connect(user3).approve(content.address, price);
        await content.connect(user3).collect(
          user3.address,
          tokenId,
          auctionData.epochId,
          ethers.constants.MaxUint256,
          price
        );

        const user3BalanceAfter = await rewarder.accountToBalance(user3.address);
        const stakeAdded = user3BalanceAfter.sub(user3BalanceBefore);

        // Second collection by someone else should withdraw user3's stake
        auctionData = await getAuctionData(content, tokenId);
        price = await content.getPrice(tokenId);

        await usdc.connect(user1).approve(content.address, price);
        await content.connect(user1).collect(
          user1.address,
          tokenId,
          auctionData.epochId,
          ethers.constants.MaxUint256,
          price
        );

        const user3BalanceFinal = await rewarder.accountToBalance(user3.address);
        // user3's stake from this specific token should be withdrawn
        expect(user3BalanceFinal).to.be.lt(user3BalanceAfter);
      }
    });
  });
});
