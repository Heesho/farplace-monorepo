/**
 * @title Deep Invariant Test Suite (First Half)
 * @notice Cross-contract accounting, self-displacement, multi-slot flow, quote token
 *         conservation, and SpinRig prize pool invariants.
 * @dev INV-DEEP-1 through INV-DEEP-14
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
// SECTION 1: Cross-Contract Token Accounting (MineRig)
// ============================================================================

describe("Section 1: Cross-Contract Token Accounting (MineRig)", function () {
  let owner, protocol, team, user0, user1, user2, user3;
  let weth, usdc, registry, core, entropy;
  let rigAddress, rigContract, auctionAddress, unitAddress, unitContract;
  let initialUnitSupply;

  before("Deploy fresh contracts", async function () {
    await network.provider.send("hardhat_reset");

    [owner, protocol, team, user0, user1, user2, user3] = await ethers.getSigners();

    // Deploy mock tokens
    const MockWETH = await ethers.getContractFactory("MockWETH");
    weth = await MockWETH.deploy();
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    // Deploy mock Entropy
    const MockEntropy = await ethers.getContractFactory("MockEntropy");
    entropy = await MockEntropy.deploy();

    // Deploy mock Uniswap
    const MockUniswapV2Factory = await ethers.getContractFactory("MockUniswapV2Factory");
    const uniswapFactory = await MockUniswapV2Factory.deploy();
    const MockUniswapV2Router = await ethers.getContractFactory("MockUniswapV2Router");
    const uniswapRouter = await MockUniswapV2Router.deploy(uniswapFactory.address);

    // Deploy factories
    const UnitFactory = await ethers.getContractFactory("UnitFactory");
    const unitFactory = await UnitFactory.deploy();
    const MineRigFactory = await ethers.getContractFactory("MineRigFactory");
    const rigFactory = await MineRigFactory.deploy();
    const AuctionFactory = await ethers.getContractFactory("AuctionFactory");
    const auctionFactory = await AuctionFactory.deploy();

    // Deploy Registry
    const Registry = await ethers.getContractFactory("Registry");
    registry = await Registry.deploy();

    // Deploy MineCore
    const MineCore = await ethers.getContractFactory("MineCore");
    core = await MineCore.deploy(
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

    await registry.setFactoryApproval(core.address, true);

    // Fund users
    await usdc.mint(user0.address, convert("5000", 6));
    await weth.connect(user0).deposit({ value: convert("500", 18) });
    await weth.connect(user1).deposit({ value: convert("500", 18) });
    await weth.connect(user2).deposit({ value: convert("500", 18) });
    await weth.connect(user3).deposit({ value: convert("500", 18) });

    const launchParams = {
      launcher: user0.address,
      quoteToken: weth.address,
      tokenName: "Deep Invariant Test",
      tokenSymbol: "DINV",
      uri: "https://test.com",
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

    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);
    const tx = await core.connect(user0).launch(launchParams);
    const receipt = await tx.wait();

    const launchEvent = receipt.events.find((e) => e.event === "MineCore__Launched");
    rigAddress = launchEvent.args.rig;
    unitAddress = launchEvent.args.unit;
    auctionAddress = launchEvent.args.auction;

    rigContract = await ethers.getContractAt("MineRig", rigAddress);
    unitContract = await ethers.getContractAt("Unit", unitAddress);

    // Disable entropy for deterministic tests
    await rigContract.connect(user0).setEntropyEnabled(false);

    // Set team for complete fee distribution
    await rigContract.connect(user0).setTeam(team.address);

    // Record the initial unit supply (unitAmount was minted for LP at launch)
    initialUnitSupply = await unitContract.totalSupply();
  });

  describe("INV-DEEP-1: Unit.totalSupply() changes match totalMinted delta for each mine", function () {
    it("Each mine operation that displaces a miner increases totalSupply by exactly the minted amount", async function () {
      // Mine slot 0 to install a miner
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rigAddress, convert("10", 18));
      let deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("10", 18), "");

      // Wait for tokens to accumulate
      await increaseTime(100);

      // Record state before displacement
      const totalMintedBefore = await rigContract.totalMinted();
      const totalSupplyBefore = await unitContract.totalSupply();

      // Displace user1 with user2
      slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);
      await weth.connect(user2).approve(rigAddress, price.add(convert("10", 18)));
      deadline = await getFutureDeadline();
      const tx = await rigContract.connect(user2).mine(user2.address, 0, slot.epochId, deadline, price.add(convert("10", 18)), "");
      const receipt = await tx.wait();

      // Get the minted amount from the event
      const mintEvent = receipt.events.find(e => e.event === "MineRig__Mint");
      const mintedAmount = mintEvent.args.amount;

      // Record state after displacement
      const totalMintedAfter = await rigContract.totalMinted();
      const totalSupplyAfter = await unitContract.totalSupply();

      // totalMinted should have increased by mintedAmount
      expect(totalMintedAfter.sub(totalMintedBefore)).to.equal(mintedAmount);

      // totalSupply should have increased by the same amount
      expect(totalSupplyAfter.sub(totalSupplyBefore)).to.equal(mintedAmount);
    });

    it("Multiple sequential mine operations accumulate totalMinted correctly", async function () {
      const totalMintedStart = await rigContract.totalMinted();
      const totalSupplyStart = await unitContract.totalSupply();
      let cumulativeMinted = ethers.BigNumber.from(0);

      const users = [user1, user2, user3, user1, user2];
      for (let i = 0; i < users.length; i++) {
        // Wait for some token accumulation
        await increaseTime(50);

        const slot = await rigContract.getSlot(0);
        const price = await rigContract.getPrice(0);
        await weth.connect(users[i]).approve(rigAddress, price.add(convert("10", 18)));
        const deadline = await getFutureDeadline();
        const tx = await rigContract.connect(users[i]).mine(
          users[i].address, 0, slot.epochId, deadline, price.add(convert("10", 18)), ""
        );
        const receipt = await tx.wait();

        const mintEvent = receipt.events.find(e => e.event === "MineRig__Mint");
        if (mintEvent) {
          cumulativeMinted = cumulativeMinted.add(mintEvent.args.amount);
        }
      }

      const totalMintedEnd = await rigContract.totalMinted();
      const totalSupplyEnd = await unitContract.totalSupply();

      // Cumulative minted from events should match totalMinted delta
      expect(totalMintedEnd.sub(totalMintedStart)).to.equal(cumulativeMinted);
      // And also match totalSupply delta
      expect(totalSupplyEnd.sub(totalSupplyStart)).to.equal(cumulativeMinted);
    });
  });

  describe("INV-DEEP-2: Sum of all user Unit balances + initial LP supply == Unit.totalSupply()", function () {
    it("All balances plus LP liquidity account for total supply after multiple mines", async function () {
      // The users who might hold tokens: user0 (launcher), user1, user2, user3
      // The LP pair also holds unitAmount from launch
      // The dead address holds burned LP tokens (but LP tokens are separate)
      // The unit tokens in LP are held by the Uniswap pair contract

      const user0Bal = await unitContract.balanceOf(user0.address);
      const user1Bal = await unitContract.balanceOf(user1.address);
      const user2Bal = await unitContract.balanceOf(user2.address);
      const user3Bal = await unitContract.balanceOf(user3.address);
      const ownerBal = await unitContract.balanceOf(owner.address);
      const protocolBal = await unitContract.balanceOf(protocol.address);
      const teamBal = await unitContract.balanceOf(team.address);
      const rigBal = await unitContract.balanceOf(rigAddress);
      const auctionBal = await unitContract.balanceOf(auctionAddress);

      const totalSupply = await unitContract.totalSupply();

      // Find the LP pair address to get its unit balance
      const coreContract = await ethers.getContractAt("MineCore", core.address);
      const lpAddress = await coreContract.rigToLP(rigAddress);

      let lpBal = ethers.BigNumber.from(0);
      if (lpAddress !== AddressZero) {
        lpBal = await unitContract.balanceOf(lpAddress);
      }

      // Sum of all known balances (including LP pair)
      const sumOfBalances = user0Bal
        .add(user1Bal)
        .add(user2Bal)
        .add(user3Bal)
        .add(ownerBal)
        .add(protocolBal)
        .add(teamBal)
        .add(rigBal)
        .add(auctionBal)
        .add(lpBal);

      // The sum of all balances should equal totalSupply.
      // There might be a dead address holding burned tokens too.
      const deadBal = await unitContract.balanceOf("0x000000000000000000000000000000000000dEaD");
      const totalAccountedFor = sumOfBalances.add(deadBal);

      expect(totalAccountedFor).to.equal(totalSupply);
    });
  });
});

// ============================================================================
// SECTION 2: MineRig Self-Displacement Invariants
// ============================================================================

describe("Section 2: MineRig Self-Displacement Invariants", function () {
  let owner, protocol, team, user0, user1, user2, user3;
  let weth, usdc, registry, core, entropy;
  let rigAddress, rigContract, auctionAddress, unitAddress, unitContract;

  before("Deploy fresh contracts", async function () {
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

    const UnitFactory = await ethers.getContractFactory("UnitFactory");
    const unitFactory = await UnitFactory.deploy();
    const MineRigFactory = await ethers.getContractFactory("MineRigFactory");
    const rigFactory = await MineRigFactory.deploy();
    const AuctionFactory = await ethers.getContractFactory("AuctionFactory");
    const auctionFactory = await AuctionFactory.deploy();

    const Registry = await ethers.getContractFactory("Registry");
    registry = await Registry.deploy();

    const MineCore = await ethers.getContractFactory("MineCore");
    core = await MineCore.deploy(
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

    await registry.setFactoryApproval(core.address, true);

    await usdc.mint(user0.address, convert("5000", 6));
    await weth.connect(user0).deposit({ value: convert("500", 18) });
    await weth.connect(user1).deposit({ value: convert("500", 18) });
    await weth.connect(user2).deposit({ value: convert("500", 18) });
    await weth.connect(user3).deposit({ value: convert("500", 18) });

    const launchParams = {
      launcher: user0.address,
      quoteToken: weth.address,
      tokenName: "Deep Invariant Test",
      tokenSymbol: "DINV",
      uri: "https://test.com",
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

    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);
    const tx = await core.connect(user0).launch(launchParams);
    const receipt = await tx.wait();

    const launchEvent = receipt.events.find((e) => e.event === "MineCore__Launched");
    rigAddress = launchEvent.args.rig;
    unitAddress = launchEvent.args.unit;
    auctionAddress = launchEvent.args.auction;

    rigContract = await ethers.getContractAt("MineRig", rigAddress);
    unitContract = await ethers.getContractAt("Unit", unitAddress);

    await rigContract.connect(user0).setEntropyEnabled(false);
    await rigContract.connect(user0).setTeam(team.address);
  });

  describe("INV-DEEP-3: Self-displacement at price 0 (epoch expired) mints tokens, no fee charged", function () {
    it("Miner can self-displace at price 0 after epoch expires and receives minted tokens", async function () {
      // user1 mines slot 0
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rigAddress, convert("10", 18));
      let deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("10", 18), "");

      // Wait for full epoch to expire
      const epochPeriod = await rigContract.epochPeriod();
      await increaseTime(epochPeriod.toNumber() + 1);

      // Verify price is 0
      const price = await rigContract.getPrice(0);
      expect(price).to.equal(0);

      // Record state before self-displacement
      const user1UnitBalBefore = await unitContract.balanceOf(user1.address);
      const user1WethBalBefore = await weth.balanceOf(user1.address);
      const claimableBefore = await rigContract.accountToClaimable(user1.address);
      const treasuryBefore = await weth.balanceOf(auctionAddress);
      const protocolBefore = await weth.balanceOf(protocol.address);
      const teamBefore = await weth.balanceOf(team.address);

      // Self-displace at price 0
      slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rigAddress, convert("10", 18));
      deadline = await getFutureDeadline();
      const tx = await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("10", 18), "");
      const receipt = await tx.wait();

      // Verify minted tokens were received
      const user1UnitBalAfter = await unitContract.balanceOf(user1.address);
      expect(user1UnitBalAfter).to.be.gt(user1UnitBalBefore);

      // Verify no WETH was spent (price was 0)
      const user1WethBalAfter = await weth.balanceOf(user1.address);
      expect(user1WethBalAfter).to.equal(user1WethBalBefore);

      // Verify no fee was charged to any party
      const claimableAfter = await rigContract.accountToClaimable(user1.address);
      const treasuryAfter = await weth.balanceOf(auctionAddress);
      const protocolAfter = await weth.balanceOf(protocol.address);
      const teamAfter = await weth.balanceOf(team.address);

      expect(claimableAfter).to.equal(claimableBefore); // No miner fee added
      expect(treasuryAfter).to.equal(treasuryBefore);
      expect(protocolAfter).to.equal(protocolBefore);
      expect(teamAfter).to.equal(teamBefore);
    });
  });

  describe("INV-DEEP-4: Self-displacement at non-zero price: net cost = 20%", function () {
    it("When a miner displaces themselves at non-zero price, they pay full but get 80% back as claimable", async function () {
      // user1 is already miner from previous test; start a fresh mine to reset epoch
      let slot = await rigContract.getSlot(0);

      // Record weth balance before the mine that will self-displace at non-zero price
      // user1 is currently the miner on slot 0 from the previous self-displacement
      const claimableBefore = await rigContract.accountToClaimable(user1.address);
      const user1WethBalBefore = await weth.balanceOf(user1.address);

      // The price should be close to initPrice right after last mine
      const price = await rigContract.getPrice(0);

      if (price.eq(0)) {
        // If epoch expired, skip since we need non-zero price
        this.skip();
        return;
      }

      // Self-displace at current price
      await weth.connect(user1).approve(rigAddress, price.add(convert("10", 18)));
      const deadline = await getFutureDeadline();
      const tx = await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, price.add(convert("10", 18)), "");
      const receipt = await tx.wait();

      const mineEvent = receipt.events.find(e => e.event === "MineRig__Mine");
      const actualPrice = mineEvent.args.price;

      // user1 paid actualPrice in WETH
      const user1WethBalAfter = await weth.balanceOf(user1.address);
      const wethSpent = user1WethBalBefore.sub(user1WethBalAfter);
      expect(wethSpent).to.equal(actualPrice);

      // user1 got 80% back as claimable (they were the previous miner)
      const claimableAfter = await rigContract.accountToClaimable(user1.address);
      const claimableGained = claimableAfter.sub(claimableBefore);

      const expectedMinerFee = actualPrice.mul(8000).div(10000); // 80%
      expect(claimableGained).to.be.closeTo(expectedMinerFee, 1);

      // Net cost is approximately 20% of the price (fees to treasury, team, protocol)
      const netCost = wethSpent.sub(claimableGained);
      const expectedNetCost = actualPrice.mul(2000).div(10000); // 20%
      expect(netCost).to.be.closeTo(expectedNetCost, 1);
    });
  });

  describe("INV-DEEP-5: Self-displacement preserves token minting", function () {
    it("Self-displacing miner still receives minted tokens for the time held", async function () {
      // user1 should be the miner from previous test. Wait to accumulate tokens.
      await increaseTime(200); // 200 seconds at 10 UPS = ~2000 tokens

      const user1UnitBalBefore = await unitContract.balanceOf(user1.address);
      const totalMintedBefore = await rigContract.totalMinted();

      // Self-displace (epoch may have expired, that is okay)
      const slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);
      await weth.connect(user1).approve(rigAddress, price.add(convert("10", 18)));
      const deadline = await getFutureDeadline();
      const tx = await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, price.add(convert("10", 18)), "");
      const receipt = await tx.wait();

      const mintEvent = receipt.events.find(e => e.event === "MineRig__Mint");
      expect(mintEvent).to.not.be.undefined;
      expect(mintEvent.args.amount).to.be.gt(0);

      // user1 received the minted tokens
      const user1UnitBalAfter = await unitContract.balanceOf(user1.address);
      expect(user1UnitBalAfter.sub(user1UnitBalBefore)).to.equal(mintEvent.args.amount);

      // totalMinted increased
      const totalMintedAfter = await rigContract.totalMinted();
      expect(totalMintedAfter.sub(totalMintedBefore)).to.equal(mintEvent.args.amount);
    });
  });
});

// ============================================================================
// SECTION 3: MineRig Multi-Slot Token Flow Conservation
// ============================================================================

describe("Section 3: MineRig Multi-Slot Token Flow Conservation", function () {
  let owner, protocol, team, user0, user1, user2, user3;
  let weth, usdc, registry, core, entropy;
  let rigAddress, rigContract, auctionAddress, unitAddress, unitContract;

  before("Deploy fresh contracts with capacity 4", async function () {
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

    const UnitFactory = await ethers.getContractFactory("UnitFactory");
    const unitFactory = await UnitFactory.deploy();
    const MineRigFactory = await ethers.getContractFactory("MineRigFactory");
    const rigFactory = await MineRigFactory.deploy();
    const AuctionFactory = await ethers.getContractFactory("AuctionFactory");
    const auctionFactory = await AuctionFactory.deploy();

    const Registry = await ethers.getContractFactory("Registry");
    registry = await Registry.deploy();

    const MineCore = await ethers.getContractFactory("MineCore");
    core = await MineCore.deploy(
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

    await registry.setFactoryApproval(core.address, true);

    await usdc.mint(user0.address, convert("5000", 6));
    await weth.connect(user0).deposit({ value: convert("500", 18) });
    await weth.connect(user1).deposit({ value: convert("500", 18) });
    await weth.connect(user2).deposit({ value: convert("500", 18) });
    await weth.connect(user3).deposit({ value: convert("500", 18) });

    const launchParams = {
      launcher: user0.address,
      quoteToken: weth.address,
      tokenName: "Deep Invariant Test",
      tokenSymbol: "DINV",
      uri: "https://test.com",
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

    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);
    const tx = await core.connect(user0).launch(launchParams);
    const receipt = await tx.wait();

    const launchEvent = receipt.events.find((e) => e.event === "MineCore__Launched");
    rigAddress = launchEvent.args.rig;
    unitAddress = launchEvent.args.unit;
    auctionAddress = launchEvent.args.auction;

    rigContract = await ethers.getContractAt("MineRig", rigAddress);
    unitContract = await ethers.getContractAt("Unit", unitAddress);

    await rigContract.connect(user0).setEntropyEnabled(false);
    await rigContract.connect(user0).setTeam(team.address);

    // Increase capacity to 4
    await rigContract.connect(user0).setCapacity(4);
  });

  describe("INV-DEEP-6: Sum of all slot.ups == globalUps after mining all slots", function () {
    it("Each slot gets exactly getUps() / capacity UPS after being mined", async function () {
      const globalUps = await rigContract.getUps();
      const capacity = await rigContract.capacity();
      const expectedSlotUps = globalUps.div(capacity);

      // Mine all 4 slots with different users
      const users = [user0, user1, user2, user3];
      for (let i = 0; i < 4; i++) {
        const slot = await rigContract.getSlot(i);
        await weth.connect(users[i]).approve(rigAddress, convert("10", 18));
        const deadline = await getFutureDeadline();
        await rigContract.connect(users[i]).mine(users[i].address, i, slot.epochId, deadline, convert("10", 18), "");
      }

      // Verify each slot has the correct UPS
      let sumOfSlotUps = ethers.BigNumber.from(0);
      for (let i = 0; i < 4; i++) {
        const slot = await rigContract.getSlot(i);
        expect(slot.ups).to.equal(expectedSlotUps);
        sumOfSlotUps = sumOfSlotUps.add(slot.ups);
      }

      // Sum of slot UPS should equal globalUps (or be within rounding of capacity division)
      // globalUps / capacity * capacity may lose remainder
      const expectedSum = expectedSlotUps.mul(capacity);
      expect(sumOfSlotUps).to.equal(expectedSum);
      // And the difference from globalUps should be at most (capacity - 1) due to integer division
      expect(globalUps.sub(sumOfSlotUps)).to.be.lt(capacity);
    });
  });

  describe("INV-DEEP-7: Mining all 4 slots, waiting, displacing: each user gets proportional tokens", function () {
    it("After 100s hold, each miner gets approximately (100 * getUps()/4) tokens on displacement", async function () {
      // All 4 slots were mined in previous test. Wait exactly 100 seconds.
      const waitTime = 100;
      await increaseTime(waitTime);

      const globalUps = await rigContract.getUps();
      const capacity = await rigContract.capacity();
      const slotUps = globalUps.div(capacity);

      // Record balances before displacement
      const users = [user0, user1, user2, user3];
      const balBefore = [];
      for (let i = 0; i < 4; i++) {
        balBefore.push(await unitContract.balanceOf(users[i].address));
      }

      // Displace all 4 slots using different users (circular displacement)
      // user1 displaces user0's slot 0, user2 displaces user1's slot 1, etc.
      const displacers = [user1, user2, user3, user0];
      for (let i = 0; i < 4; i++) {
        const slot = await rigContract.getSlot(i);
        const price = await rigContract.getPrice(i);
        await weth.connect(displacers[i]).approve(rigAddress, price.add(convert("10", 18)));
        const deadline = await getFutureDeadline();
        await rigContract.connect(displacers[i]).mine(
          displacers[i].address, i, slot.epochId, deadline, price.add(convert("10", 18)), ""
        );
      }

      // Check each user got approximately (waitTime * slotUps * upsMultiplier / PRECISION) tokens
      // upsMultiplier is 1e18 (1x) since we only have [1e18] in the array
      for (let i = 0; i < 4; i++) {
        const balAfter = await unitContract.balanceOf(users[i].address);
        const minted = balAfter.sub(balBefore[i]);

        // Expected: waitTime * slotUps * 1e18 / 1e18 = waitTime * slotUps
        // Allow 10% tolerance for block timestamp variance across 4 sequential txs
        const expectedMin = ethers.BigNumber.from(waitTime).mul(slotUps).mul(90).div(100);
        const expectedMax = ethers.BigNumber.from(waitTime + 10).mul(slotUps).mul(110).div(100);

        expect(minted).to.be.gte(expectedMin);
        expect(minted).to.be.lte(expectedMax);
      }
    });
  });

  describe("INV-DEEP-8: Quote token balance of rig == sum of accountToClaimable for all interacting accounts", function () {
    it("Rig WETH balance should exactly equal sum of all unclaimed claimable balances", async function () {
      const rigWethBalance = await weth.balanceOf(rigAddress);

      // Check all accounts that have ever interacted
      const accounts = [user0.address, user1.address, user2.address, user3.address, owner.address, protocol.address, team.address];
      let totalClaimable = ethers.BigNumber.from(0);

      for (const account of accounts) {
        const claimable = await rigContract.accountToClaimable(account);
        totalClaimable = totalClaimable.add(claimable);
      }

      // The rig's WETH balance should exactly equal the sum of all claimable balances
      expect(rigWethBalance).to.equal(totalClaimable);
    });
  });
});

// ============================================================================
// SECTION 4: MineRig Quote Token Conservation
// ============================================================================

describe("Section 4: MineRig Quote Token Conservation", function () {
  let owner, protocol, team, user0, user1, user2, user3;
  let weth, usdc, registry, core, entropy;
  let rigAddress, rigContract, auctionAddress, unitAddress, unitContract;

  before("Deploy fresh contracts", async function () {
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

    const UnitFactory = await ethers.getContractFactory("UnitFactory");
    const unitFactory = await UnitFactory.deploy();
    const MineRigFactory = await ethers.getContractFactory("MineRigFactory");
    const rigFactory = await MineRigFactory.deploy();
    const AuctionFactory = await ethers.getContractFactory("AuctionFactory");
    const auctionFactory = await AuctionFactory.deploy();

    const Registry = await ethers.getContractFactory("Registry");
    registry = await Registry.deploy();

    const MineCore = await ethers.getContractFactory("MineCore");
    core = await MineCore.deploy(
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

    await registry.setFactoryApproval(core.address, true);

    await usdc.mint(user0.address, convert("5000", 6));
    await weth.connect(user0).deposit({ value: convert("500", 18) });
    await weth.connect(user1).deposit({ value: convert("500", 18) });
    await weth.connect(user2).deposit({ value: convert("500", 18) });
    await weth.connect(user3).deposit({ value: convert("500", 18) });

    const launchParams = {
      launcher: user0.address,
      quoteToken: weth.address,
      tokenName: "Deep Invariant Test",
      tokenSymbol: "DINV",
      uri: "https://test.com",
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

    await usdc.connect(user0).approve(core.address, launchParams.usdcAmount);
    const tx = await core.connect(user0).launch(launchParams);
    const receipt = await tx.wait();

    const launchEvent = receipt.events.find((e) => e.event === "MineCore__Launched");
    rigAddress = launchEvent.args.rig;
    unitAddress = launchEvent.args.unit;
    auctionAddress = launchEvent.args.auction;

    rigContract = await ethers.getContractAt("MineRig", rigAddress);
    unitContract = await ethers.getContractAt("Unit", unitAddress);

    await rigContract.connect(user0).setEntropyEnabled(false);
    await rigContract.connect(user0).setTeam(team.address);
  });

  describe("INV-DEEP-9: Quote tokens transferred == miner_fee + treasury_fee + team_fee + protocol_fee", function () {
    it("For each mine with price > 0, total fees exactly equal the price paid by the miner", async function () {
      // Mine to establish a miner
      let slot = await rigContract.getSlot(0);
      await weth.connect(user1).approve(rigAddress, convert("10", 18));
      let deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, 0, slot.epochId, deadline, convert("10", 18), "");

      // Now displace at non-zero price to test fee conservation
      slot = await rigContract.getSlot(0);
      const price = await rigContract.getPrice(0);

      if (price.eq(0)) {
        this.skip();
        return;
      }

      // Record everything before
      const minerBalBefore = await weth.balanceOf(user2.address);
      const prevMinerClaimableBefore = await rigContract.accountToClaimable(user1.address);
      const treasuryBefore = await weth.balanceOf(auctionAddress);
      const protocolBefore = await weth.balanceOf(protocol.address);
      const teamBefore = await weth.balanceOf(team.address);
      const rigBalBefore = await weth.balanceOf(rigAddress);

      // Mine
      await weth.connect(user2).approve(rigAddress, price.add(convert("10", 18)));
      deadline = await getFutureDeadline();
      const tx = await rigContract.connect(user2).mine(user2.address, 0, slot.epochId, deadline, price.add(convert("10", 18)), "");
      const receipt = await tx.wait();

      const mineEvent = receipt.events.find(e => e.event === "MineRig__Mine");
      const actualPrice = mineEvent.args.price;

      // Record everything after
      const minerBalAfter = await weth.balanceOf(user2.address);
      const prevMinerClaimableAfter = await rigContract.accountToClaimable(user1.address);
      const treasuryAfter = await weth.balanceOf(auctionAddress);
      const protocolAfter = await weth.balanceOf(protocol.address);
      const teamAfter = await weth.balanceOf(team.address);
      const rigBalAfter = await weth.balanceOf(rigAddress);

      // Miner spent exactly actualPrice
      const amountSpent = minerBalBefore.sub(minerBalAfter);
      expect(amountSpent).to.equal(actualPrice);

      // Fee breakdown
      const minerFee = prevMinerClaimableAfter.sub(prevMinerClaimableBefore);
      const treasuryFee = treasuryAfter.sub(treasuryBefore);
      const protocolFee = protocolAfter.sub(protocolBefore);
      const teamFee = teamAfter.sub(teamBefore);

      // Conservation: all fees sum to the price paid
      const totalFees = minerFee.add(treasuryFee).add(protocolFee).add(teamFee);
      expect(totalFees).to.be.closeTo(actualPrice, 1);

      // Rig balance increased by exactly the miner fee (held for claimable)
      const rigBalChange = rigBalAfter.sub(rigBalBefore);
      expect(rigBalChange).to.equal(minerFee);
    });

    it("Conservation holds across a sequence of 5 mine operations", async function () {
      let totalPricesPaid = ethers.BigNumber.from(0);
      let totalMinerFees = ethers.BigNumber.from(0);
      let totalTreasuryFees = ethers.BigNumber.from(0);
      let totalProtocolFees = ethers.BigNumber.from(0);
      let totalTeamFees = ethers.BigNumber.from(0);

      const users = [user1, user2, user3, user1, user2];

      for (let i = 0; i < users.length; i++) {
        const slot = await rigContract.getSlot(0);
        const price = await rigContract.getPrice(0);
        const prevMiner = slot.miner;

        if (price.gt(0)) {
          const claimableBefore = await rigContract.accountToClaimable(prevMiner);
          const treasuryBefore = await weth.balanceOf(auctionAddress);
          const protocolBefore = await weth.balanceOf(protocol.address);
          const teamBefore = await weth.balanceOf(team.address);

          await weth.connect(users[i]).approve(rigAddress, price.add(convert("10", 18)));
          const deadline = await getFutureDeadline();
          const tx = await rigContract.connect(users[i]).mine(
            users[i].address, 0, slot.epochId, deadline, price.add(convert("10", 18)), ""
          );
          const receipt = await tx.wait();
          const mineEvent = receipt.events.find(e => e.event === "MineRig__Mine");
          const actualPrice = mineEvent.args.price;

          const claimableAfter = await rigContract.accountToClaimable(prevMiner);
          const treasuryAfter = await weth.balanceOf(auctionAddress);
          const protocolAfter = await weth.balanceOf(protocol.address);
          const teamAfter = await weth.balanceOf(team.address);

          totalPricesPaid = totalPricesPaid.add(actualPrice);
          totalMinerFees = totalMinerFees.add(claimableAfter.sub(claimableBefore));
          totalTreasuryFees = totalTreasuryFees.add(treasuryAfter.sub(treasuryBefore));
          totalProtocolFees = totalProtocolFees.add(protocolAfter.sub(protocolBefore));
          totalTeamFees = totalTeamFees.add(teamAfter.sub(teamBefore));
        } else {
          await weth.connect(users[i]).approve(rigAddress, convert("10", 18));
          const deadline = await getFutureDeadline();
          await rigContract.connect(users[i]).mine(
            users[i].address, 0, slot.epochId, deadline, convert("10", 18), ""
          );
        }

        // Small wait between mines for price variation
        await increaseTime(30);
      }

      // Total fees should equal total prices paid
      const totalFees = totalMinerFees.add(totalTreasuryFees).add(totalProtocolFees).add(totalTeamFees);
      expect(totalFees).to.be.closeTo(totalPricesPaid, 5); // Allow up to 5 wei rounding over 5 operations
    });
  });

  describe("INV-DEEP-10: After mines and claims, rig balance == sum of unclaimed balances", function () {
    it("After a sequence of mines and partial claims, the rig WETH balance matches unclaimed amounts", async function () {
      // Perform several more mine operations to build up claimable balances
      const users = [user1, user2, user3];
      for (let i = 0; i < 3; i++) {
        await increaseTime(60);
        const slot = await rigContract.getSlot(0);
        const price = await rigContract.getPrice(0);
        await weth.connect(users[i]).approve(rigAddress, price.add(convert("10", 18)));
        const deadline = await getFutureDeadline();
        await rigContract.connect(users[i]).mine(
          users[i].address, 0, slot.epochId, deadline, price.add(convert("10", 18)), ""
        );
      }

      // Claim for user1 (if they have anything)
      const user1Claimable = await rigContract.accountToClaimable(user1.address);
      if (user1Claimable.gt(0)) {
        await rigContract.claim(user1.address);
      }

      // Now verify: rig balance == sum of remaining claimable
      const rigBalance = await weth.balanceOf(rigAddress);

      const allAccounts = [user0.address, user1.address, user2.address, user3.address, owner.address, protocol.address, team.address];
      let totalUnclaimed = ethers.BigNumber.from(0);
      for (const account of allAccounts) {
        totalUnclaimed = totalUnclaimed.add(await rigContract.accountToClaimable(account));
      }

      expect(rigBalance).to.equal(totalUnclaimed);

      // Claim for user2 as well and re-verify
      const user2Claimable = await rigContract.accountToClaimable(user2.address);
      if (user2Claimable.gt(0)) {
        await rigContract.claim(user2.address);
      }

      const rigBalanceAfter = await weth.balanceOf(rigAddress);
      let totalUnclaimedAfter = ethers.BigNumber.from(0);
      for (const account of allAccounts) {
        totalUnclaimedAfter = totalUnclaimedAfter.add(await rigContract.accountToClaimable(account));
      }

      expect(rigBalanceAfter).to.equal(totalUnclaimedAfter);
    });
  });
});

// ============================================================================
// SECTION 5: SpinRig Prize Pool Accounting
// ============================================================================

describe("Section 5: SpinRig Prize Pool Accounting", function () {
  let owner, treasury, team, protocol, user0, user1, user2;
  let paymentToken, unitToken, rig, mockEntropy, mockCore;

  before("Deploy fresh contracts for SpinRig tests", async function () {
    await network.provider.send("hardhat_reset");

    [owner, treasury, team, protocol, user0, user1, user2] = await ethers.getSigners();

    // Deploy mock USDC (6 decimals)
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    paymentToken = await MockUSDC.deploy();

    // Deploy mock Entropy
    const MockEntropy = await ethers.getContractFactory("MockEntropy");
    mockEntropy = await MockEntropy.deploy();

    // Deploy mock Core (for protocolFeeAddress)
    const MockCore = await ethers.getContractFactory("MockCore");
    mockCore = await MockCore.deploy(protocol.address);

    // Deploy Unit token (owner is initial rig, will transfer to SpinRig)
    const Unit = await ethers.getContractFactory("Unit");
    unitToken = await Unit.deploy("Spin Deep Test", "SDEEP", owner.address);

    // Deploy SpinRig with multiple odds for richer testing
    const SpinRig = await ethers.getContractFactory("SpinRig");
    const config = {
      epochPeriod: ONE_HOUR,
      priceMultiplier: convert("2", 18),
      minInitPrice: convert("1", 6), // 1 USDC
      initialUps: convert("100", 18), // High for testing -- 100 tokens/sec
      halvingPeriod: THIRTY_DAYS,
      tailUps: convert("1", 18),
      odds: [1000, 2000, 5000], // 10%, 20%, 50%
    };

    rig = await SpinRig.deploy(
      unitToken.address,
      paymentToken.address,
      mockCore.address,
      treasury.address,
      AddressZero, // team (set later via setTeam)
      mockEntropy.address,
      config
    );

    // Grant minting rights
    await unitToken.setRig(rig.address);

    // Set team
    await rig.connect(owner).setTeam(team.address);

    // Fund users with USDC
    await paymentToken.mint(user0.address, convert("100000", 6));
    await paymentToken.mint(user1.address, convert("100000", 6));
    await paymentToken.mint(user2.address, convert("100000", 6));
  });

  describe("INV-DEEP-11: getPrizePool() == Unit.balanceOf(rig.address) always holds", function () {
    it("Invariant holds before any spin", async function () {
      const prizePool = await rig.getPrizePool();
      const actualBalance = await unitToken.balanceOf(rig.address);
      expect(prizePool).to.equal(actualBalance);
    });

    it("Invariant holds immediately after a spin (before VRF callback)", async function () {
      // Wait for emissions to accumulate
      await increaseTime(ONE_HOUR);

      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));
      await rig.connect(user0).spin(
        user0.address,
        epochId,
        await getFutureDeadline(),
        convert("1000", 6),
        "",
        { value: fee }
      );

      // After spin but before callback, prize pool should equal balance
      const prizePool = await rig.getPrizePool();
      const actualBalance = await unitToken.balanceOf(rig.address);
      expect(prizePool).to.equal(actualBalance);
    });

    it("Invariant holds after VRF callback resolves", async function () {
      // Do another spin to get a sequence number
      await increaseTime(ONE_HOUR);

      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user1).approve(rig.address, convert("1000", 6));
      const tx = await rig.connect(user1).spin(
        user1.address,
        epochId,
        await getFutureDeadline(),
        convert("1000", 6),
        "",
        { value: fee }
      );
      const receipt = await tx.wait();
      const entropyEvent = receipt.events.find(e => e.event === "SpinRig__EntropyRequested");
      const sequenceNumber = entropyEvent.args.sequenceNumber;

      // Fulfill entropy
      const randomNumber = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("inv_deep_11"));
      await mockEntropy.fulfillEntropy(sequenceNumber, randomNumber);

      // After callback, prize pool should still equal balance
      const prizePool = await rig.getPrizePool();
      const actualBalance = await unitToken.balanceOf(rig.address);
      expect(prizePool).to.equal(actualBalance);
    });
  });

  describe("INV-DEEP-12: After spin (before callback), prize pool increased by minted emissions", function () {
    it("Prize pool increases by exactly the pending emissions when spin mints them", async function () {
      // Wait for emissions to accumulate
      await increaseTime(ONE_HOUR * 2);

      const poolBefore = await rig.getPrizePool();
      const pendingEmissions = await rig.getPendingEmissions();

      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));
      const tx = await rig.connect(user0).spin(
        user0.address,
        epochId,
        await getFutureDeadline(),
        convert("1000", 6),
        "",
        { value: fee }
      );

      const receipt = await tx.wait();
      const emissionEvent = receipt.events.find(e => e.event === "SpinRig__EmissionMinted");

      const poolAfter = await rig.getPrizePool();
      const poolIncrease = poolAfter.sub(poolBefore);

      // Prize pool should have increased by the emission amount
      if (emissionEvent) {
        const emissionAmount = emissionEvent.args.amount;
        expect(poolIncrease).to.equal(emissionAmount);
      }

      // The increase should be approximately equal to pendingEmissions
      // (there may be small differences due to the block mining changing the exact time)
      expect(poolIncrease).to.be.closeTo(pendingEmissions, pendingEmissions.div(10).add(1));
    });
  });

  describe("INV-DEEP-13: After callback, prize pool decreased by exactly pool * oddsBps / DIVISOR", function () {
    it("The win amount matches pool * oddsBps / 10000 from the callback", async function () {
      // Accumulate emissions
      await increaseTime(ONE_HOUR * 3);

      const epochId = await rig.epochId();
      const fee = await rig.getEntropyFee();

      await paymentToken.connect(user2).approve(rig.address, convert("1000", 6));
      const tx = await rig.connect(user2).spin(
        user2.address,
        epochId,
        await getFutureDeadline(),
        convert("1000", 6),
        "",
        { value: fee }
      );
      const receipt = await tx.wait();
      const entropyEvent = receipt.events.find(e => e.event === "SpinRig__EntropyRequested");
      const sequenceNumber = entropyEvent.args.sequenceNumber;

      // Record pool before callback (after spin emission mint)
      const poolBeforeCallback = await rig.getPrizePool();
      const user2BalBefore = await unitToken.balanceOf(user2.address);

      // Fulfill entropy
      const randomNumber = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("deep_13_test"));
      await mockEntropy.fulfillEntropy(sequenceNumber, randomNumber);

      const poolAfterCallback = await rig.getPrizePool();
      const user2BalAfter = await unitToken.balanceOf(user2.address);

      // Get the Win event to find oddsBps
      const winEvents = await rig.queryFilter(rig.filters.SpinRig__Win());
      const latestWin = winEvents[winEvents.length - 1];
      const oddsBps = latestWin.args.oddsBps;
      const winAmount = latestWin.args.amount;

      // The expected win amount = poolBeforeCallback * oddsBps / 10000
      const expectedWin = poolBeforeCallback.mul(oddsBps).div(10000);
      expect(winAmount).to.equal(expectedWin);

      // Prize pool should have decreased by exactly winAmount
      const poolDecrease = poolBeforeCallback.sub(poolAfterCallback);
      expect(poolDecrease).to.equal(winAmount);

      // User received exactly winAmount tokens
      const userGained = user2BalAfter.sub(user2BalBefore);
      expect(userGained).to.equal(winAmount);
    });

    it("Win amount is strictly <= MAX_ODDS_BPS (80%) of the prize pool", async function () {
      // Test with many different random seeds
      const seeds = ["seed_a", "seed_b", "seed_c", "seed_d", "seed_e"];

      for (const seed of seeds) {
        await increaseTime(ONE_HOUR + 1);

        const epochId = await rig.epochId();
        const fee = await rig.getEntropyFee();

        await paymentToken.connect(user0).approve(rig.address, convert("1000", 6));
        const tx = await rig.connect(user0).spin(
          user0.address,
          epochId,
          await getFutureDeadline(),
          convert("1000", 6),
          "",
          { value: fee }
        );
        const receipt = await tx.wait();
        const entropyEvent = receipt.events.find(e => e.event === "SpinRig__EntropyRequested");
        const sequenceNumber = entropyEvent.args.sequenceNumber;

        const poolBeforeCallback = await rig.getPrizePool();

        const randomNumber = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(seed));
        await mockEntropy.fulfillEntropy(sequenceNumber, randomNumber);

        const winEvents = await rig.queryFilter(rig.filters.SpinRig__Win());
        const latestWin = winEvents[winEvents.length - 1];
        const winAmount = latestWin.args.amount;

        // Win should never exceed 80% of the pool
        const maxPayout = poolBeforeCallback.mul(8000).div(10000);
        expect(winAmount).to.be.lte(maxPayout);
      }
    });
  });

  describe("INV-DEEP-14: Multiple spins without callbacks queue up, callbacks resolve correctly", function () {
    it("Multiple spins mint emissions each time, and VRF requests resolve in order", async function () {
      // Wait for a big emission build-up
      await increaseTime(ONE_HOUR * 5);

      // Perform 3 spins in quick succession, collecting sequence numbers
      const sequenceNumbers = [];
      const poolSnapshots = [];

      for (let i = 0; i < 3; i++) {
        const epochId = await rig.epochId();
        const fee = await rig.getEntropyFee();
        const poolBefore = await rig.getPrizePool();

        const user = [user0, user1, user2][i];
        await paymentToken.connect(user).approve(rig.address, convert("1000", 6));
        const tx = await rig.connect(user).spin(
          user.address,
          epochId,
          await getFutureDeadline(),
          convert("1000", 6),
          "",
          { value: fee }
        );
        const receipt = await tx.wait();
        const entropyEvent = receipt.events.find(e => e.event === "SpinRig__EntropyRequested");
        sequenceNumbers.push(entropyEvent.args.sequenceNumber);

        const poolAfter = await rig.getPrizePool();
        poolSnapshots.push(poolAfter);

        // Each spin should have minted emissions (pool grew or stayed same)
        expect(poolAfter).to.be.gte(poolBefore);
      }

      // Now fulfill callbacks in order
      const users = [user0, user1, user2];

      for (let i = 0; i < 3; i++) {
        const poolBeforeCallback = await rig.getPrizePool();
        const userBalBefore = await unitToken.balanceOf(users[i].address);

        const randomNumber = ethers.utils.keccak256(
          ethers.utils.toUtf8Bytes("multi_spin_" + i)
        );
        await mockEntropy.fulfillEntropy(sequenceNumbers[i], randomNumber);

        const poolAfterCallback = await rig.getPrizePool();
        const userBalAfter = await unitToken.balanceOf(users[i].address);

        // Get the win event
        const winEvents = await rig.queryFilter(rig.filters.SpinRig__Win());
        const latestWin = winEvents[winEvents.length - 1];
        const oddsBps = latestWin.args.oddsBps;
        const winAmount = latestWin.args.amount;

        // Win amount should match the pool at callback time * oddsBps / 10000
        const expectedWin = poolBeforeCallback.mul(oddsBps).div(10000);
        expect(winAmount).to.equal(expectedWin);

        // Pool decreased by winAmount
        expect(poolBeforeCallback.sub(poolAfterCallback)).to.equal(winAmount);

        // User received the tokens
        expect(userBalAfter.sub(userBalBefore)).to.equal(winAmount);

        // Prize pool invariant still holds
        const prizePool = await rig.getPrizePool();
        const actualBalance = await unitToken.balanceOf(rig.address);
        expect(prizePool).to.equal(actualBalance);
      }
    });

    it("Fulfilling callbacks out of order still resolves correctly", async function () {
      // Wait for more emissions
      await increaseTime(ONE_HOUR * 2);

      const sequenceNumbers = [];

      // Spin twice
      for (let i = 0; i < 2; i++) {
        const epochId = await rig.epochId();
        const fee = await rig.getEntropyFee();

        const user = [user0, user1][i];
        await paymentToken.connect(user).approve(rig.address, convert("1000", 6));
        const tx = await rig.connect(user).spin(
          user.address,
          epochId,
          await getFutureDeadline(),
          convert("1000", 6),
          "",
          { value: fee }
        );
        const receipt = await tx.wait();
        const entropyEvent = receipt.events.find(e => e.event === "SpinRig__EntropyRequested");
        sequenceNumbers.push(entropyEvent.args.sequenceNumber);
      }

      // Fulfill the SECOND callback first (out of order)
      const poolBeforeSecond = await rig.getPrizePool();
      const user1BalBefore = await unitToken.balanceOf(user1.address);

      const randomSecond = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ooo_second"));
      await mockEntropy.fulfillEntropy(sequenceNumbers[1], randomSecond);

      const poolAfterSecond = await rig.getPrizePool();
      const user1BalAfter = await unitToken.balanceOf(user1.address);

      // Verify the second callback resolved correctly
      const winEvents1 = await rig.queryFilter(rig.filters.SpinRig__Win());
      const latestWin1 = winEvents1[winEvents1.length - 1];
      const expectedWin1 = poolBeforeSecond.mul(latestWin1.args.oddsBps).div(10000);
      expect(latestWin1.args.amount).to.equal(expectedWin1);
      expect(user1BalAfter.sub(user1BalBefore)).to.equal(latestWin1.args.amount);

      // Now fulfill the FIRST callback
      const poolBeforeFirst = await rig.getPrizePool();
      const user0BalBefore = await unitToken.balanceOf(user0.address);

      const randomFirst = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ooo_first"));
      await mockEntropy.fulfillEntropy(sequenceNumbers[0], randomFirst);

      const poolAfterFirst = await rig.getPrizePool();
      const user0BalAfter = await unitToken.balanceOf(user0.address);

      // Verify the first callback resolved correctly
      const winEvents2 = await rig.queryFilter(rig.filters.SpinRig__Win());
      const latestWin2 = winEvents2[winEvents2.length - 1];
      const expectedWin2 = poolBeforeFirst.mul(latestWin2.args.oddsBps).div(10000);
      expect(latestWin2.args.amount).to.equal(expectedWin2);
      expect(user0BalAfter.sub(user0BalBefore)).to.equal(latestWin2.args.amount);

      // Final invariant check: getPrizePool == balanceOf
      const finalPool = await rig.getPrizePool();
      const finalBalance = await unitToken.balanceOf(rig.address);
      expect(finalPool).to.equal(finalBalance);
    });
  });
});
