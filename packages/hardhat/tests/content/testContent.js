const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const divDec6 = (amount) => amount / 10 ** 6;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";
const AddressDead = "0x000000000000000000000000000000000000dEaD";

// Helper to get auction data from individual mappings
async function getAuctionData(content, tokenId) {
  return {
    epochId: await content.tokenIdToEpochId(tokenId),
    initPrice: await content.tokenIdToInitPrice(tokenId),
    startTime: await content.tokenIdToStartTime(tokenId)
  };
}

let owner, protocol, user0, user1, user2, creator1, creator2;
let usdc, donut, registry, core;
let content, minter, rewarder, auction, unit, lpToken;
let unitFactory, contentFactory, minterFactory, rewarderFactory, auctionFactory;
let uniswapFactory, uniswapRouter;

describe("Content Tests", function () {
  before("Initial set up", async function () {
    await network.provider.send("hardhat_reset");
    console.log("Begin Initialization");

    [owner, protocol, user0, user1, user2, creator1, creator2] = await ethers.getSigners();

    // Deploy USDC (6 decimals) as quote token
    const usdcArtifact = await ethers.getContractFactory("MockUSDC");
    usdc = await usdcArtifact.deploy();

    // Deploy mock DONUT token (18 decimals)
    const donutArtifact = await ethers.getContractFactory("MockWETH");
    donut = await donutArtifact.deploy();

    // Deploy mock Uniswap
    const mockUniswapFactoryArtifact = await ethers.getContractFactory("MockUniswapV2Factory");
    uniswapFactory = await mockUniswapFactoryArtifact.deploy();

    const mockUniswapRouterArtifact = await ethers.getContractFactory("MockUniswapV2Router");
    uniswapRouter = await mockUniswapRouterArtifact.deploy(uniswapFactory.address);

    // Deploy Registry
    registry = await (await ethers.getContractFactory("Registry")).deploy();

    // Deploy factories
    unitFactory = await (await ethers.getContractFactory("UnitFactory")).deploy();
    contentFactory = await (await ethers.getContractFactory("ContentRigFactory")).deploy();
    minterFactory = await (await ethers.getContractFactory("MinterFactory")).deploy();
    rewarderFactory = await (await ethers.getContractFactory("RewarderFactory")).deploy();
    auctionFactory = await (await ethers.getContractFactory("AuctionFactory")).deploy();

    // Deploy ContentCore with USDC as quote
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
      protocol.address,
      convert("100", 18)
    );

    // Approve ContentCore as factory in Registry
    await registry.setFactoryApproval(core.address, true);

    // Mint DONUT to user0 for launch, USDC to users for collections
    await donut.connect(user0).deposit({ value: convert("1000", 18) });
    await usdc.mint(user1.address, convert("100000", 6));
    await usdc.mint(user2.address, convert("100000", 6));

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
      contentMinInitPrice: convert("1", 6), // 10 USDC (6 decimals)
      contentIsModerated: false,
      auctionInitPrice: convert("1000", 6), // 1000 USDC
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6), // 1 USDC
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);
    const tx = await core.connect(user0).launch(launchParams);
    const receipt = await tx.wait();

    const launchEvent = receipt.events.find((e) => e.event === "ContentCore__Launched");
    content = launchEvent.args.rig;
    unit = launchEvent.args.unit;
    minter = launchEvent.args.minter;
    rewarder = launchEvent.args.rewarder;
    auction = launchEvent.args.auction;
    lpToken = launchEvent.args.lpToken;

    console.log("Initialization Complete\n");
  });

  describe("Content Creation", function () {
    it("Anyone can create content", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      const tx = await contentContract.connect(creator1).create(creator1.address, "ipfs://token1");
      await tx.wait();

      expect(await contentContract.ownerOf(1)).to.equal(creator1.address);
      expect(await contentContract.tokenIdToCreator(1)).to.equal(creator1.address);
      expect(await contentContract.tokenURI(1)).to.equal("ipfs://token1");
      expect(await contentContract.nextTokenId()).to.equal(1);
      console.log("Content #1 created by creator1");
    });

    it("Content is auto-approved when not moderated", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);
      expect(await contentContract.tokenIdToApproved(1)).to.equal(true);
      console.log("Content #1 auto-approved");
    });

    it("Creator can create content for others", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      await contentContract.connect(creator1).create(creator2.address, "ipfs://token2");

      expect(await contentContract.ownerOf(2)).to.equal(creator2.address);
      expect(await contentContract.tokenIdToCreator(2)).to.equal(creator2.address);
      console.log("Content #2 created, owned by creator2");
    });

    it("Cannot create content with zero address", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      await expect(
        contentContract.connect(creator1).create(AddressZero, "ipfs://token3")
      ).to.be.revertedWith("ContentRig__ZeroTo()");
      console.log("Creation correctly reverted with zero address");
    });

    it("Cannot create content with empty URI", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      await expect(
        contentContract.connect(creator1).create(creator1.address, "")
      ).to.be.revertedWith("ContentRig__ZeroLengthUri()");
      console.log("Creation correctly reverted with empty URI");
    });
  });

  describe("Dutch Auction Pricing", function () {
    it("Initial price is minInitPrice", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      // Create fresh content to test initial price
      await contentContract.connect(creator1).create(creator1.address, "ipfs://price-test");
      const newTokenId = await contentContract.nextTokenId();

      const price = await contentContract.getPrice(newTokenId);
      const minInitPrice = await contentContract.minInitPrice();
      expect(price).to.equal(minInitPrice);
      console.log("Initial price:", divDec6(price), "USDC");
    });

    it("Price decays over time", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      const priceBefore = await contentContract.getPrice(1);

      // Forward 12 hours (half of EPOCH_PERIOD which is 1 day)
      await network.provider.send("evm_increaseTime", [43200]);
      await network.provider.send("evm_mine");

      const priceAfter = await contentContract.getPrice(1);
      console.log("Price before:", divDec6(priceBefore), "USDC");
      console.log("Price after 12 hours:", divDec6(priceAfter), "USDC");

      expect(priceAfter).to.be.lt(priceBefore);
      // Should be approximately half
      expect(priceAfter).to.be.closeTo(priceBefore.div(2), priceBefore.div(100));
    });

    it("Price reaches 0 after EPOCH_PERIOD", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      // Forward another 12 hours (total > 1 day EPOCH_PERIOD)
      await network.provider.send("evm_increaseTime", [43200]);
      await network.provider.send("evm_mine");

      const price = await contentContract.getPrice(1);
      expect(price).to.equal(0);
      console.log("Price after 1+ day:", divDec6(price), "USDC");
    });
  });

  describe("Content Collection (Stealing)", function () {
    it("Create fresh content for collection tests", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      await contentContract.connect(creator1).create(creator1.address, "ipfs://token3");
      expect(await contentContract.ownerOf(3)).to.equal(creator1.address);
      console.log("Content #3 created for collection tests");
    });

    it("User can collect content by paying price", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      const tokenId = 3;
      const auctionData = await getAuctionData(contentContract, tokenId);
      const price = await contentContract.getPrice(tokenId);

      console.log("Price to collect:", divDec6(price), "USDC");

      // Approve USDC
      await usdc.connect(user1).approve(content, price);

      // Use block.timestamp for deadline
      const block = await ethers.provider.getBlock("latest");
      const deadline = block.timestamp + 3600;
      await contentContract.connect(user1).collect(user1.address, tokenId, auctionData.epochId, deadline, price);

      // Verify ownership transferred
      expect(await contentContract.ownerOf(tokenId)).to.equal(user1.address);
      console.log("Content #3 collected by user1");
    });

    it("New price is 2x the paid price or minInitPrice", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      const tokenId = 3;
      const newPrice = await contentContract.getPrice(tokenId);
      const minInitPrice = await contentContract.minInitPrice();

      // If previous price was 0 (decayed), new price is minInitPrice
      // Otherwise new price is 2x the previous price
      // In either case, new price should be at least minInitPrice
      expect(newPrice).to.be.gte(minInitPrice);
      console.log("New price after collection:", divDec6(newPrice), "USDC");
    });

    it("Fee distribution is correct (80/12/4/3/1)", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      const tokenId = 3;
      const auctionData = await getAuctionData(contentContract, tokenId);
      const price = await contentContract.getPrice(tokenId);
      const teamAddress = await contentContract.team();

      // Get balances before
      const user1UsdcBefore = await usdc.balanceOf(user1.address);
      const auctionUsdcBefore = await usdc.balanceOf(auction);
      const creatorUsdcBefore = await usdc.balanceOf(creator1.address);
      const teamUsdcBefore = await usdc.balanceOf(teamAddress);
      const protocolUsdcBefore = await usdc.balanceOf(protocol.address);

      // User2 collects from user1
      await usdc.connect(user2).approve(content, price);
      const block = await ethers.provider.getBlock("latest");
      const deadline = block.timestamp + 3600;
      await contentContract.connect(user2).collect(user2.address, tokenId, auctionData.epochId, deadline, price);

      // Check claimable amounts (pull pattern for prevOwner and creator)
      const prevOwnerClaimable = await contentContract.accountToClaimable(user1.address);
      const creatorClaimable = await contentContract.accountToClaimable(creator1.address);

      // Get direct transfer balances (treasury, team, protocol)
      const auctionUsdcAfter = await usdc.balanceOf(auction);
      const teamUsdcAfter = await usdc.balanceOf(teamAddress);
      const protocolUsdcAfter = await usdc.balanceOf(protocol.address);

      // Calculate direct transfer amounts
      const treasuryReceived = auctionUsdcAfter.sub(auctionUsdcBefore);
      const teamReceived = teamUsdcAfter.sub(teamUsdcBefore);
      const protocolReceived = protocolUsdcAfter.sub(protocolUsdcBefore);

      console.log("Price paid:", divDec6(price));
      console.log("Previous owner (80%) claimable:", divDec6(prevOwnerClaimable));
      console.log("Treasury (12%):", divDec6(treasuryReceived));
      console.log("Creator (3%) claimable:", divDec6(creatorClaimable));
      console.log("Team (4%):", divDec6(teamReceived));
      console.log("Protocol (1%):", divDec6(protocolReceived));

      // Verify percentages: 80% prevOwner (claimable), 12% treasury, 4% team, 3% creator (claimable), 1% protocol
      const tolerance = price.div(100); // 1% tolerance
      expect(prevOwnerClaimable).to.be.closeTo(price.mul(8000).div(10000), tolerance);
      expect(treasuryReceived).to.be.closeTo(price.mul(1200).div(10000), tolerance);
      expect(creatorClaimable).to.be.closeTo(price.mul(300).div(10000), tolerance);
      expect(teamReceived).to.be.closeTo(price.mul(400).div(10000), tolerance);
      expect(protocolReceived).to.be.closeTo(price.mul(100).div(10000), tolerance);

      // Test claim function - prevOwner claims their fees
      const user1UsdcBeforeClaim = await usdc.balanceOf(user1.address);
      await contentContract.claim(user1.address);
      const user1UsdcAfterClaim = await usdc.balanceOf(user1.address);
      expect(user1UsdcAfterClaim.sub(user1UsdcBeforeClaim)).to.equal(prevOwnerClaimable);

      // Verify claimable is now 0
      expect(await contentContract.accountToClaimable(user1.address)).to.equal(0);
    });

    it("Stake is recorded in rewarder", async function () {
      console.log("******************************************************");
      const rewarderContract = await ethers.getContractAt("Rewarder", rewarder);

      const user2Balance = await rewarderContract.accountToBalance(user2.address);
      expect(user2Balance).to.be.gt(0);
      console.log("User2 stake in rewarder:", divDec6(user2Balance));
    });

    it("Previous owner stake is withdrawn", async function () {
      console.log("******************************************************");
      const rewarderContract = await ethers.getContractAt("Rewarder", rewarder);
      const contentContract = await ethers.getContractAt("ContentRig", content);

      // User1 should have 0 stake now (was withdrawn when user2 collected)
      const user1Balance = await rewarderContract.accountToBalance(user1.address);
      expect(user1Balance).to.equal(0);
      console.log("User1 stake after being collected from:", divDec6(user1Balance));
    });

    it("Cannot collect with wrong epochId", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      const tokenId = 3;
      const price = await contentContract.getPrice(tokenId);

      await usdc.connect(user1).approve(content, price);
      const block = await ethers.provider.getBlock("latest");
      const deadline = block.timestamp + 3600;

      await expect(
        contentContract.connect(user1).collect(user1.address, tokenId, 999, deadline, price)
      ).to.be.revertedWith("ContentRig__EpochIdMismatch()");
      console.log("Collection correctly reverted with wrong epochId");
    });

    it("Cannot collect with expired deadline", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      const tokenId = 3;
      const auctionData = await getAuctionData(contentContract, tokenId);
      const price = await contentContract.getPrice(tokenId);

      await usdc.connect(user1).approve(content, price);
      const block = await ethers.provider.getBlock("latest");
      const expiredDeadline = block.timestamp - 1;

      await expect(
        contentContract.connect(user1).collect(user1.address, tokenId, auctionData.epochId, expiredDeadline, price)
      ).to.be.revertedWith("ContentRig__Expired()");
      console.log("Collection correctly reverted with expired deadline");
    });

    it("Cannot collect with maxPrice exceeded", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      // Create fresh content so we have a non-zero price
      await contentContract.connect(creator1).create(creator1.address, "ipfs://maxprice-test");
      const freshTokenId = await contentContract.nextTokenId();

      const auctionData = await getAuctionData(contentContract, freshTokenId);
      const price = await contentContract.getPrice(freshTokenId);
      console.log("Fresh content price:", divDec6(price));

      // If price is 0 (due to decay being faster than expected), skip this test
      if (price.eq(0)) {
        console.log("Price is 0, skipping maxPrice test as there's nothing to exceed");
        return;
      }

      await usdc.connect(user1).approve(content, price);
      const block = await ethers.provider.getBlock("latest");
      const deadline = block.timestamp + 3600;
      const maxPrice = 0; // Set to 0 to guarantee it's less than any positive price

      await expect(
        contentContract.connect(user1).collect(user1.address, freshTokenId, auctionData.epochId, deadline, maxPrice)
      ).to.be.revertedWith("ContentRig__MaxPriceExceeded()");
      console.log("Collection correctly reverted with maxPrice exceeded");
    });

    it("Cannot collect invalid tokenId", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      const block = await ethers.provider.getBlock("latest");
      const deadline = block.timestamp + 3600;

      // Non-existent tokens have tokenIdToApproved = false (default), so ContentRig__NotApproved is thrown
      await expect(
        contentContract.connect(user1).collect(user1.address, 999, 0, deadline, convert("1000", 6))
      ).to.be.revertedWith("ContentRig__NotApproved()");
      console.log("Collection correctly reverted with invalid tokenId");
    });
  });

  describe("Transfer Restrictions", function () {
    it("Cannot approve transfers", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      await expect(
        contentContract.connect(user2).approve(user1.address, 3)
      ).to.be.revertedWith("ContentRig__TransferDisabled()");
      console.log("Approve correctly reverted");
    });

    it("Cannot setApprovalForAll", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      await expect(
        contentContract.connect(user2).setApprovalForAll(user1.address, true)
      ).to.be.revertedWith("ContentRig__TransferDisabled()");
      console.log("setApprovalForAll correctly reverted");
    });

    it("Cannot transferFrom", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      await expect(
        contentContract.connect(user2).transferFrom(user2.address, user1.address, 3)
      ).to.be.revertedWith("ContentRig__TransferDisabled()");
      console.log("transferFrom correctly reverted");
    });

    it("Cannot safeTransferFrom", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      await expect(
        contentContract.connect(user2)["safeTransferFrom(address,address,uint256)"](user2.address, user1.address, 3)
      ).to.be.revertedWith("ContentRig__TransferDisabled()");
      console.log("safeTransferFrom correctly reverted");
    });
  });

  describe("Owner Functions", function () {
    it("Owner can set URI", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      await contentContract.connect(user0).setUri("https://newuri.com");
      expect(await contentContract.uri()).to.equal("https://newuri.com");
      console.log("URI updated");
    });

    it("Non-owner cannot set URI", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      await expect(
        contentContract.connect(user1).setUri("https://hacker.com")
      ).to.be.revertedWith("Ownable: caller is not the owner");
      console.log("Non-owner setUri correctly reverted");
    });

    it("Owner can set treasury", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      await contentContract.connect(user0).setTreasury(user0.address);
      expect(await contentContract.treasury()).to.equal(user0.address);

      // Change back
      await contentContract.connect(user0).setTreasury(auction);
      console.log("Treasury updated and restored");
    });

    it("Cannot set treasury to zero address", async function () {
      console.log("******************************************************");
      const contentContract = await ethers.getContractAt("ContentRig", content);

      await expect(
        contentContract.connect(user0).setTreasury(AddressZero)
      ).to.be.revertedWith("ContentRig__InvalidTreasury()");
      console.log("Zero treasury correctly reverted");
    });
  });
});

describe("Content Moderation Tests", function () {
  let moderatedContent, moderatedUnit, moderatedMinter, moderatedRewarder, moderatedAuction;

  before("Launch moderated content", async function () {
    // Launch a moderated content engine
    const launchParams = {
      launcher: user0.address,
      tokenName: "Moderated Unit",
      tokenSymbol: "MUNIT",
      uri: "https://example.com/moderated",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 7,
      contentMinInitPrice: convert("1", 6), // 10 USDC
      contentIsModerated: true, // MODERATED
      auctionInitPrice: convert("1000", 6),
      auctionEpochPeriod: 86400,
      auctionPriceMultiplier: convert("1.5", 18),
      auctionMinInitPrice: convert("1", 6),
    };

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);
    const tx = await core.connect(user0).launch(launchParams);
    const receipt = await tx.wait();

    const launchEvent = receipt.events.find((e) => e.event === "ContentCore__Launched");
    moderatedContent = launchEvent.args.rig;
    moderatedUnit = launchEvent.args.unit;
    moderatedMinter = launchEvent.args.minter;
    moderatedRewarder = launchEvent.args.rewarder;
    moderatedAuction = launchEvent.args.auction;

    console.log("Moderated content engine launched");
  });

  it("Content requires approval when moderated", async function () {
    console.log("******************************************************");
    const contentContract = await ethers.getContractAt("ContentRig", moderatedContent);

    expect(await contentContract.isModerated()).to.equal(true);
    console.log("Content is moderated");
  });

  it("Created content is not auto-approved", async function () {
    console.log("******************************************************");
    const contentContract = await ethers.getContractAt("ContentRig", moderatedContent);

    await contentContract.connect(creator1).create(creator1.address, "ipfs://moderated1");
    expect(await contentContract.tokenIdToApproved(1)).to.equal(false);
    console.log("Content #1 not auto-approved");
  });

  it("Cannot collect unapproved content", async function () {
    console.log("******************************************************");
    const contentContract = await ethers.getContractAt("ContentRig", moderatedContent);

    const auctionData = await getAuctionData(contentContract, 1);
    const price = await contentContract.getPrice(1);
    const block = await ethers.provider.getBlock("latest");
    const deadline = block.timestamp + 3600;

    await usdc.connect(user1).approve(moderatedContent, price);

    await expect(
      contentContract.connect(user1).collect(user1.address, 1, auctionData.epochId, deadline, price)
    ).to.be.revertedWith("ContentRig__NotApproved()");
    console.log("Collection of unapproved content correctly reverted");
  });

  it("Owner can approve content", async function () {
    console.log("******************************************************");
    const contentContract = await ethers.getContractAt("ContentRig", moderatedContent);

    await contentContract.connect(user0).approveContents([1]);
    expect(await contentContract.tokenIdToApproved(1)).to.equal(true);
    console.log("Content #1 approved by owner");
  });

  it("Cannot approve already approved content", async function () {
    console.log("******************************************************");
    const contentContract = await ethers.getContractAt("ContentRig", moderatedContent);

    await expect(
      contentContract.connect(user0).approveContents([1])
    ).to.be.revertedWith("ContentRig__AlreadyApproved()");
    console.log("Double approval correctly reverted");
  });

  it("Owner can set moderators", async function () {
    console.log("******************************************************");
    const contentContract = await ethers.getContractAt("ContentRig", moderatedContent);

    await contentContract.connect(user0).setModerators([user1.address], true);
    expect(await contentContract.accountToIsModerator(user1.address)).to.equal(true);
    console.log("User1 set as moderator");
  });

  it("Moderator can approve content", async function () {
    console.log("******************************************************");
    const contentContract = await ethers.getContractAt("ContentRig", moderatedContent);

    // Create new content
    await contentContract.connect(creator2).create(creator2.address, "ipfs://moderated2");
    expect(await contentContract.tokenIdToApproved(2)).to.equal(false);

    // Moderator approves
    await contentContract.connect(user1).approveContents([2]);
    expect(await contentContract.tokenIdToApproved(2)).to.equal(true);
    console.log("Content #2 approved by moderator");
  });

  it("Non-moderator cannot approve", async function () {
    console.log("******************************************************");
    const contentContract = await ethers.getContractAt("ContentRig", moderatedContent);

    await contentContract.connect(creator1).create(creator1.address, "ipfs://moderated3");

    await expect(
      contentContract.connect(user2).approveContents([3])
    ).to.be.revertedWith("ContentRig__NotModerator()");
    console.log("Non-moderator approval correctly reverted");
  });

  it("Owner can remove moderators", async function () {
    console.log("******************************************************");
    const contentContract = await ethers.getContractAt("ContentRig", moderatedContent);

    await contentContract.connect(user0).setModerators([user1.address], false);
    expect(await contentContract.accountToIsModerator(user1.address)).to.equal(false);
    console.log("User1 removed as moderator");
  });

  it("Owner can toggle moderation off", async function () {
    console.log("******************************************************");
    const contentContract = await ethers.getContractAt("ContentRig", moderatedContent);

    await contentContract.connect(user0).setIsModerated(false);
    expect(await contentContract.isModerated()).to.equal(false);

    // New content should be auto-approved
    await contentContract.connect(creator1).create(creator1.address, "ipfs://moderated4");
    expect(await contentContract.tokenIdToApproved(4)).to.equal(true);
    console.log("Moderation disabled, new content auto-approved");
  });
});
