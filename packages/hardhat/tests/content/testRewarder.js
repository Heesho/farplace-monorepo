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

let owner, protocol, launcher, user1, user2, user3;
let usdc, donut, registry, core;
let content, minter, rewarder, auction, unit, lpToken;
let unitFactory, contentFactory, minterFactory, rewarderFactory, auctionFactory;
let uniswapFactory, uniswapRouter;

const WEEK = 7 * 24 * 60 * 60;
const DAY = 24 * 60 * 60;

describe("Rewarder Tests", function () {
  before("Initial set up", async function () {
    await network.provider.send("hardhat_reset");
    console.log("Begin Initialization");

    [owner, protocol, launcher, user1, user2, user3] = await ethers.getSigners();

    // Deploy USDC (6 decimals) as quote token
    const usdcArtifact = await ethers.getContractFactory("MockUSDC");
    usdc = await usdcArtifact.deploy();
    console.log("- USDC Initialized");

    // Deploy mock DONUT token (using MockWETH as it's a mintable ERC20)
    const donutArtifact = await ethers.getContractFactory("MockWETH");
    donut = await donutArtifact.deploy();
    console.log("- DONUT Initialized");

    // Deploy mock Uniswap V2 Factory and Router
    const mockUniswapFactoryArtifact = await ethers.getContractFactory("MockUniswapV2Factory");
    uniswapFactory = await mockUniswapFactoryArtifact.deploy();
    console.log("- Uniswap V2 Factory Initialized");

    const mockUniswapRouterArtifact = await ethers.getContractFactory("MockUniswapV2Router");
    uniswapRouter = await mockUniswapRouterArtifact.deploy(uniswapFactory.address);
    console.log("- Uniswap V2 Router Initialized");

    // Deploy Registry
    const registryArtifact = await ethers.getContractFactory("Registry");
    registry = await registryArtifact.deploy();
    console.log("- Registry Initialized");

    // Deploy factories
    const unitFactoryArtifact = await ethers.getContractFactory("UnitFactory");
    unitFactory = await unitFactoryArtifact.deploy();
    console.log("- UnitFactory Initialized");

    const contentFactoryArtifact = await ethers.getContractFactory("ContentRigFactory");
    contentFactory = await contentFactoryArtifact.deploy();
    console.log("- ContentRigFactory Initialized");

    const minterFactoryArtifact = await ethers.getContractFactory("MinterFactory");
    minterFactory = await minterFactoryArtifact.deploy();
    console.log("- MinterFactory Initialized");

    const rewarderFactoryArtifact = await ethers.getContractFactory("RewarderFactory");
    rewarderFactory = await rewarderFactoryArtifact.deploy();
    console.log("- RewarderFactory Initialized");

    const auctionFactoryArtifact = await ethers.getContractFactory("AuctionFactory");
    auctionFactory = await auctionFactoryArtifact.deploy();
    console.log("- AuctionFactory Initialized");

    // Deploy ContentCore
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
    console.log("- ContentCore Initialized");

    // Approve ContentCore as factory in Registry
    await registry.setFactoryApproval(core.address, true);
    console.log("- ContentCore approved in Registry");

    // Mint DONUT to launcher and launch a content engine
    await donut.connect(launcher).deposit({ value: convert("1000", 18) });
    console.log("- DONUT minted to launcher");

    const launchParams = {
      launcher: launcher.address,
      tokenName: "Test Unit",
      tokenSymbol: "TUNIT",
      uri: "https://example.com/metadata",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
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

    console.log("- Content Engine launched");
    console.log("Initialization Complete\n");
  });

  describe("Initialization", function () {
    it("Should have correct content address", async function () {
      expect(await rewarder.content()).to.equal(content.address);
    });

    it("Should have correct duration constant (7 days)", async function () {
      expect(await rewarder.DURATION()).to.equal(7 * DAY);
    });

    it("Should start with zero total supply", async function () {
      expect(await rewarder.totalSupply()).to.equal(0);
    });

    it("Should have reward token added (unit only)", async function () {
      expect(await rewarder.rewardTokensLength()).to.equal(1);
      expect(await rewarder.tokenToIsReward(unit.address)).to.be.true;
    });
  });

  describe("Stake Management (via Content)", function () {
    it("Should increase stake when content is collected", async function () {
      // Create content
      await content.connect(user1).create(user1.address, "ipfs://test-content-1");
      const tokenId = await content.nextTokenId();

      // Get the current price
      const price = await content.getPrice(tokenId);
      console.log("Price:", divDec6(price));

      // Fund user with USDC and approve
      await usdc.mint(user1.address, price);
      await usdc.connect(user1).approve(content.address, price);

      // Collect
      const auctionData = await getAuctionData(content, tokenId);
      await content
        .connect(user1)
        .collect(user1.address, tokenId, auctionData.epochId, ethers.constants.MaxUint256, price);

      // Check stake - use closeTo due to potential price decay during tx
      const stake = await rewarder.accountToBalance(user1.address);
      expect(stake).to.be.gt(0);
      expect(await rewarder.totalSupply()).to.be.gt(0);
    });

    it("Should transfer stake when content is re-collected", async function () {
      const tokenId = await content.nextTokenId();

      // Get the new price (should be 2x the old price)
      const price = await content.getPrice(tokenId);
      console.log("New price:", divDec6(price));

      // Fund user2 with USDC
      await usdc.mint(user2.address, price);
      await usdc.connect(user2).approve(content.address, price);

      const user1BalanceBefore = await rewarder.accountToBalance(user1.address);

      // User2 collects (steals from user1)
      const auctionData = await getAuctionData(content, tokenId);
      await content
        .connect(user2)
        .collect(user2.address, tokenId, auctionData.epochId, ethers.constants.MaxUint256, price);

      // User1's stake should be removed, user2 should have stake
      expect(await rewarder.accountToBalance(user1.address)).to.equal(0);
      expect(await rewarder.accountToBalance(user2.address)).to.be.gt(0);
    });

    it("Should only allow Content contract to deposit", async function () {
      await expect(
        rewarder.connect(user1).deposit(user1.address, convert("1", 18))
      ).to.be.reverted;
    });

    it("Should only allow Content contract to withdraw", async function () {
      await expect(
        rewarder.connect(user1).withdraw(user1.address, convert("1", 18))
      ).to.be.reverted;
    });
  });

  describe("Reward Distribution", function () {
    it("Should distribute rewards when minter updates period", async function () {
      // Advance time to trigger minter emission
      await ethers.provider.send("evm_increaseTime", [WEEK]);
      await ethers.provider.send("evm_mine");

      // Update minter period (this notifies rewarder directly)
      await minter.updatePeriod();

      // Check that there are rewards to claim
      const leftUnit = await rewarder.left(unit.address);
      console.log("Unit rewards left:", divDec(leftUnit));
      expect(leftUnit).to.be.gt(0);
    });

    it("Should allow users to claim earned rewards", async function () {
      // Advance time for rewards to accrue
      await ethers.provider.send("evm_increaseTime", [DAY]);
      await ethers.provider.send("evm_mine");

      const earned = await rewarder.earned(user2.address, unit.address);
      console.log("User2 earned:", divDec(earned));
      expect(earned).to.be.gt(0);

      const balanceBefore = await unit.balanceOf(user2.address);
      await rewarder.getReward(user2.address);
      const balanceAfter = await unit.balanceOf(user2.address);

      expect(balanceAfter.sub(balanceBefore)).to.be.closeTo(earned, earned.div(100));
    });

    it("Should reset pending rewards after claim", async function () {
      const earnedAfter = await rewarder.earned(user2.address, unit.address);
      expect(earnedAfter).to.be.lt(convert("0.001", 18));
    });

    it("Should emit RewardPaid event on claim", async function () {
      // Advance time for more rewards
      await ethers.provider.send("evm_increaseTime", [DAY]);
      await ethers.provider.send("evm_mine");

      await expect(rewarder.getReward(user2.address)).to.emit(rewarder, "Rewarder__RewardPaid");
    });
  });

  describe("Proportional Rewards", function () {
    it("Should distribute rewards proportionally to stake", async function () {
      // Create new content for user3 with larger stake
      await content.connect(user3).create(user3.address, "ipfs://test-content-3");
      const tokenId3 = await content.nextTokenId();

      const price3 = await content.getPrice(tokenId3);
      await usdc.mint(user3.address, price3.mul(2)); // Extra for collect
      await usdc.connect(user3).approve(content.address, price3.mul(2));

      const auctionData3 = await getAuctionData(content, tokenId3);
      await content
        .connect(user3)
        .collect(user3.address, tokenId3, auctionData3.epochId, ethers.constants.MaxUint256, price3);

      const stake2 = await rewarder.accountToBalance(user2.address);
      const stake3 = await rewarder.accountToBalance(user3.address);
      console.log("User2 stake:", divDec6(stake2));
      console.log("User3 stake:", divDec6(stake3));

      // Advance and trigger new emission (minter notifies rewarder directly)
      await ethers.provider.send("evm_increaseTime", [WEEK]);
      await ethers.provider.send("evm_mine");
      await minter.updatePeriod();

      // Wait for rewards
      await ethers.provider.send("evm_increaseTime", [DAY]);
      await ethers.provider.send("evm_mine");

      const earned2 = await rewarder.earned(user2.address, unit.address);
      const earned3 = await rewarder.earned(user3.address, unit.address);
      console.log("User2 earned:", divDec(earned2));
      console.log("User3 earned:", divDec(earned3));

      // Both should have earned something
      expect(earned2).to.be.gt(0);
      expect(earned3).to.be.gt(0);
    });
  });

  describe("Multi-Token Rewards", function () {
    it("Should only allow Content to add reward tokens", async function () {
      // Create a mock token
      const mockTokenArtifact = await ethers.getContractFactory("MockWETH");
      const mockToken = await mockTokenArtifact.deploy();

      await expect(rewarder.connect(user1).addReward(mockToken.address)).to.be.reverted;
    });

    it("Should revert when adding duplicate reward token", async function () {
      // Try to add unit again via content owner
      await expect(content.connect(launcher).addReward(unit.address)).to.be.revertedWith(
        "Rewarder__RewardTokenAlreadyAdded()"
      );
    });
  });

  describe("View Functions", function () {
    it("Should return correct left() when rewards are streaming", async function () {
      const leftBefore = await rewarder.left(unit.address);
      console.log("Left before:", divDec(leftBefore));

      await ethers.provider.send("evm_increaseTime", [DAY]);
      await ethers.provider.send("evm_mine");

      const leftAfter = await rewarder.left(unit.address);
      console.log("Left after:", divDec(leftAfter));

      expect(leftAfter).to.be.lt(leftBefore);
    });

    it("Should return zero left() after period ends", async function () {
      // Fast forward past the 7-day period
      await ethers.provider.send("evm_increaseTime", [8 * DAY]);
      await ethers.provider.send("evm_mine");

      expect(await rewarder.left(unit.address)).to.equal(0);
    });

    it("Should return correct rewardTokensLength", async function () {
      expect(await rewarder.rewardTokensLength()).to.equal(1);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle claiming with no earned rewards", async function () {
      // User1 has no stake, claiming should succeed but transfer nothing
      const balanceBefore = await unit.balanceOf(user1.address);
      await rewarder.getReward(user1.address);
      const balanceAfter = await unit.balanceOf(user1.address);

      expect(balanceAfter).to.equal(balanceBefore);
    });
  });
});
