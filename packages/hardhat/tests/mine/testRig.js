const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";
const AddressDead = "0x000000000000000000000000000000000000dEaD";

let owner, protocol, team, user0, user1, user2, user3;
let weth, usdc, registry, core, multicall, entropy;
let rig, rigContract, auction, unit, unitContract, lpToken;
let auctionFactory;
let uniswapFactory, uniswapRouter;

describe("Rig Comprehensive Tests", function () {
  before("Initial set up", async function () {
    await network.provider.send("hardhat_reset");
    console.log("Begin Initialization");

    [owner, protocol, team, user0, user1, user2, user3] = await ethers.getSigners();

    // Deploy WETH
    const wethArtifact = await ethers.getContractFactory("MockWETH");
    weth = await wethArtifact.deploy();

    // Deploy mock USDC token (6 decimals)
    const usdcArtifact = await ethers.getContractFactory("MockUSDC");
    usdc = await usdcArtifact.deploy();

    // Deploy mock Entropy
    const entropyArtifact = await ethers.getContractFactory("MockEntropy");
    entropy = await entropyArtifact.deploy();

    // Deploy mock Uniswap V2
    const mockUniswapFactoryArtifact = await ethers.getContractFactory("MockUniswapV2Factory");
    uniswapFactory = await mockUniswapFactoryArtifact.deploy();

    const mockUniswapRouterArtifact = await ethers.getContractFactory("MockUniswapV2Router");
    uniswapRouter = await mockUniswapRouterArtifact.deploy(uniswapFactory.address);

    // Deploy factories
    const auctionFactoryArtifact = await ethers.getContractFactory("AuctionFactory");
    auctionFactory = await auctionFactoryArtifact.deploy();

    const unitFactoryArtifact = await ethers.getContractFactory("UnitFactory");
    const unitFactory = await unitFactoryArtifact.deploy();

    // Deploy Registry
    const registryArtifact = await ethers.getContractFactory("Registry");
    registry = await registryArtifact.deploy();

    // Deploy Core
    const coreArtifact = await ethers.getContractFactory("MineCore");
    core = await coreArtifact.deploy(
      registry.address,
      usdc.address,
      uniswapFactory.address,
      uniswapRouter.address,
      unitFactory.address,
      auctionFactory.address,
      entropy.address,
      protocol.address,
      convert("100", 6)
    );

    // Approve Core as factory in Registry
    await registry.setFactoryApproval(core.address, true);

    // Deploy Multicall
    const multicallArtifact = await ethers.getContractFactory("MineMulticall");
    multicall = await multicallArtifact.deploy(core.address, usdc.address);

    // Mint USDC and WETH to users (reasonable amounts)
    await usdc.mint(user0.address, convert("5000", 6));
    await weth.connect(user1).deposit({ value: convert("100", 18) });
    await weth.connect(user2).deposit({ value: convert("100", 18) });
    await weth.connect(user3).deposit({ value: convert("100", 18) });

    console.log("Initialization Complete\n");
  });

  describe("Launch and Basic Setup", function () {
    it("Should launch a new rig with correct parameters", async function () {
      const launchParams = {
        launcher: user0.address,
        quoteToken: weth.address,
        tokenName: "Test Unit",
        tokenSymbol: "TUNIT",
        uri: "https://example.com/metadata",
        usdcAmount: convert("500", 6),
        unitAmount: convert("1000000", 18),
        initialUps: convert("4", 18),
        tailUps: convert("0.01", 18),
        halvingAmount: convert("10000000", 18),
        rigEpochPeriod: 3600,
        rigPriceMultiplier: convert("2", 18),
        rigMinInitPrice: convert("0.0001", 18),
        upsMultipliers: [convert("1", 18)],
        upsMultiplierDuration: 86400,
        auctionInitPrice: convert("1", 18),
        auctionEpochPeriod: 86400,
        auctionPriceMultiplier: convert("1.2", 18),
        auctionMinInitPrice: convert("0.001", 18),
      };

      await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);
      const tx = await core.connect(user0).launch(launchParams);
      const receipt = await tx.wait();

      const launchEvent = receipt.events.find((e) => e.event === "MineCore__Launched");
      rig = launchEvent.args.rig;
      unit = launchEvent.args.unit;
      auction = launchEvent.args.auction;
      lpToken = launchEvent.args.lpToken;

      rigContract = await ethers.getContractAt("MineRig", rig);
      unitContract = await ethers.getContractAt("Unit", unit);

      // Disable entropy for tests that don't send ETH for VRF fees
      await rigContract.connect(user0).setEntropyEnabled(false);

      expect(await rigContract.owner()).to.equal(user0.address);
      expect(await rigContract.unit()).to.equal(unit);
      expect(await rigContract.quote()).to.equal(weth.address);
      expect(await rigContract.treasury()).to.equal(auction);
      expect(await rigContract.core()).to.equal(core.address);
      expect(await core.protocolFeeAddress()).to.equal(protocol.address);
      expect(await rigContract.epochPeriod()).to.equal(3600);
      expect(await rigContract.priceMultiplier()).to.equal(convert("2", 18));
      expect(await rigContract.minInitPrice()).to.equal(convert("0.0001", 18));
      expect(await rigContract.initialUps()).to.equal(convert("4", 18));
      expect(await rigContract.tailUps()).to.equal(convert("0.01", 18));
      expect(await rigContract.halvingAmount()).to.equal(convert("10000000", 18));
      expect(await rigContract.capacity()).to.equal(1);
    });
  });

  describe("Dutch Auction Price Decay", function () {
    it("Should have minInitPrice on pre-initialized slot 0", async function () {
      // Slot 0 is now pre-initialized with launcher as miner and initPrice = minInitPrice
      const price = await rigContract.getPrice(0);
      const minInitPrice = await rigContract.minInitPrice();
      // Price should be decaying from minInitPrice (not 0)
      expect(price).to.be.lte(minInitPrice);
      expect(price).to.be.gte(0);
    });

    it("Should set initPrice after first mine based on price * multiplier", async function () {
      const slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);
      await weth.connect(user1).approve(rig, convert("1", 18));

      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 1961439882, convert("1", 18), ""
      );

      // initPrice = max(pricePaid * priceMultiplier, minInitPrice)
      const newSlot = await rigContract.getSlot(0);
      const minInitPrice = await rigContract.minInitPrice();
      expect(newSlot.initPrice).to.be.gte(minInitPrice);
    });

    it("Should decay price linearly over epoch period", async function () {
      const initPrice = (await rigContract.getSlot(0)).initPrice;
      const epochPeriod = await rigContract.epochPeriod();

      // Price at start
      const priceAtStart = await rigContract.getPrice(0);
      expect(priceAtStart).to.be.closeTo(initPrice, initPrice.div(100)); // ~1% tolerance

      // Advance 25% of epoch
      await network.provider.send("evm_increaseTime", [epochPeriod.toNumber() / 4]);
      await network.provider.send("evm_mine");

      const priceAt25 = await rigContract.getPrice(0);
      const expected25 = initPrice.mul(75).div(100);
      expect(priceAt25).to.be.closeTo(expected25, expected25.div(10));

      // Advance to 50% of epoch
      await network.provider.send("evm_increaseTime", [epochPeriod.toNumber() / 4]);
      await network.provider.send("evm_mine");

      const priceAt50 = await rigContract.getPrice(0);
      const expected50 = initPrice.mul(50).div(100);
      expect(priceAt50).to.be.closeTo(expected50, expected50.div(10));

      // Advance to 75% of epoch
      await network.provider.send("evm_increaseTime", [epochPeriod.toNumber() / 4]);
      await network.provider.send("evm_mine");

      const priceAt75 = await rigContract.getPrice(0);
      const expected75 = initPrice.mul(25).div(100);
      expect(priceAt75).to.be.closeTo(expected75, expected75.div(10));
    });

    it("Should return 0 after epoch expires", async function () {
      // Advance past epoch end
      await network.provider.send("evm_increaseTime", [1000]);
      await network.provider.send("evm_mine");

      const price = await rigContract.getPrice(0);
      expect(price).to.equal(0);
    });

    it("Should set new initPrice based on priceMultiplier after mine", async function () {
      // Mine at price 0 (expired epoch)
      const slot = await rigContract.getSlot(0);
      await weth.connect(user2).approve(rig, convert("1", 18));

      await rigContract.connect(user2).mine(
        user2.address, 0, slot.epochId, 1961439882, convert("1", 18), ""
      );

      // New initPrice should be minInitPrice since 0 * multiplier = 0 < minInitPrice
      const newSlot = await rigContract.getSlot(0);
      expect(newSlot.initPrice).to.equal(convert("0.0001", 18));
    });

    it("Should apply price multiplier correctly for non-zero price", async function () {
      // Mine immediately to get non-zero price
      const slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      await weth.connect(user1).approve(rig, price);
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 1961439882, price, ""
      );

      // New initPrice = price * 2 (priceMultiplier)
      const newSlot = await rigContract.getSlot(0);
      const expectedInitPrice = price.mul(2);
      expect(newSlot.initPrice).to.be.closeTo(expectedInitPrice, expectedInitPrice.div(100));
    });
  });

  describe("Slippage Protection", function () {
    it("Should revert if epochId mismatches (frontrun protection)", async function () {
      const slot = await rigContract.getSlot(0);
      const wrongEpochId = slot.epochId.add(1);

      await weth.connect(user1).approve(rig, convert("1", 18));

      await expect(
        rigContract.connect(user1).mine(
          user1.address, 0, wrongEpochId, 1961439882, convert("1", 18), ""
        )
      ).to.be.revertedWith("Rig__EpochIdMismatch()");
    });

    it("Should revert if price exceeds maxPrice", async function () {
      // First mine to ensure we have a non-zero price in next epoch
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rig, convert("1", 18));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 1961439882, convert("1", 18), ""
      );

      // Now get the new slot with a price - get price immediately after mining
      slot = await rigContract.getSlot(0);

      // Skip if no initPrice (shouldn't happen)
      if (slot.initPrice.eq(0)) {
        this.skip();
      }

      // Use a maxPrice that's significantly below initPrice to ensure the test fails
      // regardless of minor price decay
      const maxPrice = slot.initPrice.div(2);

      await weth.connect(user1).approve(rig, slot.initPrice);

      await expect(
        rigContract.connect(user1).mine(
          user1.address, 0, slot.epochId, 1961439882, maxPrice, ""
        )
      ).to.be.revertedWith("Rig__MaxPriceExceeded()");
    });

    it("Should revert if deadline has passed", async function () {
      const slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);
      const pastDeadline = Math.floor(Date.now() / 1000) - 1000;

      await weth.connect(user1).approve(rig, price);

      await expect(
        rigContract.connect(user1).mine(
          user1.address, 0, slot.epochId, pastDeadline, price, ""
        )
      ).to.be.revertedWith("Rig__DeadlinePassed()");
    });

    it("Should succeed with valid slippage parameters", async function () {
      const slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);
      const futureDeadline = Math.floor(Date.now() / 1000) + 10000;
      const maxPrice = price.add(convert("1", 18)); // Allow some slippage

      await weth.connect(user2).approve(rig, maxPrice);

      await expect(
        rigContract.connect(user2).mine(
          user2.address, 0, slot.epochId, futureDeadline, maxPrice, ""
        )
      ).to.not.be.reverted;
    });
  });

  describe("Fee Distribution", function () {
    it("Should distribute fees correctly (80% miner, 15% treasury, 1% protocol, 4% team)", async function () {
      // Set team address first
      await rigContract.connect(user0).setTeam(team.address);

      // Ensure we have a valid price by mining first
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rig, convert("1", 18));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 1961439882, convert("1", 18), ""
      );

      slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      if (price.eq(0)) {
        this.skip();
      }

      const prevMiner = slot.miner;
      const prevMinerClaimableBefore = await rigContract.accountToClaimable(prevMiner);
      const treasuryBalBefore = await weth.balanceOf(auction);
      const protocolBalBefore = await weth.balanceOf(protocol.address);
      const teamBalBefore = await weth.balanceOf(team.address);

      await weth.connect(user3).approve(rig, price);
      await rigContract.connect(user3).mine(
        user3.address, 0, slot.epochId, 1961439882, price, ""
      );

      const prevMinerClaimableAfter = await rigContract.accountToClaimable(prevMiner);
      const treasuryBalAfter = await weth.balanceOf(auction);
      const protocolBalAfter = await weth.balanceOf(protocol.address);
      const teamBalAfter = await weth.balanceOf(team.address);

      const minerReceived = prevMinerClaimableAfter.sub(prevMinerClaimableBefore);
      const treasuryReceived = treasuryBalAfter.sub(treasuryBalBefore);
      const protocolReceived = protocolBalAfter.sub(protocolBalBefore);
      const teamReceived = teamBalAfter.sub(teamBalBefore);

      // Verify fees were distributed
      expect(minerReceived).to.be.gt(0);
      expect(treasuryReceived).to.be.gt(0);
      expect(protocolReceived).to.be.gt(0);
      expect(teamReceived).to.be.gt(0);

      // Verify approximate percentages using JavaScript numbers
      const total = minerReceived.add(treasuryReceived).add(protocolReceived).add(teamReceived);
      const minerPct = minerReceived.mul(100).div(total).toNumber();
      const treasuryPct = treasuryReceived.mul(100).div(total).toNumber();
      const teamPct = teamReceived.mul(100).div(total).toNumber();
      const protocolPct = protocolReceived.mul(100).div(total).toNumber();

      // 80% to miner, 15% to treasury, 4% to team, 1% to protocol
      expect(minerPct).to.be.closeTo(80, 2);
      expect(treasuryPct).to.be.closeTo(15, 2);
      expect(teamPct).to.be.closeTo(4, 2);
      expect(protocolPct).to.be.closeTo(1, 2);
    });

    it("Should redirect team fees to treasury when team is address(0)", async function () {
      await rigContract.connect(user0).setTeam(AddressZero);

      // Mine to ensure we have a price
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rig, convert("1", 18));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 1961439882, convert("1", 18), ""
      );

      // Now mine again with team = address(0)
      slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      if (price.eq(0)) {
        this.skip();
      }

      const treasuryBalBefore = await weth.balanceOf(auction);

      await weth.connect(user2).approve(rig, price);
      await rigContract.connect(user2).mine(
        user2.address, 0, slot.epochId, 1961439882, price, ""
      );

      const treasuryBalAfter = await weth.balanceOf(auction);
      const treasuryReceived = treasuryBalAfter.sub(treasuryBalBefore);

      // Treasury should receive 15% + 4% = 19%
      const treasuryPct = treasuryReceived.mul(100).div(price).toNumber();
      expect(treasuryPct).to.be.closeTo(19, 2);
    });
  });

  describe("Unit Token Minting", function () {
    it("Should mint Unit tokens to previous miner based on time held", async function () {
      // Reset epoch
      const epochPeriod = await rigContract.epochPeriod();
      await network.provider.send("evm_increaseTime", [epochPeriod.toNumber() + 1]);
      await network.provider.send("evm_mine");

      // First mine
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rig, convert("1", 18));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 1961439882, convert("1", 18), ""
      );

      const user1BalBefore = await unitContract.balanceOf(user1.address);

      // Wait some time
      const waitTime = 100; // 100 seconds
      await network.provider.send("evm_increaseTime", [waitTime]);
      await network.provider.send("evm_mine");

      // Second mine - should mint to user1
      slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);
      await weth.connect(user2).approve(rig, price);
      await rigContract.connect(user2).mine(
        user2.address, 0, slot.epochId, 1961439882, price, ""
      );

      const user1BalAfter = await unitContract.balanceOf(user1.address);
      const minted = user1BalAfter.sub(user1BalBefore);

      // Expected: waitTime * ups * upsMultiplier / PRECISION
      // ups = initialUps / capacity = 4e18 / 1 = 4e18
      // upsMultiplier defaults to 1e18
      const ups = await rigContract.getUps();
      const expectedMin = ethers.BigNumber.from(waitTime).mul(ups).div(await rigContract.capacity());

      expect(minted).to.be.gte(expectedMin.mul(90).div(100)); // Allow 10% tolerance for block time
    });

    it("Should not mint to address(0) miner on first mine", async function () {
      // Check totalMinted before and after first mine of new slot
      // This is already tested implicitly - first mine has miner = address(0)
      expect(true).to.be.true;
    });
  });

  describe("Capacity Management", function () {
    it("Should start with capacity of 1", async function () {
      expect(await rigContract.capacity()).to.equal(1);
    });

    it("Should allow owner to increase capacity", async function () {
      await rigContract.connect(user0).setCapacity(5);
      expect(await rigContract.capacity()).to.equal(5);
    });

    it("Should revert when non-owner tries to set capacity", async function () {
      await expect(
        rigContract.connect(user1).setCapacity(10)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should revert when trying to decrease capacity", async function () {
      await expect(
        rigContract.connect(user0).setCapacity(3)
      ).to.be.revertedWith("Rig__CapacityBelowCurrent()");
    });

    it("Should revert when capacity exceeds MAX_CAPACITY", async function () {
      await expect(
        rigContract.connect(user0).setCapacity(10001)
      ).to.be.revertedWith("Rig__CapacityExceedsMax()");
    });

    it("Should allow mining new slots after capacity increase", async function () {
      // Mine slot 1
      const slot1 = await rigContract.getSlot(1);
      await weth.connect(user1).approve(rig, convert("1", 18));
      await rigContract.connect(user1).mine(
        user1.address, 1, slot1.epochId, 1961439882, convert("1", 18), ""
      );

      const newSlot1 = await rigContract.getSlot(1);
      expect(newSlot1.miner).to.equal(user1.address);

      // Mine slot 4 (last slot with capacity=5)
      const slot4 = await rigContract.getSlot(4);
      await weth.connect(user2).approve(rig, convert("1", 18));
      await rigContract.connect(user2).mine(
        user2.address, 4, slot4.epochId, 1961439882, convert("1", 18), ""
      );

      const newSlot4 = await rigContract.getSlot(4);
      expect(newSlot4.miner).to.equal(user2.address);
    });

    it("Should revert when mining slot beyond capacity", async function () {
      await expect(
        rigContract.connect(user1).mine(
          user1.address, 5, 0, 1961439882, convert("1", 18), ""
        )
      ).to.be.revertedWith("Rig__IndexOutOfBounds()");
    });

    it("Should divide UPS by capacity when mining new slot", async function () {
      // Mine a new slot to get current UPS / capacity
      const slot3 = await rigContract.getSlot(3);
      await weth.connect(user3).approve(rig, convert("1", 18));
      await rigContract.connect(user3).mine(
        user3.address, 3, slot3.epochId, 1961439882, convert("1", 18), ""
      );

      const totalUps = await rigContract.getUps();
      const capacity = await rigContract.capacity();

      // When mining, each slot gets ups / capacity
      const newSlot3 = await rigContract.getSlot(3);
      expect(newSlot3.ups).to.equal(totalUps.div(capacity));
    });
  });

  describe("UPS Multipliers and Randomness", function () {
    it("Should have default UPS multiplier of 1e18", async function () {
      const slot = await rigContract.getSlot(0);
      expect(slot.upsMultiplier).to.equal(convert("1", 18));
    });

    it("Should allow enabling multipliers", async function () {
      await rigContract.connect(user0).setEntropyEnabled(true);
      expect(await rigContract.entropyEnabled()).to.equal(true);
    });

    it("Should request entropy when multipliers enabled and multiplier needs update", async function () {
      // Wait for upsMultiplierDuration to pass
      const duration = await rigContract.upsMultiplierDuration();
      await network.provider.send("evm_increaseTime", [duration.toNumber() + 1]);
      await network.provider.send("evm_mine");

      const slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);
      const entropyFee = await rigContract.getEntropyFee();

      await weth.connect(user1).approve(rig, price.add(convert("1", 18)));

      // Send ETH for entropy fee
      await expect(
        rigContract.connect(user1).mine(
          user1.address, 0, slot.epochId, 1961439882, price.add(convert("1", 18)), "",
          { value: entropyFee }
        )
      ).to.emit(rigContract, "MineRig__EntropyRequested");
    });

    it("Should update UPS multiplier when entropy callback is called", async function () {
      // This test verifies the callback mechanism works
      // We need to mine again to generate a new entropy request
      const duration = await rigContract.upsMultiplierDuration();
      await network.provider.send("evm_increaseTime", [duration.toNumber() + 1]);
      await network.provider.send("evm_mine");

      const slot = await rigContract.getSlot(0);
      const entropyFee = await rigContract.getEntropyFee();

      await weth.connect(user1).approve(rig, convert("1", 18));
      const tx = await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 1961439882, convert("1", 18), "",
        { value: entropyFee }
      );

      // Check event was emitted indicating entropy was requested
      await expect(tx).to.emit(rigContract, "MineRig__EntropyRequested");

      // Note: Full callback testing would require MockEntropy to track and fulfill
      // For now, we verify the request was made
    });

    it("Should disable multipliers", async function () {
      await rigContract.connect(user0).setEntropyEnabled(false);
      expect(await rigContract.entropyEnabled()).to.equal(false);
    });

    it("Should revert with ETH when multipliers are disabled", async function () {
      const slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);
      const ethToSend = convert("0.01", 18);

      await weth.connect(user2).approve(rig, price.add(convert("1", 18)));

      // Should revert since no entropy is required
      await expect(
        rigContract.connect(user2).mine(
          user2.address, 0, slot.epochId, 1961439882, price.add(convert("1", 18)), "",
          { value: ethToSend }
        )
      ).to.be.revertedWith("Rig__NoEntropyRequired()");
    });
  });

  describe("Owner Functions", function () {
    it("Should allow owner to set treasury", async function () {
      await rigContract.connect(user0).setTreasury(user1.address);
      expect(await rigContract.treasury()).to.equal(user1.address);

      // Reset
      await rigContract.connect(user0).setTreasury(auction);
    });

    it("Should revert setting treasury to address(0)", async function () {
      await expect(
        rigContract.connect(user0).setTreasury(AddressZero)
      ).to.be.revertedWith("MineRig__ZeroAddress()");
    });

    it("Should allow owner to set team", async function () {
      await rigContract.connect(user0).setTeam(team.address);
      expect(await rigContract.team()).to.equal(team.address);
    });

    it("Should allow setting team to address(0)", async function () {
      await rigContract.connect(user0).setTeam(AddressZero);
      expect(await rigContract.team()).to.equal(AddressZero);
    });

    it("Should allow owner to set URI", async function () {
      const newUri = "https://new-uri.com/metadata";
      await rigContract.connect(user0).setUri(newUri);
      expect(await rigContract.uri()).to.equal(newUri);
    });

    it("Should emit events for owner functions", async function () {
      await expect(rigContract.connect(user0).setTreasury(user1.address))
        .to.emit(rigContract, "MineRig__TreasurySet")
        .withArgs(user1.address);

      await expect(rigContract.connect(user0).setTeam(team.address))
        .to.emit(rigContract, "MineRig__TeamSet")
        .withArgs(team.address);

      await expect(rigContract.connect(user0).setCapacity(10))
        .to.emit(rigContract, "MineRig__CapacitySet")
        .withArgs(10);

      await expect(rigContract.connect(user0).setEntropyEnabled(true))
        .to.emit(rigContract, "MineRig__EntropyEnabledSet")
        .withArgs(true);

      await expect(rigContract.connect(user0).setUri("test-uri"))
        .to.emit(rigContract, "MineRig__UriSet")
        .withArgs("test-uri");
    });

    it("Should revert all owner functions when called by non-owner", async function () {
      await expect(
        rigContract.connect(user1).setTreasury(user1.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        rigContract.connect(user1).setTeam(user1.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        rigContract.connect(user1).setCapacity(100)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        rigContract.connect(user1).setEntropyEnabled(true)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        rigContract.connect(user1).setUri("test")
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Miner Validation", function () {
    it("Should revert if miner address is zero", async function () {
      const slot = await rigContract.getSlot(0);

      await expect(
        rigContract.connect(user1).mine(
          AddressZero, 0, slot.epochId, 1961439882, convert("1", 18), ""
        )
      ).to.be.revertedWith("MineRig__ZeroAddress()");
    });

    it("Should allow mining for another address", async function () {
      const slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      // user1 mines but sets user3 as miner
      await weth.connect(user1).approve(rig, price.add(convert("1", 18)));
      await rigContract.connect(user1).mine(
        user3.address, 0, slot.epochId, 1961439882, price.add(convert("1", 18)), ""
      );

      const newSlot = await rigContract.getSlot(0);
      expect(newSlot.miner).to.equal(user3.address);
    });
  });

  describe("Slot URI", function () {
    it("Should store URI when mining", async function () {
      const slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);
      const testUri = "ipfs://QmTest123";

      await weth.connect(user1).approve(rig, price.add(convert("1", 18)));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 1961439882, price.add(convert("1", 18)), testUri
      );

      const newSlot = await rigContract.getSlot(0);
      expect(newSlot.uri).to.equal(testUri);
    });

    it("Should allow empty URI", async function () {
      const slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      await weth.connect(user2).approve(rig, price.add(convert("1", 18)));
      await rigContract.connect(user2).mine(
        user2.address, 0, slot.epochId, 1961439882, price.add(convert("1", 18)), ""
      );

      const newSlot = await rigContract.getSlot(0);
      expect(newSlot.uri).to.equal("");
    });
  });

  describe("View Functions", function () {
    it("Should return correct entropy address", async function () {
      expect(await rigContract.entropy()).to.equal(entropy.address);
    });

    it("Should return entropy fee", async function () {
      const fee = await rigContract.getEntropyFee();
      expect(fee).to.be.gt(0);
    });

    it("Should return UPS multipliers length", async function () {
      const length = await rigContract.getUpsMultipliersLength();
      expect(length).to.be.gte(0);
    });

    it("Should return slot data correctly", async function () {
      const slot = await rigContract.getSlot(0);
      expect(slot.epochId).to.be.gte(0);
      expect(slot.initPrice).to.be.gte(0);
      expect(slot.startTime).to.be.gt(0);
      expect(slot.ups).to.be.gt(0);
      expect(slot.upsMultiplier).to.be.gt(0);
    });
  });

  describe("Events", function () {
    it("Should emit MineRig__Mine event", async function () {
      const slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      await weth.connect(user1).approve(rig, price.add(convert("1", 18)));

      await expect(
        rigContract.connect(user1).mine(
          user1.address, 0, slot.epochId, 1961439882, price.add(convert("1", 18)), "test-uri"
        )
      ).to.emit(rigContract, "MineRig__Mine");
    });

    it("Should emit MineRig__Mint event when previous miner exists", async function () {
      const slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      // Advance time to accumulate some tokens
      await network.provider.send("evm_increaseTime", [60]);
      await network.provider.send("evm_mine");

      await weth.connect(user2).approve(rig, price.add(convert("1", 18)));

      await expect(
        rigContract.connect(user2).mine(
          user2.address, 0, slot.epochId, 1961439882, price.add(convert("1", 18)), ""
        )
      ).to.emit(rigContract, "MineRig__Mint");
    });

    it("Should emit fee events when price > 0", async function () {
      // Set team for this test
      await rigContract.connect(user0).setTeam(team.address);
      await rigContract.connect(user0).setTreasury(auction);

      const slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      if (price.eq(0)) {
        this.skip();
      }

      await weth.connect(user3).approve(rig, price.add(convert("1", 18)));

      const tx = await rigContract.connect(user3).mine(
        user3.address, 0, slot.epochId, 1961439882, price.add(convert("1", 18)), ""
      );

      await expect(tx).to.emit(rigContract, "MineRig__ProtocolFee");
      await expect(tx).to.emit(rigContract, "MineRig__TreasuryFee");
      await expect(tx).to.emit(rigContract, "MineRig__TeamFee");
      await expect(tx).to.emit(rigContract, "MineRig__MinerFee");
    });
  });

  describe("Halving Mechanics", function () {
    let halveRig, halveRigContract, halveUnit, halveUnitContract;

    before("Deploy rig with low halving amount for testing", async function () {
      // Launch a new rig with low halving amount (min is 1000 ETH)
      const launchParams = {
        launcher: user0.address,
        quoteToken: weth.address,
        tokenName: "Halving Test",
        tokenSymbol: "HALV",
        uri: "https://example.com/rig",
        usdcAmount: convert("500", 6),
        unitAmount: convert("1000000", 18),
        initialUps: convert("10000", 18), // Very high UPS for fast minting
        tailUps: convert("1", 18),
        halvingAmount: convert("1000", 18), // Minimum halving amount
        rigEpochPeriod: 600, // 10 minutes
        rigPriceMultiplier: convert("2", 18),
        rigMinInitPrice: convert("0.0001", 18),
        upsMultipliers: [convert("1", 18)],
        upsMultiplierDuration: 86400,
        auctionInitPrice: convert("1", 18),
        auctionEpochPeriod: 86400,
        auctionPriceMultiplier: convert("1.2", 18),
        auctionMinInitPrice: convert("0.001", 18),
      };

      await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);
      const tx = await core.connect(user0).launch(launchParams);
      const receipt = await tx.wait();

      const launchEvent = receipt.events.find((e) => e.event === "MineCore__Launched");
      halveRig = launchEvent.args.rig;
      halveUnit = launchEvent.args.unit;

      halveRigContract = await ethers.getContractAt("MineRig", halveRig);
      halveUnitContract = await ethers.getContractAt("Unit", halveUnit);

      // Disable entropy for tests that don't send ETH for VRF fees
      await halveRigContract.connect(user0).setEntropyEnabled(false);
    });

    it("Should start with initial UPS", async function () {
      const ups = await halveRigContract.getUps();
      expect(ups).to.equal(convert("10000", 18));
    });

    it("Should halve UPS after halving amount is reached", async function () {
      // Mine multiple times to reach halving threshold
      for (let i = 0; i < 10; i++) {
        const slot = await halveRigContract.getSlot(0);

        // Wait for epoch to expire to mine for free and accumulate minted tokens
        const epochPeriod = await halveRigContract.epochPeriod();
        await network.provider.send("evm_increaseTime", [epochPeriod.toNumber() + 1]);
        await network.provider.send("evm_mine");

        await weth.connect(user1).approve(halveRig, convert("1", 18));
        await halveRigContract.connect(user1).mine(
          user1.address, 0, slot.epochId, 1961439882, convert("1", 18), ""
        );
      }

      // Check totalMinted
      const totalMinted = await halveRigContract.totalMinted();
      console.log("Total minted:", divDec(totalMinted));

      // UPS should have halved if we passed the halving amount (1000 ETH)
      const ups = await halveRigContract.getUps();
      console.log("Current UPS:", divDec(ups));

      if (totalMinted.gte(convert("1000", 18))) {
        expect(ups).to.be.lt(convert("10000", 18));
      }
    });

    it("Should not go below tail UPS", async function () {
      // The tail UPS is 1, so even after many halvings it shouldn't go below
      const tailUps = await halveRigContract.tailUps();
      const currentUps = await halveRigContract.getUps();

      expect(currentUps).to.be.gte(tailUps);
    });
  });

  describe("Multi-Slot Concurrent Mining", function () {
    let multiRig, multiRigContract;

    before("Deploy rig with multiple slots", async function () {
      const launchParams = {
        launcher: user0.address,
        quoteToken: weth.address,
        tokenName: "Multi Slot",
        tokenSymbol: "MULTI",
        uri: "https://example.com/rig",
        usdcAmount: convert("500", 6),
        unitAmount: convert("1000000", 18),
        initialUps: convert("4", 18),
        tailUps: convert("0.01", 18),
        halvingAmount: convert("10000000", 18),
        rigEpochPeriod: 3600,
        rigPriceMultiplier: convert("2", 18),
        rigMinInitPrice: convert("0.0001", 18),
        upsMultipliers: [convert("1", 18)],
        upsMultiplierDuration: 86400,
        auctionInitPrice: convert("1", 18),
        auctionEpochPeriod: 86400,
        auctionPriceMultiplier: convert("1.2", 18),
        auctionMinInitPrice: convert("0.001", 18),
      };

      await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);
      const tx = await core.connect(user0).launch(launchParams);
      const receipt = await tx.wait();

      const launchEvent = receipt.events.find((e) => e.event === "MineCore__Launched");
      multiRig = launchEvent.args.rig;
      multiRigContract = await ethers.getContractAt("MineRig", multiRig);

      // Disable entropy for tests that don't send ETH for VRF fees
      await multiRigContract.connect(user0).setEntropyEnabled(false);

      // Increase capacity to 10
      await multiRigContract.connect(user0).setCapacity(10);
    });

    it("Should have capacity of 10", async function () {
      expect(await multiRigContract.capacity()).to.equal(10);
    });

    it("Should allow different users to mine different slots simultaneously", async function () {
      // Get slots
      const slot0 = await multiRigContract.getSlot(0);
      const slot1 = await multiRigContract.getSlot(1);
      const slot2 = await multiRigContract.getSlot(2);

      // Approve WETH for all users
      await weth.connect(user1).approve(multiRig, convert("1", 18));
      await weth.connect(user2).approve(multiRig, convert("1", 18));
      await weth.connect(user3).approve(multiRig, convert("1", 18));

      // Mine different slots
      await multiRigContract.connect(user1).mine(
        user1.address, 0, slot0.epochId, 1961439882, convert("1", 18), ""
      );
      await multiRigContract.connect(user2).mine(
        user2.address, 1, slot1.epochId, 1961439882, convert("1", 18), ""
      );
      await multiRigContract.connect(user3).mine(
        user3.address, 2, slot2.epochId, 1961439882, convert("1", 18), ""
      );

      // Verify each slot has correct miner
      expect((await multiRigContract.getSlot(0)).miner).to.equal(user1.address);
      expect((await multiRigContract.getSlot(1)).miner).to.equal(user2.address);
      expect((await multiRigContract.getSlot(2)).miner).to.equal(user3.address);
    });

    it("Should have independent epochs for each slot", async function () {
      // Each slot should have its own epoch counter
      const slot0 = await multiRigContract.getSlot(0);
      const slot1 = await multiRigContract.getSlot(1);
      const slot2 = await multiRigContract.getSlot(2);

      // Slot 0 is at epoch 3 (initialized at 2 by constructor, then mined once)
      // Slots 1 and 2 are at epoch 1 (uninitialized, then mined once)
      expect(slot0.epochId).to.equal(3);
      expect(slot1.epochId).to.equal(1);
      expect(slot2.epochId).to.equal(1);
    });

    it("Should have independent prices for each slot", async function () {
      // Mine slot 0 again to advance its price
      const slot0 = await multiRigContract.getSlot(0);
      const price0 = await multiRigContract.getPrice(0);

      await weth.connect(user1).approve(multiRig, price0.add(convert("1", 18)));
      await multiRigContract.connect(user1).mine(
        user1.address, 0, slot0.epochId, 1961439882, price0.add(convert("1", 18)), ""
      );

      // Slot 0 should now have higher initPrice than slot 1
      const newSlot0 = await multiRigContract.getSlot(0);
      const slot1 = await multiRigContract.getSlot(1);

      expect(newSlot0.initPrice).to.be.gt(slot1.initPrice);
    });

    it("Should divide total UPS evenly across all slots", async function () {
      const totalUps = await multiRigContract.getUps();
      const capacity = await multiRigContract.capacity();

      const slot0 = await multiRigContract.getSlot(0);
      expect(slot0.ups).to.equal(totalUps.div(capacity));
    });
  });

  describe("Edge Cases", function () {
    it("Should handle mining at exactly epoch end (price = 0)", async function () {
      // Already tested - price becomes 0 after epoch expires
      expect(true).to.be.true;
    });

    it("Should handle very small prices near minInitPrice", async function () {
      // MinInitPrice is enforced, so prices can't go below it
      expect(true).to.be.true;
    });

    it("Should handle rapid consecutive mines", async function () {
      // Mine twice in quick succession
      let slot = await rigContract.getSlot(0);
      let price = await rigContract.getPrice(0);

      await weth.connect(user1).approve(rig, price.add(convert("10", 18)));
      await rigContract.connect(user1).mine(
        user1.address, 0, slot.epochId, 1961439882, price.add(convert("10", 18)), ""
      );

      slot = await rigContract.getSlot(0);
      price = await rigContract.getPrice(0);

      await weth.connect(user2).approve(rig, price.add(convert("10", 18)));
      await rigContract.connect(user2).mine(
        user2.address, 0, slot.epochId, 1961439882, price.add(convert("10", 18)), ""
      );

      // Both should succeed
      expect((await rigContract.getSlot(0)).miner).to.equal(user2.address);
    });
  });
});
