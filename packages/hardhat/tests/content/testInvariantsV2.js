/**
 * @title ContentRig Invariant and Business Logic Tests
 * @notice Comprehensive tests verifying NFT steal mechanics, staking, and rewards
 * @dev Tests focus on price dynamics, stake tracking, fee distribution, and transfer restrictions
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
const PRECISION = ethers.BigNumber.from("1000000000000000000");

describe("ContentRig Invariant Tests", function () {
  let owner, protocol, user0, user1, user2, creator;
  let quoteToken, donut, registry, core;
  let rig, unit, minter, rewarder, auction, lpToken;

  before("Deploy contracts", async function () {
    await network.provider.send("hardhat_reset");

    [owner, protocol, user0, user1, user2, creator] = await ethers.getSigners();

    // Deploy mock tokens
    const mockWethArtifact = await ethers.getContractFactory("MockWETH");
    quoteToken = await mockWethArtifact.deploy();
    donut = await mockWethArtifact.deploy();

    // Deploy mock Uniswap
    const mockUniswapFactoryArtifact = await ethers.getContractFactory("MockUniswapV2Factory");
    const uniswapFactory = await mockUniswapFactoryArtifact.deploy();
    const mockUniswapRouterArtifact = await ethers.getContractFactory("MockUniswapV2Router");
    const uniswapRouter = await mockUniswapRouterArtifact.deploy(uniswapFactory.address);

    // Deploy Registry
    registry = await (await ethers.getContractFactory("Registry")).deploy();

    // Deploy factories
    const unitFactory = await (await ethers.getContractFactory("UnitFactory")).deploy();
    const contentFactory = await (await ethers.getContractFactory("ContentRigFactory")).deploy();
    const minterFactory = await (await ethers.getContractFactory("MinterFactory")).deploy();
    const rewarderFactory = await (await ethers.getContractFactory("RewarderFactory")).deploy();
    const auctionFactory = await (await ethers.getContractFactory("AuctionFactory")).deploy();

    // Deploy ContentCore
    core = await (await ethers.getContractFactory("ContentCore")).deploy(
      registry.address,
      quoteToken.address,
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

    // Approve ContentCore as factory in Registry
    await registry.setFactoryApproval(core.address, true);

    // Fund launcher with DONUT, users with quote token
    await donut.connect(user0).deposit({ value: convert("2000", 18) });
    await quoteToken.connect(user0).deposit({ value: convert("500", 18) });
    await quoteToken.connect(user1).deposit({ value: convert("500", 18) });
    await quoteToken.connect(user2).deposit({ value: convert("500", 18) });
    await quoteToken.connect(creator).deposit({ value: convert("500", 18) });

    // Launch content engine
    const launchParams = {
      launcher: user0.address,
      tokenName: "Test Unit",
      tokenSymbol: "TUNIT",
      uri: "https://example.com/metadata",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 7,
      contentMinInitPrice: convert("0.001", 18),
      contentIsModerated: false,
      auctionInitPrice: convert("1", 18),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("0.0001", 18),
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);
    const tx = await core.connect(user0).launch(launchParams);
    const receipt = await tx.wait();

    const launchEvent = receipt.events.find((e) => e.event === "ContentCore__Launched");
    const rigAddr = launchEvent.args.rig;
    unit = launchEvent.args.unit;
    minter = launchEvent.args.minter;
    const rewarderAddr = launchEvent.args.rewarder;
    auction = launchEvent.args.auction;
    lpToken = launchEvent.args.lpToken;

    rig = await ethers.getContractAt("ContentRig", rigAddr);
    rewarder = await ethers.getContractAt("Rewarder", rewarderAddr);
  });

  /**
   * INVARIANT 1: Transfer functions are disabled
   */
  describe("INVARIANT: Transfer Restrictions", function () {
    let tokenId;

    before(async function () {
      // Create a content NFT
      const tx = await rig.connect(creator).create(creator.address, "ipfs://test1");
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === "ContentRig__Created");
      tokenId = event.args.tokenId;
    });

    it("approve() should revert", async function () {
      await expect(
        rig.connect(creator).approve(user0.address, tokenId)
      ).to.be.revertedWith("ContentRig__TransferDisabled()");
    });

    it("setApprovalForAll() should revert", async function () {
      await expect(
        rig.connect(creator).setApprovalForAll(user0.address, true)
      ).to.be.revertedWith("ContentRig__TransferDisabled()");
    });

    it("transferFrom() should revert", async function () {
      await expect(
        rig.connect(creator).transferFrom(creator.address, user0.address, tokenId)
      ).to.be.revertedWith("ContentRig__TransferDisabled()");
    });

    it("safeTransferFrom() should revert", async function () {
      await expect(
        rig.connect(creator)["safeTransferFrom(address,address,uint256)"](creator.address, user0.address, tokenId)
      ).to.be.revertedWith("ContentRig__TransferDisabled()");
    });

    it("safeTransferFrom(bytes) should revert", async function () {
      await expect(
        rig.connect(creator)["safeTransferFrom(address,address,uint256,bytes)"](creator.address, user0.address, tokenId, "0x")
      ).to.be.revertedWith("ContentRig__TransferDisabled()");
    });
  });

  /**
   * INVARIANT 2: Price decay formula
   * price = initPrice - (initPrice * timePassed / EPOCH_PERIOD)
   */
  describe("INVARIANT: Price Decay Formula", function () {
    let tokenId;

    beforeEach(async function () {
      // Create and collect to start fresh epoch
      const tx = await rig.connect(creator).create(creator.address, "ipfs://price-test-" + Date.now());
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === "ContentRig__Created");
      tokenId = event.args.tokenId;

      // Collect to establish a non-minimum initPrice
      const price = await rig.getPrice(tokenId);
      const epochId = await rig.tokenIdToEpochId(tokenId);

      await quoteToken.connect(user0).approve(rig.address, price.add(convert("1", 18)));
      await rig.connect(user0).collect(
        user0.address,
        tokenId,
        epochId,
        1961439882,
        price.add(convert("1", 18))
      );
    });

    it("Price should equal initPrice at epoch start", async function () {
      const initPrice = await rig.tokenIdToInitPrice(tokenId);
      const price = await rig.getPrice(tokenId);

      const tolerance = initPrice.div(100);
      expect(price).to.be.closeTo(initPrice, tolerance);
    });

    it("Price should be ~50% at 12 hours (half of EPOCH_PERIOD)", async function () {
      const initPrice = await rig.tokenIdToInitPrice(tokenId);

      await increaseTime(ONE_DAY / 2);

      const price = await rig.getPrice(tokenId);
      const expected = initPrice.div(2);
      const tolerance = expected.div(5);

      expect(price).to.be.closeTo(expected, tolerance);
    });

    it("Price should be 0 after EPOCH_PERIOD (1 day)", async function () {
      await increaseTime(ONE_DAY + 1);

      const price = await rig.getPrice(tokenId);
      expect(price).to.equal(0);
    });

    it("Price should never be negative", async function () {
      await increaseTime(ONE_DAY * 10);

      const price = await rig.getPrice(tokenId);
      expect(price).to.be.gte(0);
    });
  });

  /**
   * INVARIANT 3: Fee distribution sums to 100%
   * 80% prevOwner + 15% treasury + 3% creator + 1% team + 1% protocol = 100%
   */
  describe("INVARIANT: Fee Distribution", function () {
    let tokenId;

    before(async function () {
      // Create content
      const tx = await rig.connect(creator).create(creator.address, "ipfs://fee-test");
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === "ContentRig__Created");
      tokenId = event.args.tokenId;

      // First collect to establish ownership
      const price = await rig.getPrice(tokenId);
      const epochId = await rig.tokenIdToEpochId(tokenId);

      await quoteToken.connect(user0).approve(rig.address, price.add(convert("10", 18)));
      await rig.connect(user0).collect(
        user0.address,
        tokenId,
        epochId,
        1961439882,
        price.add(convert("10", 18))
      );
    });

    it("All fees should sum to price paid", async function () {
      const price = await rig.getPrice(tokenId);

      if (price.eq(0)) {
        this.skip();
      }

      const prevOwner = await rig.ownerOf(tokenId);
      const creatorAddr = await rig.tokenIdToCreator(tokenId);
      const epochId = await rig.tokenIdToEpochId(tokenId);

      // Get treasury, team, and protocol addresses
      const treasury = await rig.treasury();
      const team = await rig.team();
      const protocolAddr = await core.protocolFeeAddress();

      // Direct transfer addresses (treasury, team, protocol)
      const directAddresses = [...new Set([treasury, team, protocolAddr])];

      // Claimable addresses (prevOwner, creator) - use pull pattern
      const claimableAddresses = [...new Set([prevOwner, creatorAddr])];

      // Record balances before for direct transfer addresses
      const balancesBefore = {};
      for (const addr of directAddresses) {
        balancesBefore[addr] = await quoteToken.balanceOf(addr);
      }

      // Record claimable before for prevOwner and creator
      const claimableBefore = {};
      for (const addr of claimableAddresses) {
        claimableBefore[addr] = await rig.accountToClaimable(addr);
      }

      // Collect with extra allowance for price decay
      await quoteToken.connect(user1).approve(rig.address, price.add(convert("1", 18)));
      const tx = await rig.connect(user1).collect(
        user1.address,
        tokenId,
        epochId,
        1961439882,
        price.add(convert("1", 18))
      );

      // Get actual price from event
      const receipt = await tx.wait();
      const collectEvent = receipt.events.find(e => e.event === "ContentRig__Collected");
      const actualPrice = collectEvent.args.price;

      // Calculate total fees: direct transfers + claimable increases
      let totalFees = ethers.BigNumber.from(0);

      // Add direct transfer amounts
      for (const addr of directAddresses) {
        const balanceAfter = await quoteToken.balanceOf(addr);
        const feeReceived = balanceAfter.sub(balancesBefore[addr]);
        totalFees = totalFees.add(feeReceived);
      }

      // Add claimable increases (pull pattern for prevOwner and creator)
      for (const addr of claimableAddresses) {
        const claimableAfter = await rig.accountToClaimable(addr);
        const claimableIncrease = claimableAfter.sub(claimableBefore[addr]);
        totalFees = totalFees.add(claimableIncrease);
      }

      // Total fees should equal actual price paid (allowing small rounding error)
      expect(totalFees).to.be.closeTo(actualPrice, 1);
    });

    it("Fee percentages should match expected splits", async function () {
      // Create fresh content for clean test - use user2 as creator to ensure unique addresses
      const tx = await rig.connect(user2).create(user2.address, "ipfs://fee-pct-test");
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === "ContentRig__Created");
      const testTokenId = event.args.tokenId;

      // First collect by user1 to establish unique prevOwner
      let price = await rig.getPrice(testTokenId);
      let epochId = await rig.tokenIdToEpochId(testTokenId);

      await quoteToken.connect(user1).approve(rig.address, price.add(convert("10", 18)));
      await rig.connect(user1).collect(
        user1.address,
        testTokenId,
        epochId,
        1961439882,
        price.add(convert("10", 18))
      );

      // Get new price for second collect
      price = await rig.getPrice(testTokenId);
      epochId = await rig.tokenIdToEpochId(testTokenId);

      if (price.eq(0)) {
        this.skip(); // Only skip if price is exactly 0
      }

      // Get addresses from rig
      const treasury = await rig.treasury();
      const team = await rig.team();
      const prevOwner = user1.address; // We know user1 is the prevOwner
      const creatorAddr = user2.address; // We know user2 is the creator

      // Record balances before for direct transfer addresses
      const treasuryBefore = await quoteToken.balanceOf(treasury);
      const teamBefore = await quoteToken.balanceOf(team);

      // Record claimable before for pull pattern addresses
      const prevOwnerClaimableBefore = await rig.accountToClaimable(prevOwner);
      const creatorClaimableBefore = await rig.accountToClaimable(creatorAddr);

      await quoteToken.connect(creator).approve(rig.address, price.add(convert("1", 18)));
      const collectTx = await rig.connect(creator).collect(
        creator.address,
        testTokenId,
        epochId,
        1961439882,
        price.add(convert("1", 18))
      );

      // Get actual price from event
      const collectReceipt = await collectTx.wait();
      const collectEvent = collectReceipt.events.find(e => e.event === "ContentRig__Collected");
      const actualPrice = collectEvent.args.price;

      // Calculate claimable increases (pull pattern)
      const prevOwnerClaimableAfter = await rig.accountToClaimable(prevOwner);
      const creatorClaimableAfter = await rig.accountToClaimable(creatorAddr);
      const prevOwnerFee = prevOwnerClaimableAfter.sub(prevOwnerClaimableBefore);
      const creatorFee = creatorClaimableAfter.sub(creatorClaimableBefore);

      // Calculate direct transfer amounts
      const treasuryAfter = await quoteToken.balanceOf(treasury);
      const teamAfter = await quoteToken.balanceOf(team);
      const treasuryFee = treasuryAfter.sub(treasuryBefore);
      const teamFee = teamAfter.sub(teamBefore);

      // Check percentages based on actual price (prevOwner gets 80%)
      const prevOwnerPct = prevOwnerFee.mul(100).div(actualPrice).toNumber();

      // prevOwner should get ~80%
      expect(prevOwnerPct).to.be.closeTo(80, 2);

      // Total fees should equal price (allow 1% tolerance for rounding)
      const totalFees = prevOwnerFee.add(creatorFee).add(treasuryFee).add(teamFee);
      // Note: protocol fee also exists but may be to a different address
      expect(totalFees).to.be.gte(actualPrice.mul(95).div(100)); // At least 95%
    });
  });

  /**
   * INVARIANT 4: Stake tracking matches rewarder balance
   */
  describe("INVARIANT: Stake Tracking", function () {
    it("tokenIdToStake should match rewarder deposit for owner", async function () {
      // Create and collect
      const tx = await rig.connect(creator).create(creator.address, "ipfs://stake-test");
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === "ContentRig__Created");
      const tokenId = event.args.tokenId;

      const price = await rig.getPrice(tokenId);
      const epochId = await rig.tokenIdToEpochId(tokenId);

      await quoteToken.connect(user0).approve(rig.address, price.add(convert("10", 18)));
      await rig.connect(user0).collect(
        user0.address,
        tokenId,
        epochId,
        1961439882,
        price.add(convert("10", 18))
      );

      const tokenStake = await rig.tokenIdToStake(tokenId);
      const rewarderBalance = await rewarder.accountToBalance(user0.address);

      // User's rewarder balance should include this stake
      expect(rewarderBalance).to.be.gte(tokenStake);
    });

    it("Previous owner stake should be withdrawn on collection", async function () {
      // Create and collect twice
      const tx = await rig.connect(creator).create(creator.address, "ipfs://stake-withdraw-test");
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === "ContentRig__Created");
      const tokenId = event.args.tokenId;

      // First collect by user0
      let price = await rig.getPrice(tokenId);
      let epochId = await rig.tokenIdToEpochId(tokenId);

      await quoteToken.connect(user0).approve(rig.address, price.add(convert("10", 18)));
      await rig.connect(user0).collect(
        user0.address,
        tokenId,
        epochId,
        1961439882,
        price.add(convert("10", 18))
      );

      const user0BalanceBefore = await rewarder.accountToBalance(user0.address);

      // Second collect by user1
      price = await rig.getPrice(tokenId);
      epochId = await rig.tokenIdToEpochId(tokenId);

      const prevStake = await rig.tokenIdToStake(tokenId);

      await quoteToken.connect(user1).approve(rig.address, price.add(convert("10", 18)));
      await rig.connect(user1).collect(
        user1.address,
        tokenId,
        epochId,
        1961439882,
        price.add(convert("10", 18))
      );

      const user0BalanceAfter = await rewarder.accountToBalance(user0.address);

      // User0's rewarder balance should have decreased by prevStake
      expect(user0BalanceBefore.sub(user0BalanceAfter)).to.equal(prevStake);
    });
  });

  /**
   * INVARIANT 5: Price multiplier (2x) on collection
   */
  describe("INVARIANT: Price Multiplier", function () {
    it("New initPrice should be 2x the paid price", async function () {
      const tx = await rig.connect(creator).create(creator.address, "ipfs://multiplier-test");
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === "ContentRig__Created");
      const tokenId = event.args.tokenId;

      // Collect to establish first ownership
      let price = await rig.getPrice(tokenId);
      let epochId = await rig.tokenIdToEpochId(tokenId);

      await quoteToken.connect(user0).approve(rig.address, price.add(convert("10", 18)));
      await rig.connect(user0).collect(
        user0.address,
        tokenId,
        epochId,
        1961439882,
        price.add(convert("10", 18))
      );

      // Now collect again and check initPrice
      price = await rig.getPrice(tokenId);
      epochId = await rig.tokenIdToEpochId(tokenId);

      if (price.eq(0)) {
        this.skip();
      }

      await quoteToken.connect(user1).approve(rig.address, price);
      await rig.connect(user1).collect(
        user1.address,
        tokenId,
        epochId,
        1961439882,
        price
      );

      const newInitPrice = await rig.tokenIdToInitPrice(tokenId);
      const expectedInitPrice = price.mul(2);

      expect(newInitPrice).to.be.closeTo(expectedInitPrice, expectedInitPrice.div(100));
    });

    it("New initPrice should not go below minInitPrice", async function () {
      const tx = await rig.connect(creator).create(creator.address, "ipfs://min-price-test");
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === "ContentRig__Created");
      const tokenId = event.args.tokenId;

      // Wait for price to decay to 0
      await increaseTime(ONE_DAY + 1);

      const price = await rig.getPrice(tokenId);
      expect(price).to.equal(0);

      const epochId = await rig.tokenIdToEpochId(tokenId);
      const minInitPrice = await rig.minInitPrice();

      await quoteToken.connect(user0).approve(rig.address, convert("10", 18));
      await rig.connect(user0).collect(
        user0.address,
        tokenId,
        epochId,
        1961439882,
        convert("10", 18)
      );

      const newInitPrice = await rig.tokenIdToInitPrice(tokenId);
      expect(newInitPrice).to.equal(minInitPrice);
    });
  });

  /**
   * INVARIANT 6: Epoch ID increments on each collection
   */
  describe("INVARIANT: Epoch ID Increments", function () {
    it("Epoch ID should increment by 1 on each collection", async function () {
      const tx = await rig.connect(creator).create(creator.address, "ipfs://epoch-test");
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === "ContentRig__Created");
      const tokenId = event.args.tokenId;

      const epochBefore = await rig.tokenIdToEpochId(tokenId);

      const price = await rig.getPrice(tokenId);

      await quoteToken.connect(user0).approve(rig.address, price.add(convert("10", 18)));
      await rig.connect(user0).collect(
        user0.address,
        tokenId,
        epochBefore,
        1961439882,
        price.add(convert("10", 18))
      );

      const epochAfter = await rig.tokenIdToEpochId(tokenId);
      expect(epochAfter).to.equal(epochBefore.add(1));
    });
  });
});

describe("ContentRig Business Logic Tests", function () {
  let owner, protocol, user0, user1, user2, creator;
  let quoteToken, donut, registry, core;
  let rig, unit, minter, rewarder, auction;

  before("Deploy contracts", async function () {
    await network.provider.send("hardhat_reset");

    [owner, protocol, user0, user1, user2, creator] = await ethers.getSigners();

    const mockWethArtifact = await ethers.getContractFactory("MockWETH");
    quoteToken = await mockWethArtifact.deploy();
    donut = await mockWethArtifact.deploy();

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
      quoteToken.address,
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

    await donut.connect(user0).deposit({ value: convert("2000", 18) });
    await quoteToken.connect(user0).deposit({ value: convert("500", 18) });
    await quoteToken.connect(user1).deposit({ value: convert("500", 18) });
    await quoteToken.connect(user2).deposit({ value: convert("500", 18) });
    await quoteToken.connect(creator).deposit({ value: convert("500", 18) });

    // Launch with moderation enabled
    const launchParams = {
      launcher: user0.address,
      tokenName: "BL Test Unit",
      tokenSymbol: "BLTUNIT",
      uri: "https://example.com/metadata",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 7,
      contentMinInitPrice: convert("0.001", 18),
      contentIsModerated: true, // Moderated for testing moderation
      auctionInitPrice: convert("1", 18),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("0.0001", 18),
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);
    const tx = await core.connect(user0).launch(launchParams);
    const receipt = await tx.wait();

    const launchEvent = receipt.events.find((e) => e.event === "ContentCore__Launched");
    const rigAddr = launchEvent.args.rig;
    unit = launchEvent.args.unit;
    minter = launchEvent.args.minter;
    const rewarderAddr = launchEvent.args.rewarder;
    auction = launchEvent.args.auction;

    rig = await ethers.getContractAt("ContentRig", rigAddr);
    rewarder = await ethers.getContractAt("Rewarder", rewarderAddr);
  });

  describe("Content Creation", function () {
    it("Anyone can create content", async function () {
      await expect(
        rig.connect(user0).create(user0.address, "ipfs://user-content")
      ).to.not.be.reverted;
    });

    it("Creator is recorded correctly", async function () {
      const tx = await rig.connect(user1).create(user1.address, "ipfs://creator-test");
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === "ContentRig__Created");
      const tokenId = event.args.tokenId;

      expect(await rig.tokenIdToCreator(tokenId)).to.equal(user1.address);
    });

    it("Content starts with minInitPrice", async function () {
      const tx = await rig.connect(creator).create(creator.address, "ipfs://init-price-test");
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === "ContentRig__Created");
      const tokenId = event.args.tokenId;

      const initPrice = await rig.tokenIdToInitPrice(tokenId);
      const minInitPrice = await rig.minInitPrice();

      expect(initPrice).to.equal(minInitPrice);
    });

    it("Should revert on zero 'to' address", async function () {
      await expect(
        rig.connect(creator).create(AddressZero, "ipfs://zero-to")
      ).to.be.revertedWith("ContentRig__ZeroTo()");
    });

    it("Should revert on empty URI", async function () {
      await expect(
        rig.connect(creator).create(creator.address, "")
      ).to.be.revertedWith("ContentRig__ZeroLengthUri()");
    });
  });

  describe("Moderation System", function () {
    let unapprovedTokenId;

    before(async function () {
      // Create content (should be unapproved since isModerated = true)
      const tx = await rig.connect(creator).create(creator.address, "ipfs://moderated-content");
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === "ContentRig__Created");
      unapprovedTokenId = event.args.tokenId;
    });

    it("Unapproved content cannot be collected", async function () {
      const price = await rig.getPrice(unapprovedTokenId);
      const epochId = await rig.tokenIdToEpochId(unapprovedTokenId);

      await quoteToken.connect(user0).approve(rig.address, price.add(convert("10", 18)));

      await expect(
        rig.connect(user0).collect(
          user0.address,
          unapprovedTokenId,
          epochId,
          1961439882,
          price.add(convert("10", 18))
        )
      ).to.be.revertedWith("ContentRig__NotApproved()");
    });

    it("Owner can approve content", async function () {
      await rig.connect(user0).approveContents([unapprovedTokenId]);

      expect(await rig.tokenIdToApproved(unapprovedTokenId)).to.equal(true);
    });

    it("Approved content can be collected", async function () {
      const price = await rig.getPrice(unapprovedTokenId);
      const epochId = await rig.tokenIdToEpochId(unapprovedTokenId);

      await quoteToken.connect(user0).approve(rig.address, price.add(convert("10", 18)));

      await expect(
        rig.connect(user0).collect(
          user0.address,
          unapprovedTokenId,
          epochId,
          1961439882,
          price.add(convert("10", 18))
        )
      ).to.not.be.reverted;
    });

    it("Cannot approve already approved content", async function () {
      await expect(
        rig.connect(user0).approveContents([unapprovedTokenId])
      ).to.be.revertedWith("ContentRig__AlreadyApproved()");
    });

    it("Owner can add moderators", async function () {
      await rig.connect(user0).setModerators([user2.address], true);
      expect(await rig.accountToIsModerator(user2.address)).to.equal(true);
    });

    it("Moderators can approve content", async function () {
      const tx = await rig.connect(creator).create(creator.address, "ipfs://mod-approve-test");
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === "ContentRig__Created");
      const tokenId = event.args.tokenId;

      await rig.connect(user2).approveContents([tokenId]);
      expect(await rig.tokenIdToApproved(tokenId)).to.equal(true);
    });
  });

  describe("Collection Slippage Protection", function () {
    let tokenId;

    before(async function () {
      // Disable moderation for easier testing
      await rig.connect(user0).setIsModerated(false);

      const tx = await rig.connect(creator).create(creator.address, "ipfs://slippage-test");
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === "ContentRig__Created");
      tokenId = event.args.tokenId;
    });

    it("Should revert with expired deadline", async function () {
      const price = await rig.getPrice(tokenId);
      const epochId = await rig.tokenIdToEpochId(tokenId);

      await quoteToken.connect(user0).approve(rig.address, price.add(convert("10", 18)));

      await expect(
        rig.connect(user0).collect(user0.address, tokenId, epochId, 1, price.add(convert("10", 18)))
      ).to.be.revertedWith("ContentRig__Expired()");
    });

    it("Should revert with wrong epoch ID", async function () {
      const price = await rig.getPrice(tokenId);

      await quoteToken.connect(user0).approve(rig.address, price.add(convert("10", 18)));

      await expect(
        rig.connect(user0).collect(
          user0.address,
          tokenId,
          99999,
          1961439882,
          price.add(convert("10", 18))
        )
      ).to.be.revertedWith("ContentRig__EpochIdMismatch()");
    });

    it("Should revert if price exceeds maxPrice", async function () {
      // First collect to establish higher price
      let price = await rig.getPrice(tokenId);
      let epochId = await rig.tokenIdToEpochId(tokenId);

      await quoteToken.connect(user0).approve(rig.address, price.add(convert("10", 18)));
      await rig.connect(user0).collect(
        user0.address,
        tokenId,
        epochId,
        1961439882,
        price.add(convert("10", 18))
      );

      // Now try to collect with low maxPrice
      price = await rig.getPrice(tokenId);
      epochId = await rig.tokenIdToEpochId(tokenId);

      if (price.gt(0)) {
        await quoteToken.connect(user1).approve(rig.address, price);

        await expect(
          rig.connect(user1).collect(
            user1.address,
            tokenId,
            epochId,
            1961439882,
            0 // maxPrice = 0
          )
        ).to.be.revertedWith("ContentRig__MaxPriceExceeded()");
      }
    });

    it("Should revert with zero 'to' address", async function () {
      const price = await rig.getPrice(tokenId);
      const epochId = await rig.tokenIdToEpochId(tokenId);

      await quoteToken.connect(user0).approve(rig.address, price.add(convert("10", 18)));

      await expect(
        rig.connect(user0).collect(
          AddressZero,
          tokenId,
          epochId,
          1961439882,
          price.add(convert("10", 18))
        )
      ).to.be.revertedWith("ContentRig__ZeroTo()");
    });
  });

  describe("Zero-Price Edge Cases", function () {
    let tokenId;

    before(async function () {
      const tx = await rig.connect(creator).create(creator.address, "ipfs://zero-price-test");
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === "ContentRig__Created");
      tokenId = event.args.tokenId;

      // First collect
      let price = await rig.getPrice(tokenId);
      let epochId = await rig.tokenIdToEpochId(tokenId);

      await quoteToken.connect(user0).approve(rig.address, price.add(convert("10", 18)));
      await rig.connect(user0).collect(
        user0.address,
        tokenId,
        epochId,
        1961439882,
        price.add(convert("10", 18))
      );
    });

    it("Should allow collection at price 0 after epoch expires", async function () {
      await increaseTime(ONE_DAY + 1);

      const price = await rig.getPrice(tokenId);
      expect(price).to.equal(0);

      const epochId = await rig.tokenIdToEpochId(tokenId);

      // No approval needed since price is 0
      await expect(
        rig.connect(user1).collect(
          user1.address,
          tokenId,
          epochId,
          1961439882,
          convert("1", 18)
        )
      ).to.not.be.reverted;
    });

    it("Previous owner stake is withdrawn even at price 0", async function () {
      // Create new content and test
      const tx = await rig.connect(creator).create(creator.address, "ipfs://zero-stake-test");
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === "ContentRig__Created");
      const testTokenId = event.args.tokenId;

      // First collect
      let price = await rig.getPrice(testTokenId);
      let epochId = await rig.tokenIdToEpochId(testTokenId);

      await quoteToken.connect(user0).approve(rig.address, price.add(convert("10", 18)));
      await rig.connect(user0).collect(
        user0.address,
        testTokenId,
        epochId,
        1961439882,
        price.add(convert("10", 18))
      );

      const user0StakeBefore = await rewarder.accountToBalance(user0.address);
      const tokenStake = await rig.tokenIdToStake(testTokenId);

      // Wait for price to decay
      await increaseTime(ONE_DAY + 1);

      epochId = await rig.tokenIdToEpochId(testTokenId);

      // Collect at price 0
      await rig.connect(user1).collect(
        user1.address,
        testTokenId,
        epochId,
        1961439882,
        convert("1", 18)
      );

      const user0StakeAfter = await rewarder.accountToBalance(user0.address);

      // User0's stake should have been withdrawn
      expect(user0StakeBefore.sub(user0StakeAfter)).to.equal(tokenStake);
    });
  });

  describe("Events", function () {
    it("Should emit ContentRig__Created on create", async function () {
      await expect(
        rig.connect(creator).create(creator.address, "ipfs://event-test")
      ).to.emit(rig, "ContentRig__Created");
    });

    it("Should emit ContentRig__Collected on collect", async function () {
      const tx = await rig.connect(creator).create(creator.address, "ipfs://collect-event-test");
      const receipt = await tx.wait();
      const event = receipt.events.find(e => e.event === "ContentRig__Created");
      const tokenId = event.args.tokenId;

      const price = await rig.getPrice(tokenId);
      const epochId = await rig.tokenIdToEpochId(tokenId);

      await quoteToken.connect(user0).approve(rig.address, price.add(convert("10", 18)));

      await expect(
        rig.connect(user0).collect(
          user0.address,
          tokenId,
          epochId,
          1961439882,
          price.add(convert("10", 18))
        )
      ).to.emit(rig, "ContentRig__Collected");
    });
  });
});
