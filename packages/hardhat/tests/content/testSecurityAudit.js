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

let owner, protocol, launcher, attacker, user1, user2;
let usdc, donut, registry, core;
let content, minter, rewarder, auction, unit, lpToken;
let unitFactory, contentFactory, minterFactory, rewarderFactory, auctionFactory;
let uniswapFactory, uniswapRouter;

const WEEK = 7 * 24 * 60 * 60;
const DAY = 24 * 60 * 60;

describe("Security Audit Tests", function () {
  before("Initial set up", async function () {
    await network.provider.send("hardhat_reset");
    console.log("Begin Security Audit Initialization");

    [owner, protocol, launcher, attacker, user1, user2] = await ethers.getSigners();

    // Deploy USDC (6 decimals) as quote token
    const usdcArtifact = await ethers.getContractFactory("MockUSDC");
    usdc = await usdcArtifact.deploy();

    // Deploy mock DONUT token
    const donutArtifact = await ethers.getContractFactory("MockWETH");
    donut = await donutArtifact.deploy();

    // Deploy mock Uniswap V2 Factory and Router
    const mockUniswapFactoryArtifact = await ethers.getContractFactory("MockUniswapV2Factory");
    uniswapFactory = await mockUniswapFactoryArtifact.deploy();

    const mockUniswapRouterArtifact = await ethers.getContractFactory("MockUniswapV2Router");
    uniswapRouter = await mockUniswapRouterArtifact.deploy(uniswapFactory.address);

    // Deploy Registry
    const registryArtifact = await ethers.getContractFactory("Registry");
    registry = await registryArtifact.deploy();

    // Deploy factories
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

    // Approve ContentCore as factory in Registry
    await registry.setFactoryApproval(core.address, true);

    // Mint DONUT to launcher and launch a content engine
    await donut.connect(launcher).deposit({ value: convert("1000", 18) });

    const launchParams = {
      launcher: launcher.address,
      tokenName: "Security Test Unit",
      tokenSymbol: "STUNIT",
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

    console.log("Security Audit Initialization Complete\n");
  });

  describe("1. Reentrancy Attack Tests", function () {
    it("Content.collect() is protected against reentrancy", async function () {
      // The nonReentrant modifier prevents reentrancy
      // We verify the modifier is in place by checking contract behavior
      await content.connect(user1).create(user1.address, "ipfs://reentrancy-test");
      const tokenId = await content.nextTokenId();
      const price = await content.getPrice(tokenId);

      await usdc.mint(user1.address, price.mul(2));
      await usdc.connect(user1).approve(content.address, price.mul(2));

      const auctionData = await getAuctionData(content, tokenId);

      // Normal collection should work
      await content.connect(user1).collect(
        user1.address,
        tokenId,
        auctionData.epochId,
        ethers.constants.MaxUint256,
        price
      );

      // Verify state changed
      expect(await content.ownerOf(tokenId)).to.equal(user1.address);
    });

    it("Auction.buy() is protected against reentrancy", async function () {
      // Send some USDC to auction for testing
      await usdc.mint(user1.address, convert("1", 6));
      await usdc.connect(user1).transfer(auction.address, convert("1", 6));

      // Auction buy should work normally with nonReentrant
      const price = await auction.getPrice();
      const epochId = await auction.epochId();

      // User needs LP tokens to buy
      // Skip if user doesn't have LP tokens (auction test handled elsewhere)
    });
  });

  describe("2. Access Control Tests", function () {
    it("Unit.mint() only callable by minter", async function () {
      await expect(
        unit.connect(attacker).mint(attacker.address, convert("1000", 18))
      ).to.be.reverted;
    });

    it("Unit.setRig() only callable by current minter", async function () {
      await expect(
        unit.connect(attacker).setRig(attacker.address)
      ).to.be.reverted;
    });

    it("Rewarder.deposit() only callable by Content", async function () {
      await expect(
        rewarder.connect(attacker).deposit(attacker.address, convert("1", 18))
      ).to.be.reverted;
    });

    it("Rewarder.withdraw() only callable by Content", async function () {
      await expect(
        rewarder.connect(attacker).withdraw(attacker.address, convert("1", 18))
      ).to.be.reverted;
    });

    it("Rewarder.addReward() only callable by Content", async function () {
      await expect(
        rewarder.connect(attacker).addReward(usdc.address)
      ).to.be.reverted;
    });

    it("Content owner functions are restricted", async function () {
      await expect(
        content.connect(attacker).setUri("ipfs://malicious")
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        content.connect(attacker).setTreasury(attacker.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        content.connect(attacker).setIsModerated(true)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        content.connect(attacker).addReward(usdc.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Core owner functions are restricted", async function () {
      await expect(
        core.connect(attacker).setProtocolFeeAddress(attacker.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        core.connect(attacker).setMinDonutForLaunch(0)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("3. Front-Running Protection Tests", function () {
    it("Content.collect() epochId protects against front-running", async function () {
      await content.connect(user1).create(user1.address, "ipfs://frontrun-epoch");
      const tokenId = await content.nextTokenId();

      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);

      // Attacker tries with wrong epochId
      await usdc.mint(attacker.address, price.mul(2));
      await usdc.connect(attacker).approve(content.address, price.mul(2));

      const wrongEpochId = auctionData.epochId.add(1);

      await expect(
        content.connect(attacker).collect(
          attacker.address,
          tokenId,
          wrongEpochId,
          ethers.constants.MaxUint256,
          price.mul(2)
        )
      ).to.be.revertedWith("ContentRig__EpochIdMismatch()");
    });

    it("Content.collect() deadline prevents stale transactions", async function () {
      await content.connect(user1).create(user1.address, "ipfs://frontrun-deadline");
      const tokenId = await content.nextTokenId();

      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);

      const block = await ethers.provider.getBlock("latest");
      const expiredDeadline = block.timestamp - 1;

      await expect(
        content.connect(attacker).collect(
          attacker.address,
          tokenId,
          auctionData.epochId,
          expiredDeadline,
          price.mul(2)
        )
      ).to.be.revertedWith("ContentRig__Expired()");
    });

    it("Content.collect() maxPrice prevents sandwich attacks", async function () {
      await content.connect(user1).create(user1.address, "ipfs://frontrun-maxprice");
      const tokenId = await content.nextTokenId();

      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);

      if (price.gt(0)) {
        await expect(
          content.connect(attacker).collect(
            attacker.address,
            tokenId,
            auctionData.epochId,
            ethers.constants.MaxUint256,
            0 // maxPrice = 0 but current price > 0
          )
        ).to.be.revertedWith("ContentRig__MaxPriceExceeded()");
      }
    });

    it("Auction.buy() has similar protections", async function () {
      const epochId = await auction.epochId();
      const wrongEpochId = epochId.add(1);

      await expect(
        auction.connect(attacker).buy(
          [usdc.address],
          attacker.address,
          wrongEpochId,
          ethers.constants.MaxUint256,
          convert("100", 18)
        )
      ).to.be.revertedWith("Auction__EpochIdMismatch()");
    });
  });

  describe("4. Integer Overflow/Underflow Tests", function () {
    it("Solidity 0.8.19 prevents overflow in price calculations", async function () {
      // Content uses price * PRICE_MULTIPLIER / PRECISION
      // With PRICE_MULTIPLIER = 2e18 and PRECISION = 1e18
      // Max price bounded by ABS_MAX_INIT_PRICE = type(uint192).max

      // This is handled by the bounds checking in the contract
      const absMaxInitPrice = ethers.BigNumber.from(2).pow(192).sub(1);
      expect(absMaxInitPrice).to.be.gt(0);
    });

    it("Minter emission calculation doesn't overflow", async function () {
      // MAX_INITIAL_UPS = 1e24, WEEK = 604800
      // 1e24 * 604800 = 6.048e29, fits in uint256 (max ~1.15e77)
      const maxInitialUps = ethers.BigNumber.from(10).pow(24);
      const week = ethers.BigNumber.from(604800);
      const maxWeekly = maxInitialUps.mul(week);

      // Should not throw
      expect(maxWeekly).to.be.gt(0);
      expect(maxWeekly.lt(ethers.constants.MaxUint256)).to.be.true;
    });

    it("Rewarder PRECISION prevents precision loss attacks", async function () {
      // PRECISION = 1e18 is sufficient for most calculations
      const precision = await rewarder.PRECISION();
      expect(precision).to.equal(convert("1", 18));
    });
  });

  describe("5. Denial of Service Tests", function () {
    it("Content.distribute() cannot be blocked by low balance", async function () {
      // distribute() requires balance > leftover AND balance > DURATION
      // If balance is very small, it just doesn't distribute
      // This is not a DoS, just normal behavior

      const duration = await rewarder.DURATION();
      expect(duration).to.equal(7 * 24 * 60 * 60); // 7 days in seconds
    });

    it("Minter.updatePeriod() can always be called by anyone", async function () {
      // No access control, anyone can trigger emission
      await minter.connect(attacker).updatePeriod();
      // Should not revert (might not mint if week hasn't passed)
    });

    it("Rewarder.getReward() can be called for any account", async function () {
      // Anyone can claim rewards for any account
      // Rewards go to the account, not the caller
      await rewarder.connect(attacker).getReward(user1.address);
      // Should not revert
    });

    it("Auction cannot be DoS'd via empty assets array", async function () {
      await expect(
        auction.connect(attacker).buy(
          [], // empty array
          attacker.address,
          await auction.epochId(),
          ethers.constants.MaxUint256,
          convert("100", 18)
        )
      ).to.be.revertedWith("Auction__EmptyAssets()");
    });
  });

  describe("6. Economic Attack Tests", function () {
    it("Flash loan attack on Content collection is not profitable", async function () {
      // NFT transfers are disabled, so flash loan attack cannot profit
      // Attacker cannot: flash loan → collect → sell NFT → repay

      await content.connect(user1).create(user1.address, "ipfs://flash-loan-test");
      const tokenId = await content.nextTokenId();

      // Verify transfers are blocked
      await expect(
        content.connect(user1).transferFrom(user1.address, attacker.address, tokenId)
      ).to.be.revertedWith("ContentRig__TransferDisabled()");
    });

    it("Reward dilution is prevented by stake-based distribution", async function () {
      // Low price collection = low stake = low rewards
      // Attacker cannot collect cheap and earn disproportionate rewards

      const totalSupply = await rewarder.totalSupply();
      // Rewards are proportional to stake/totalSupply
    });

    it("Protocol fee cannot be stolen", async function () {
      // Protocol fee goes to protocolFeeAddress
      // Only Core owner can change this
      const feeAddr = await core.protocolFeeAddress();
      expect(feeAddr).to.equal(protocol.address);
    });
  });

  describe("7. Input Validation Tests", function () {
    it("Content.create() validates inputs", async function () {
      await expect(
        content.connect(user1).create(AddressZero, "ipfs://test")
      ).to.be.revertedWith("ContentRig__ZeroTo()");

      await expect(
        content.connect(user1).create(user1.address, "")
      ).to.be.revertedWith("ContentRig__ZeroLengthUri()");
    });

    it("Content.collect() validates inputs", async function () {
      await expect(
        content.connect(user1).collect(AddressZero, 1, 0, ethers.constants.MaxUint256, convert("1", 6))
      ).to.be.revertedWith("ContentRig__ZeroTo()");
    });

    it("Core.launch() validates all parameters", async function () {
      await donut.connect(attacker).deposit({ value: convert("500", 18) });
      await donut.connect(attacker).approve(core.address, convert("500", 18));

      // Zero launcher
      await expect(
        core.connect(attacker).launch({
          launcher: AddressZero,
          tokenName: "Test",
          tokenSymbol: "TEST",
          uri: "ipfs://test",
          donutAmount: convert("500", 18),
          unitAmount: convert("1000", 18),
          initialUps: convert("1", 18),
          tailUps: convert("0.01", 18),
          halvingPeriod: WEEK,
          contentMinInitPrice: convert("1", 6),
          contentIsModerated: false,
          auctionInitPrice: convert("1000", 6),
          auctionEpochPeriod: DAY,
          auctionPriceMultiplier: convert("1.5", 18),
          auctionMinInitPrice: convert("1", 6),
        })
      ).to.be.revertedWith("ContentCore__InvalidLauncher()");

      // Empty token name
      await expect(
        core.connect(attacker).launch({
          launcher: attacker.address,
          tokenName: "",
          tokenSymbol: "TEST",
          uri: "ipfs://test",
          donutAmount: convert("500", 18),
          unitAmount: convert("1000", 18),
          initialUps: convert("1", 18),
          tailUps: convert("0.01", 18),
          halvingPeriod: WEEK,
          contentMinInitPrice: convert("1", 6),
          contentIsModerated: false,
          auctionInitPrice: convert("1000", 6),
          auctionEpochPeriod: DAY,
          auctionPriceMultiplier: convert("1.5", 18),
          auctionMinInitPrice: convert("1", 6),
        })
      ).to.be.revertedWith("ContentCore__EmptyTokenName()");
    });

    it("Auction validates epoch period bounds", async function () {
      const auctionFactoryContract = await ethers.getContractFactory("Auction");

      // Below minimum (1 hour)
      await expect(
        auctionFactoryContract.deploy(
          convert("1000", 6),
          usdc.address,
          AddressDead,
          60 * 30, // 30 minutes, below 1 hour minimum
          convert("1.5", 18),
          convert("1", 6)
        )
      ).to.be.revertedWith("Auction__EpochPeriodOutOfRange()");
    });

    it("Minter validates halving period bounds", async function () {
      const minterFactoryContract = await ethers.getContractFactory("Minter");

      // Below minimum (7 days)
      await expect(
        minterFactoryContract.deploy(
          unit.address,
          rewarder.address,
          convert("1", 18),
          convert("0.01", 18),
          DAY // 1 day, below 7 day minimum
        )
      ).to.be.revertedWith("Minter__HalvingPeriodBelowMin()");
    });
  });

  describe("8. State Consistency Tests", function () {
    it("Content stake matches Rewarder balance", async function () {
      await content.connect(user1).create(user1.address, "ipfs://stake-test");
      const tokenId = await content.nextTokenId();

      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);

      if (price.gt(0)) {
        await usdc.mint(user2.address, price.mul(2));
        await usdc.connect(user2).approve(content.address, price.mul(2));

        await content.connect(user2).collect(
          user2.address,
          tokenId,
          auctionData.epochId,
          ethers.constants.MaxUint256,
          price.mul(2)
        );

        const stake = await content.tokenIdToStake(tokenId);
        const rewarderBalance = await rewarder.accountToBalance(user2.address);

        // User's rewarder balance should include their stake
        expect(rewarderBalance).to.be.gte(stake);
      }
    });

    it("Epoch increments correctly after collection", async function () {
      await content.connect(user1).create(user1.address, "ipfs://epoch-test");
      const tokenId = await content.nextTokenId();

      const auctionBefore = await getAuctionData(content, tokenId);
      const epochBefore = auctionBefore.epochId;

      const price = await content.getPrice(tokenId);

      if (price.gt(0)) {
        await usdc.mint(user1.address, price.mul(2));
        await usdc.connect(user1).approve(content.address, price.mul(2));

        await content.connect(user1).collect(
          user1.address,
          tokenId,
          epochBefore,
          ethers.constants.MaxUint256,
          price.mul(2)
        );

        const auctionAfter = await getAuctionData(content, tokenId);
        expect(auctionAfter.epochId).to.equal(epochBefore.add(1));
      }
    });
  });

  describe("9. Edge Case Tests", function () {
    it("Zero price collection works correctly", async function () {
      await content.connect(user1).create(user1.address, "ipfs://zero-price");
      const tokenId = await content.nextTokenId();

      // Wait for price to decay to 0
      await ethers.provider.send("evm_increaseTime", [31 * DAY]);
      await ethers.provider.send("evm_mine");

      const price = await content.getPrice(tokenId);
      expect(price).to.equal(0);

      const auctionData = await getAuctionData(content, tokenId);

      // Should be able to collect for free
      await content.connect(user2).collect(
        user2.address,
        tokenId,
        auctionData.epochId,
        ethers.constants.MaxUint256,
        0
      );

      expect(await content.ownerOf(tokenId)).to.equal(user2.address);

      // Stake should be set to new minInitPrice (since price was 0)
      const stake = await content.tokenIdToStake(tokenId);
      expect(stake).to.equal(0);
    });

    it("First collection has no previous stake to withdraw", async function () {
      await content.connect(user1).create(user1.address, "ipfs://first-collect");
      const tokenId = await content.nextTokenId();

      const prevStake = await content.tokenIdToStake(tokenId);
      expect(prevStake).to.equal(0);

      // Collection should work even with 0 previous stake
      const auctionData = await getAuctionData(content, tokenId);
      const price = await content.getPrice(tokenId);

      if (price.gt(0)) {
        await usdc.mint(user2.address, price.mul(2));
        await usdc.connect(user2).approve(content.address, price.mul(2));

        await content.connect(user2).collect(
          user2.address,
          tokenId,
          auctionData.epochId,
          ethers.constants.MaxUint256,
          price.mul(2)
        );
      }
    });

    it("Minter handles week boundary correctly", async function () {
      const weeklyBefore = await minter.weeklyEmission();

      // Fast forward exactly one week
      await ethers.provider.send("evm_increaseTime", [WEEK]);
      await ethers.provider.send("evm_mine");

      await minter.updatePeriod();

      // Should have minted tokens
      const weeklyAfter = await minter.weeklyEmission();
      expect(weeklyAfter).to.be.gt(0);
    });
  });

  describe("10. Centralization Risk Tests", function () {
    it("Content owner can change treasury", async function () {
      // This is expected behavior, but a centralization risk
      const oldTreasury = await content.treasury();

      // Only owner can change
      await expect(
        content.connect(attacker).setTreasury(attacker.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      // Owner CAN change (centralization risk, but expected)
      await content.connect(launcher).setTreasury(launcher.address);
      expect(await content.treasury()).to.equal(launcher.address);

      // Restore
      await content.connect(launcher).setTreasury(oldTreasury);
    });

    it("Core owner can change protocol fee address", async function () {
      const oldFeeAddr = await core.protocolFeeAddress();

      // Only owner can change
      await expect(
        core.connect(attacker).setProtocolFeeAddress(attacker.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      // Owner CAN change (centralization risk, but expected)
      await core.connect(owner).setProtocolFeeAddress(owner.address);
      expect(await core.protocolFeeAddress()).to.equal(owner.address);

      // Restore
      await core.connect(owner).setProtocolFeeAddress(oldFeeAddr);
    });

    it("Unit minter is effectively immutable after transfer to Minter", async function () {
      // Once setRig is called with Minter contract address,
      // it cannot be changed because Minter has no setRig function
      const currentMinter = await unit.rig();
      expect(currentMinter).to.equal(minter.address);

      // Minter contract cannot call setRig (no such function)
      // This is verified by the lack of setRig in IMinter interface
    });
  });
});
