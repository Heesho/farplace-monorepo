const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const convert = (amount, decimals = 18) => ethers.utils.parseUnits(amount.toString(), decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;

const AddressZero = "0x0000000000000000000000000000000000000000";

describe("Multicall-Only Tests (Frontend Simulation)", function () {
    let weth, usdc, registry, core, multicall;
    let rigFactory, auctionFactory, unitFactory;
    let uniswapFactory, uniswapRouter;
    let owner, protocol, team, user0, user1, user2, user3;

    async function getFutureDeadline() {
        const block = await ethers.provider.getBlock("latest");
        return block.timestamp + 86400 * 365;
    }

    async function increaseTime(seconds) {
        await network.provider.send("evm_increaseTime", [seconds]);
        await network.provider.send("evm_mine");
    }

    // Helper to parse MineCore__Launched event from Multicall transaction
    async function parseLaunchEvent(receipt) {
        const coreInterface = core.interface;
        for (const log of receipt.logs) {
            try {
                const parsed = coreInterface.parseLog(log);
                if (parsed.name === "MineCore__Launched") {
                    return parsed;
                }
            } catch (e) {
                // Not a Core event, skip
            }
        }
        return null;
    }

    before(async function () {
        await network.provider.send("hardhat_reset");

        [owner, protocol, team, user0, user1, user2, user3] = await ethers.getSigners();

        // Deploy base tokens
        const MockWETH = await ethers.getContractFactory("MockWETH");
        weth = await MockWETH.deploy();
        const MockUSDC = await ethers.getContractFactory("MockUSDC");
        usdc = await MockUSDC.deploy();

        // Deploy Uniswap mocks
        const MockFactory = await ethers.getContractFactory("MockUniswapV2Factory");
        uniswapFactory = await MockFactory.deploy();

        const MockRouter = await ethers.getContractFactory("MockUniswapV2Router");
        uniswapRouter = await MockRouter.deploy(uniswapFactory.address);

        // Deploy factories
        const MineRigFactory = await ethers.getContractFactory("MineRigFactory");
        rigFactory = await MineRigFactory.deploy();

        const AuctionFactory = await ethers.getContractFactory("AuctionFactory");
        auctionFactory = await AuctionFactory.deploy();

        const UnitFactory = await ethers.getContractFactory("UnitFactory");
        unitFactory = await UnitFactory.deploy();

        // Deploy mock Entropy
        const Entropy = await ethers.getContractFactory("MockEntropy");
        const entropy = await Entropy.deploy();

        // Deploy Registry
        const Registry = await ethers.getContractFactory("Registry");
        registry = await Registry.deploy();

        // Deploy Core
        const Core = await ethers.getContractFactory("MineCore");
        core = await Core.deploy(
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

        // Approve MineCore as factory in Registry
        await registry.setFactoryApproval(core.address, true);

        // Deploy Multicall
        const Multicall = await ethers.getContractFactory("MineMulticall");
        multicall = await Multicall.deploy(core.address, usdc.address);

        // Give users USDC tokens (more for multiple launches)
        for (const user of [user0, user1, user2, user3]) {
            await usdc.mint(user.address, convert("5000", 6));
        }

        // Give users WETH/USDC for mining
        for (const user of [user0, user1, user2, user3]) {
            await weth.connect(user).deposit({ value: convert("100", 18) });
        }
    });

    // ============================================================
    // LAUNCHING RIGS VIA MULTICALL
    // ============================================================
    describe("Launch via Multicall", function () {
        it("Can launch a rig through Multicall", async function () {
            const launchParams = {
                launcher: AddressZero, // Will be overwritten by Multicall
                quoteToken: weth.address,
                tokenName: "Multicall Unit",
                tokenSymbol: "MUNIT",
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

            // Approve USDC to Multicall
            await usdc.connect(user0).approve(multicall.address, launchParams.usdcAmount);

            // Launch via Multicall
            const tx = await multicall.connect(user0).launch(launchParams);
            const receipt = await tx.wait();

            // Get addresses from Core event (emitted by Core, not Multicall)
            const launchEvent = await parseLaunchEvent(receipt);
            expect(launchEvent).to.not.be.null;

            const rigAddr = launchEvent.args.rig;
            const unitAddr = launchEvent.args.unit;
            const auctionAddr = launchEvent.args.auction;

            // Verify rig ownership is user0 (not Multicall)
            const rig = await ethers.getContractAt("MineRig", rigAddr);
            expect(await rig.owner()).to.equal(user0.address);

            // Verify registry
            expect(await core.rigToIsRig(rigAddr)).to.be.true;
        });

        it("Launcher param is overwritten with msg.sender", async function () {
            const launchParams = {
                launcher: user3.address, // Try to set someone else as launcher
                quoteToken: weth.address,
                tokenName: "Override Test",
                tokenSymbol: "OVRD",
                uri: "https://example.com/rig",
                usdcAmount: convert("200", 6),
                unitAmount: convert("1000000", 18),
                initialUps: convert("1", 18),
                tailUps: convert("0.01", 18),
                halvingAmount: convert("10000000", 18),
                rigEpochPeriod: 3600,
                rigPriceMultiplier: convert("1.5", 18),
                rigMinInitPrice: convert("0.0001", 18),
                upsMultipliers: [convert("1", 18)],
                upsMultiplierDuration: 86400,
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 86400,
                auctionPriceMultiplier: convert("1.1", 18),
                auctionMinInitPrice: convert("0.001", 18),
            };

            await usdc.connect(user1).approve(multicall.address, launchParams.usdcAmount);
            const tx = await multicall.connect(user1).launch(launchParams);
            const receipt = await tx.wait();

            const launchEvent = await parseLaunchEvent(receipt);
            const rig = await ethers.getContractAt("MineRig", launchEvent.args.rig);

            // Owner should be user1 (caller), not user3 (param)
            expect(await rig.owner()).to.equal(user1.address);
        });

        it("Reverts if USDC not approved", async function () {
            const launchParams = {
                launcher: AddressZero,
                quoteToken: weth.address,
                tokenName: "No Approve",
                tokenSymbol: "NOAP",
                uri: "https://example.com/rig",
                usdcAmount: convert("200", 6),
                unitAmount: convert("1000000", 18),
                initialUps: convert("1", 18),
                tailUps: convert("0.01", 18),
                halvingAmount: convert("10000000", 18),
                rigEpochPeriod: 3600,
                rigPriceMultiplier: convert("1.5", 18),
                rigMinInitPrice: convert("0.0001", 18),
                upsMultipliers: [convert("1", 18)],
                upsMultiplierDuration: 86400,
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 86400,
                auctionPriceMultiplier: convert("1.1", 18),
                auctionMinInitPrice: convert("0.001", 18),
            };

            // Don't approve
            await expect(
                multicall.connect(user2).launch(launchParams)
            ).to.be.reverted;
        });

        it("Reverts with insufficient USDC balance", async function () {
            const launchParams = {
                launcher: AddressZero,
                quoteToken: weth.address,
                tokenName: "No Balance",
                tokenSymbol: "NOBAL",
                uri: "https://example.com/rig",
                usdcAmount: convert("10000", 6), // More than user has
                initialUps: convert("1", 18),
                tailUps: convert("0.01", 18),
                halvingAmount: convert("10000000", 18),
                rigEpochPeriod: 3600,
                rigPriceMultiplier: convert("1.5", 18),
                rigMinInitPrice: convert("0.0001", 18),
                upsMultipliers: [convert("1", 18)],
                upsMultiplierDuration: 86400,
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 86400,
                auctionPriceMultiplier: convert("1.1", 18),
                auctionMinInitPrice: convert("0.001", 18),
            };

            await usdc.connect(user2).approve(multicall.address, launchParams.usdcAmount);
            await expect(
                multicall.connect(user2).launch(launchParams)
            ).to.be.reverted;
        });
    });

    // ============================================================
    // MINING VIA MULTICALL
    // ============================================================
    describe("Mine via Multicall", function () {
        let rig, unit, auction;

        before(async function () {
            // Launch a fresh rig for mining tests
            const launchParams = {
                launcher: AddressZero,
                quoteToken: weth.address,
                tokenName: "Mining Test Unit",
                tokenSymbol: "MTEST",
                uri: "https://example.com/rig",
                usdcAmount: convert("300", 6),
                unitAmount: convert("1000000", 18),
                initialUps: convert("10", 18),
                tailUps: convert("0.1", 18),
                halvingAmount: convert("10000000", 18),
                rigEpochPeriod: 3600,
                rigPriceMultiplier: convert("2", 18),
                rigMinInitPrice: convert("0.001", 18),
                upsMultipliers: [convert("1", 18)],
                upsMultiplierDuration: 86400,
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 86400,
                auctionPriceMultiplier: convert("1.2", 18),
                auctionMinInitPrice: convert("0.01", 18),
            };

            await usdc.connect(user0).approve(multicall.address, launchParams.usdcAmount);
            const tx = await multicall.connect(user0).launch(launchParams);
            const receipt = await tx.wait();

            const launchEvent = await parseLaunchEvent(receipt);
            rig = await ethers.getContractAt("MineRig", launchEvent.args.rig);
            unit = await ethers.getContractAt("Unit", launchEvent.args.unit);
            auction = await ethers.getContractAt("Auction", launchEvent.args.auction);

            // Disable entropy for tests that don't send ETH for VRF fees
            await rig.connect(user0).setEntropyEnabled(false);
        });

        it("Can mine with USDC via Multicall", async function () {
            const slot = await rig.getSlot(0);
            const epochId = slot.epochId;
            const price = await rig.getPrice(0);
            const deadline = await getFutureDeadline();

            // Approve USDC for multicall
            await weth.connect(user1).approve(multicall.address, price.mul(2));

            const tx = await multicall.connect(user1).mine(
                rig.address,
                0, // index
                epochId,
                deadline,
                price,
                "First mine via Multicall",
                { value: 0 } // No ETH needed unless multipliers enabled
            );

            const slotAfter = await rig.getSlot(0);
            expect(slotAfter.miner).to.equal(user1.address);
            expect(slotAfter.uri).to.equal("First mine via Multicall");
        });

        it("Reverts with excess ETH", async function () {
            const slot = await rig.getSlot(0);
            const epochId = slot.epochId;
            const price = await rig.getPrice(0);
            const deadline = await getFutureDeadline();

            const excessAmount = convert("1", 18);

            // Approve USDC
            await weth.connect(user2).approve(multicall.address, price.mul(2));

            // Should revert since no entropy is required
            await expect(
                multicall.connect(user2).mine(
                    rig.address,
                    0, // index
                    epochId,
                    deadline,
                    price,
                    "Excess ETH test",
                    { value: excessAmount }
                )
            ).to.be.revertedWith("Multicall__ExcessETH()");
        });

        it("Previous miner receives Unit tokens after next mine", async function () {
            // First, user2 must actually become the miner
            const slot0 = await rig.getSlot(0);
            const epochId0 = slot0.epochId;
            const price0 = await rig.getPrice(0);
            const deadline0 = await getFutureDeadline();

            await weth.connect(user2).approve(multicall.address, price0.mul(2));
            await multicall.connect(user2).mine(
                rig.address,
                0,
                epochId0,
                deadline0,
                price0,
                "User2 becomes miner",
                { value: 0 }
            );

            const unitBalanceBefore = await unit.balanceOf(user2.address);

            // Wait some time
            await increaseTime(1800);

            // user3 mines
            const slot = await rig.getSlot(0);
            const epochId = slot.epochId;
            const price = await rig.getPrice(0);
            const deadline = await getFutureDeadline();

            // Approve USDC
            await weth.connect(user3).approve(multicall.address, price.mul(2));

            await multicall.connect(user3).mine(
                rig.address,
                0, // index
                epochId,
                deadline,
                price,
                "Trigger token mint",
                { value: 0 }
            );

            const unitBalanceAfter = await unit.balanceOf(user2.address);
            expect(unitBalanceAfter).to.be.gt(unitBalanceBefore);
        });

        it("Can mine at zero price with zero ETH", async function () {
            // Wait for price to decay to zero
            await increaseTime(3700);

            const slot = await rig.getSlot(0);
            const epochId = slot.epochId;
            const price = await rig.getPrice(0);
            expect(price).to.equal(0);

            const deadline = await getFutureDeadline();

            await multicall.connect(user1).mine(
                rig.address,
                0, // index
                epochId,
                deadline,
                0,
                "Free mine",
                { value: 0 }
            );

            const slotAfter = await rig.getSlot(0);
            expect(slotAfter.miner).to.equal(user1.address);
        });

        it("Reverts with wrong epochId", async function () {
            const wrongEpochId = 999;
            const price = await rig.getPrice(0);
            const deadline = await getFutureDeadline();

            await weth.connect(user2).approve(multicall.address, price.mul(2));

            await expect(
                multicall.connect(user2).mine(
                    rig.address,
                    0, // index
                    wrongEpochId,
                    deadline,
                    price,
                    "Wrong epoch",
                    { value: 0 }
                )
            ).to.be.revertedWith("Rig__EpochIdMismatch()");
        });

        it("Reverts with expired deadline", async function () {
            const slot = await rig.getSlot(0);
            const epochId = slot.epochId;
            const price = await rig.getPrice(0);
            const block = await ethers.provider.getBlock("latest");
            const pastDeadline = block.timestamp - 1;

            await weth.connect(user2).approve(multicall.address, price.mul(2));

            await expect(
                multicall.connect(user2).mine(
                    rig.address,
                    0, // index
                    epochId,
                    pastDeadline,
                    price,
                    "Expired",
                    { value: 0 }
                )
            ).to.be.revertedWith("Rig__DeadlinePassed()");
        });

        it("Reverts with insufficient maxPrice", async function () {
            // Mine to set up new epoch with higher price
            const slot = await rig.getSlot(0);
            const epochId = slot.epochId;
            const price = await rig.getPrice(0);
            const deadline = await getFutureDeadline();

            await weth.connect(user1).approve(multicall.address, price.mul(2));

            await multicall.connect(user1).mine(
                rig.address,
                0, // index
                epochId,
                deadline,
                price.add(convert("1", 6)),
                "Setup",
                { value: 0 }
            );

            // Now try with maxPrice = 0
            const newSlot = await rig.getSlot(0);
            const newEpochId = newSlot.epochId;
            const newPrice = await rig.getPrice(0);

            if (newPrice.gt(0)) {
                await weth.connect(user2).approve(multicall.address, newPrice.mul(2));

                await expect(
                    multicall.connect(user2).mine(
                        rig.address,
                        0, // index
                        newEpochId,
                        deadline,
                        0, // maxPrice = 0
                        "Should fail",
                        { value: 0 }
                    )
                ).to.be.revertedWith("Rig__MaxPriceExceeded()");
            }
        });
    });

    // ============================================================
    // READING STATE VIA MULTICALL
    // ============================================================
    describe("Read State via Multicall", function () {
        let rig, unit, auction, lpToken;

        before(async function () {
            // Launch a fresh rig
            const launchParams = {
                launcher: AddressZero,
                quoteToken: weth.address,
                tokenName: "State Test Unit",
                tokenSymbol: "STATE",
                uri: "https://example.com/rig",
                usdcAmount: convert("400", 6),
                unitAmount: convert("1000000", 18),
                initialUps: convert("5", 18),
                tailUps: convert("0.05", 18),
                halvingAmount: convert("10000000", 18),
                rigEpochPeriod: 1800,
                rigPriceMultiplier: convert("1.5", 18),
                rigMinInitPrice: convert("0.0005", 18),
                upsMultipliers: [convert("1", 18)],
                upsMultiplierDuration: 86400,
                auctionInitPrice: convert("2", 18),
                auctionEpochPeriod: 43200,
                auctionPriceMultiplier: convert("1.3", 18),
                auctionMinInitPrice: convert("0.005", 18),
            };

            await usdc.connect(user0).approve(multicall.address, launchParams.usdcAmount);
            const tx = await multicall.connect(user0).launch(launchParams);
            const receipt = await tx.wait();

            const launchEvent = await parseLaunchEvent(receipt);
            rig = await ethers.getContractAt("MineRig", launchEvent.args.rig);
            unit = await ethers.getContractAt("Unit", launchEvent.args.unit);
            auction = await ethers.getContractAt("Auction", launchEvent.args.auction);
            lpToken = await ethers.getContractAt("IERC20", launchEvent.args.lpToken);

            // Disable entropy for tests that don't send ETH for VRF fees
            await rig.connect(user0).setEntropyEnabled(false);
        });

        it("getRig returns correct initial state", async function () {
            const state = await multicall.getRig(rig.address, 0, user1.address);
            const slot = await rig.getSlot(0);

            expect(state.epochId).to.equal(slot.epochId);
            expect(state.initPrice).to.equal(slot.initPrice);
            expect(state.epochStartTime).to.equal(slot.startTime);
            expect(state.ups).to.equal(slot.ups);
            expect(state.miner).to.equal(slot.miner);
            expect(state.slotUri).to.equal(slot.uri);
        });

        it("getRig returns correct user balances", async function () {
            const state = await multicall.getRig(rig.address, 0, user1.address);

            expect(state.accountQuoteBalance).to.equal(await weth.balanceOf(user1.address));
            expect(state.accountUsdcBalance).to.equal(await usdc.balanceOf(user1.address));
            expect(state.accountUnitBalance).to.equal(await unit.balanceOf(user1.address));
        });

        it("getRig returns zero balances for zero address", async function () {
            const state = await multicall.getRig(rig.address, 0, AddressZero);

            expect(state.accountQuoteBalance).to.equal(0);
            expect(state.accountUsdcBalance).to.equal(0);
            expect(state.accountUnitBalance).to.equal(0);
            expect(state.accountClaimable).to.equal(0);
        });

        it("getRig price decays correctly", async function () {
            // Mine first to reset epoch and get fresh price
            const slot = await rig.getSlot(0);
            const epochId = slot.epochId;
            const price = await rig.getPrice(0);
            const deadline = await getFutureDeadline();

            await weth.connect(user1).approve(multicall.address, price.mul(2));
            await multicall.connect(user1).mine(
                rig.address,
                0,
                epochId,
                deadline,
                price.mul(2),
                "Reset epoch",
                { value: 0 }
            );

            const stateBefore = await multicall.getRig(rig.address, 0, user1.address);
            const priceBefore = stateBefore.price;

            await increaseTime(900); // Half epoch

            const stateAfter = await multicall.getRig(rig.address, 0, user1.address);
            const priceAfter = stateAfter.price;

            // Price should be approximately half
            expect(priceAfter).to.be.lt(priceBefore);
            expect(priceAfter).to.be.closeTo(priceBefore.div(2), priceBefore.div(10));
        });

        it("getRig glazed increases over time", async function () {
            // Mine first to set a miner
            const slot = await rig.getSlot(0);
            const epochId = slot.epochId;
            const price = await rig.getPrice(0);
            const deadline = await getFutureDeadline();

            await weth.connect(user1).approve(multicall.address, price.mul(2));

            await multicall.connect(user1).mine(
                rig.address,
                0, // index
                epochId,
                deadline,
                price.mul(2),
                "For glazed test",
                { value: 0 }
            );

            const stateBefore = await multicall.getRig(rig.address, 0, user1.address);

            await increaseTime(100);

            const stateAfter = await multicall.getRig(rig.address, 0, user1.address);

            expect(stateAfter.glazed).to.be.gt(stateBefore.glazed);
        });

        it("getRig nextUps unchanged without minting (amount-based halving)", async function () {
            const stateBefore = await multicall.getRig(rig.address, 0, user1.address);
            const upsBefore = stateBefore.nextUps;

            // Jump past 7 days - but halving is amount-based, not time-based
            await increaseTime(86400 * 7 + 1);

            const stateAfter = await multicall.getRig(rig.address, 0, user1.address);
            const upsAfter = stateAfter.nextUps;

            // UPS should be unchanged since no tokens were minted
            expect(upsAfter).to.equal(upsBefore);
        });

        it("getAuction returns correct initial state", async function () {
            const state = await multicall.getAuction(rig.address, user1.address);

            expect(state.epochId).to.equal(await auction.epochId());
            expect(state.initPrice).to.equal(await auction.initPrice());
            expect(state.startTime).to.equal(await auction.startTime());
            expect(state.paymentToken).to.equal(await auction.paymentToken());
        });

        it("getAuction returns correct user balances", async function () {
            const state = await multicall.getAuction(rig.address, user1.address);

            expect(state.accountQuoteBalance).to.equal(await weth.balanceOf(user1.address));
            expect(state.accountPaymentTokenBalance).to.equal(await lpToken.balanceOf(user1.address));
        });

        it("getAuction quoteAccumulated increases after mining", async function () {
            const stateBefore = await multicall.getAuction(rig.address, user1.address);

            // Mine to generate fees for treasury (auction)
            const slot = await rig.getSlot(0);
            const epochId = slot.epochId;
            const deadline = await getFutureDeadline();

            // Wait for reasonable price
            await increaseTime(1700);
            const price = await rig.getPrice(0);

            if (price.gt(0)) {
                await weth.connect(user2).approve(multicall.address, price.mul(2));

                await multicall.connect(user2).mine(
                    rig.address,
                    0, // index
                    epochId,
                    deadline,
                    price.mul(2),
                    "Generate fees",
                    { value: 0 }
                );

                const stateAfter = await multicall.getAuction(rig.address, user1.address);
                expect(stateAfter.quoteAccumulated).to.be.gt(stateBefore.quoteAccumulated);
            }
        });

        it("getRig unitPrice calculated from LP reserves", async function () {
            const state = await multicall.getRig(rig.address, 0, user1.address);

            // unitPrice = usdcInLP * 1e30 / unitInLP
            const usdcInLP = await usdc.balanceOf(lpToken.address);
            const unitInLP = await unit.balanceOf(lpToken.address);

            if (unitInLP.gt(0)) {
                const expectedPrice = usdcInLP.mul(convert("1", 30)).div(unitInLP);
                expect(state.unitPrice).to.be.closeTo(expectedPrice, expectedPrice.div(100));
            }
        });

        it("getAuction paymentTokenPrice calculated correctly", async function () {
            const state = await multicall.getAuction(rig.address, user1.address);

            // paymentTokenPrice = usdcInLP * 2e30 / lpTotalSupply
            const usdcInLP = await usdc.balanceOf(lpToken.address);
            const lpTotalSupply = await lpToken.totalSupply();

            if (lpTotalSupply.gt(0)) {
                const expectedPrice = usdcInLP.mul(2).mul(convert("1", 30)).div(lpTotalSupply);
                expect(state.paymentTokenPrice).to.be.closeTo(expectedPrice, expectedPrice.div(100));
            }
        });
    });

    // ============================================================
    // BUYING FROM AUCTION VIA MULTICALL
    // ============================================================
    describe("Buy from Auction via Multicall", function () {
        let rig, unit, auction, lpToken;

        beforeEach(async function () {
            // Launch a fresh rig for each test
            const launchParams = {
                launcher: AddressZero,
                quoteToken: weth.address,
                tokenName: "Buy Test Unit",
                tokenSymbol: "BUYTEST",
                uri: "https://example.com/rig",
                usdcAmount: convert("300", 6),
                unitAmount: convert("1000000", 18),
                initialUps: convert("5", 18),
                tailUps: convert("0.05", 18),
                halvingAmount: convert("10000000", 18),
                rigEpochPeriod: 1800,
                rigPriceMultiplier: convert("1.5", 18),
                rigMinInitPrice: convert("0.001", 18),
                upsMultipliers: [convert("1", 18)],
                upsMultiplierDuration: 86400,
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 3600,
                auctionPriceMultiplier: convert("1.2", 18),
                auctionMinInitPrice: convert("0.01", 18),
            };

            await usdc.connect(user0).approve(multicall.address, launchParams.usdcAmount);
            const tx = await multicall.connect(user0).launch(launchParams);
            const receipt = await tx.wait();

            const launchEvent = await parseLaunchEvent(receipt);
            rig = await ethers.getContractAt("MineRig", launchEvent.args.rig);
            unit = await ethers.getContractAt("Unit", launchEvent.args.unit);
            auction = await ethers.getContractAt("Auction", launchEvent.args.auction);
            lpToken = await ethers.getContractAt("MockLP", launchEvent.args.lpToken);

            // Disable entropy for tests that don't send ETH for VRF fees
            await rig.connect(user0).setEntropyEnabled(false);

            // Generate some USDC in the auction via mining
            const slot = await rig.getSlot(0);
            const epochId = slot.epochId;
            const price = await rig.getPrice(0);
            const deadline = await getFutureDeadline();

            await weth.connect(user1).approve(multicall.address, price.mul(2));

            await multicall.connect(user1).mine(
                rig.address,
                0, // index
                epochId,
                deadline,
                price.mul(2),
                "Generate auction fees",
                { value: 0 }
            );
        });

        it("Can buy from auction at zero price", async function () {
            // Wait for auction price to decay to zero
            await increaseTime(3700);

            const epochId = await auction.epochId();
            const price = await auction.getPrice();
            expect(price).to.equal(0);

            const wethBefore = await weth.balanceOf(user2.address);
            const auctionWeth = await weth.balanceOf(auction.address);

            const deadline = await getFutureDeadline();

            // Buy via Multicall (at zero price, no LP needed)
            await multicall.connect(user2).buy(
                rig.address,
                epochId,
                deadline,
                0
            );

            const wethAfter = await weth.balanceOf(user2.address);
            expect(wethAfter.sub(wethBefore)).to.equal(auctionWeth);
        });

        it("Buy requires LP token approval to Multicall", async function () {
            const epochId = await auction.epochId();
            const price = await auction.getPrice();
            const deadline = await getFutureDeadline();

            if (price.gt(0)) {
                // Mint LP tokens but don't approve
                await lpToken.mint(user3.address, price);

                await expect(
                    multicall.connect(user3).buy(
                        rig.address,
                        epochId,
                        deadline,
                        price.mul(2)
                    )
                ).to.be.reverted;
            }
        });

        it("Reverts with wrong epochId", async function () {
            const wrongEpochId = 999;
            const deadline = await getFutureDeadline();
            const price = await auction.getPrice();

            // Need to have LP tokens approved so we can test the epochId error
            await lpToken.mint(user2.address, price.add(convert("10", 18)));
            await lpToken.connect(user2).approve(multicall.address, price.add(convert("10", 18)));

            await expect(
                multicall.connect(user2).buy(
                    rig.address,
                    wrongEpochId,
                    deadline,
                    convert("10", 18)
                )
            ).to.be.revertedWith("Auction__EpochIdMismatch()");
        });

        it("Reverts with expired deadline", async function () {
            const epochId = await auction.epochId();
            const block = await ethers.provider.getBlock("latest");
            const pastDeadline = block.timestamp - 1;
            const price = await auction.getPrice();

            // Need to have LP tokens approved so we can test the deadline error
            await lpToken.mint(user2.address, price.add(convert("10", 18)));
            await lpToken.connect(user2).approve(multicall.address, price.add(convert("10", 18)));

            await expect(
                multicall.connect(user2).buy(
                    rig.address,
                    epochId,
                    pastDeadline,
                    convert("10", 18)
                )
            ).to.be.revertedWith("Auction__DeadlinePassed()");
        });
    });

    // ============================================================
    // FULL LIFECYCLE VIA MULTICALL ONLY
    // ============================================================
    describe("Full Lifecycle via Multicall Only", function () {
        it("Complete flow: launch -> mine -> earn tokens -> read state", async function () {
            // 1. Launch via Multicall
            const launchParams = {
                launcher: AddressZero,
                quoteToken: weth.address,
                tokenName: "Lifecycle Test",
                tokenSymbol: "LIFE",
                uri: "https://example.com/rig",
                usdcAmount: convert("500", 6),
                unitAmount: convert("1000000", 18),
                initialUps: convert("100", 18),
                tailUps: convert("1", 18),
                halvingAmount: convert("10000000", 18),
                rigEpochPeriod: 600,
                rigPriceMultiplier: convert("1.5", 18),
                rigMinInitPrice: convert("0.0001", 18),
                upsMultipliers: [convert("1", 18)],
                upsMultiplierDuration: 86400,
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 3600,
                auctionPriceMultiplier: convert("1.2", 18),
                auctionMinInitPrice: convert("0.001", 18),
            };

            await usdc.connect(user0).approve(multicall.address, launchParams.usdcAmount);
            const launchTx = await multicall.connect(user0).launch(launchParams);
            const launchReceipt = await launchTx.wait();
            const launchEvent = await parseLaunchEvent(launchReceipt);
            expect(launchEvent).to.not.be.null;

            const rigAddr = launchEvent.args.rig;
            const unitAddr = launchEvent.args.unit;
            const auctionAddr = launchEvent.args.auction;
            const rig = await ethers.getContractAt("MineRig", rigAddr);
            const unit = await ethers.getContractAt("Unit", unitAddr);

            // Disable entropy for tests that don't send ETH for VRF fees
            await rig.connect(user0).setEntropyEnabled(false);

            // 2. Read initial state via Multicall
            let state = await multicall.getRig(rigAddr, 0, user1.address);
            expect(state.epochId).to.equal(1);
            // Fresh rig's initial miner is the launcher (slot 0 initialized in constructor)
            let slot = await rig.getSlot(0);
            expect(slot.miner).to.equal(user0.address);

            // 3. First user mines via Multicall
            let epochId = slot.epochId;
            let price = await rig.getPrice(0);
            let deadline = await getFutureDeadline();

            await weth.connect(user1).approve(multicall.address, price.mul(2));

            await multicall.connect(user1).mine(
                rigAddr,
                0, // index
                epochId,
                deadline,
                price.mul(2),
                "First miner",
                { value: 0 }
            );

            // 4. Verify state updated
            state = await multicall.getRig(rigAddr, 0, user1.address);
            expect(state.miner).to.equal(user1.address);
            expect(state.slotUri).to.equal("First miner");

            // 5. Wait and let tokens accumulate
            await increaseTime(300);

            // 6. Second user mines, first user gets tokens
            slot = await rig.getSlot(0);
            epochId = slot.epochId;
            price = await rig.getPrice(0);
            deadline = await getFutureDeadline();

            const user1TokensBefore = await unit.balanceOf(user1.address);

            await weth.connect(user2).approve(multicall.address, price.mul(2));

            await multicall.connect(user2).mine(
                rigAddr,
                0, // index
                epochId,
                deadline,
                price.mul(2),
                "Second miner",
                { value: 0 }
            );

            const user1TokensAfter = await unit.balanceOf(user1.address);
            expect(user1TokensAfter).to.be.gt(user1TokensBefore);

            // 7. Verify updated state via Multicall
            state = await multicall.getRig(rigAddr, 0, user1.address);
            expect(state.miner).to.equal(user2.address);
            expect(state.accountUnitBalance).to.equal(user1TokensAfter);

            // 8. Check auction state via Multicall
            const auctionState = await multicall.getAuction(rigAddr, user1.address);
            expect(auctionState.quoteAccumulated).to.be.gt(0);
        });

        it("Multiple users mining same rig via Multicall", async function () {
            // Launch rig
            const launchParams = {
                launcher: AddressZero,
                quoteToken: weth.address,
                tokenName: "Multi User Test",
                tokenSymbol: "MULTI",
                uri: "https://example.com/rig",
                usdcAmount: convert("300", 6),
                unitAmount: convert("1000000", 18),
                initialUps: convert("50", 18),
                tailUps: convert("0.5", 18),
                halvingAmount: convert("10000000", 18),
                rigEpochPeriod: 600,
                rigPriceMultiplier: convert("1.2", 18),
                rigMinInitPrice: convert("0.00001", 18),
                upsMultipliers: [convert("1", 18)],
                upsMultiplierDuration: 86400,
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 3600,
                auctionPriceMultiplier: convert("1.1", 18),
                auctionMinInitPrice: convert("0.001", 18),
            };

            await usdc.connect(user0).approve(multicall.address, launchParams.usdcAmount);
            const tx = await multicall.connect(user0).launch(launchParams);
            const receipt = await tx.wait();
            const launchEvent = await parseLaunchEvent(receipt);
            const rigAddr = launchEvent.args.rig;
            const unitAddr = launchEvent.args.unit;
            const rig = await ethers.getContractAt("MineRig", rigAddr);
            const unit = await ethers.getContractAt("Unit", unitAddr);

            // Disable entropy for tests that don't send ETH for VRF fees
            await rig.connect(user0).setEntropyEnabled(false);

            const users = [user0, user1, user2, user3];

            // Each user mines in sequence
            for (let i = 0; i < 10; i++) {
                const user = users[i % users.length];
                const slot = await rig.getSlot(0);
                const epochId = slot.epochId;
                const price = await rig.getPrice(0);
                const deadline = await getFutureDeadline();

                await weth.connect(user).approve(multicall.address, price.add(convert("1", 6)));

                await multicall.connect(user).mine(
                    rigAddr,
                    0, // index
                    epochId,
                    deadline,
                    price.add(convert("1", 6)),
                    `Mine ${i}`,
                    { value: 0 }
                );

                // Small delay between mines
                await increaseTime(60);
            }

            // Verify all users earned tokens (except user3 who mined last)
            for (const user of [user0, user1, user2]) {
                const balance = await unit.balanceOf(user.address);
                expect(balance).to.be.gt(0);
            }
        });

        it("Frontend simulation: check state -> mine -> check state", async function () {
            // Launch rig
            const launchParams = {
                launcher: AddressZero,
                quoteToken: weth.address,
                tokenName: "Frontend Sim",
                tokenSymbol: "FRONT",
                uri: "https://example.com/rig",
                usdcAmount: convert("200", 6),
                unitAmount: convert("1000000", 18),
                initialUps: convert("10", 18),
                tailUps: convert("0.1", 18),
                halvingAmount: convert("10000000", 18),
                rigEpochPeriod: 600,
                rigPriceMultiplier: convert("1.5", 18),
                rigMinInitPrice: convert("0.0001", 18),
                upsMultipliers: [convert("1", 18)],
                upsMultiplierDuration: 86400,
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 3600,
                auctionPriceMultiplier: convert("1.2", 18),
                auctionMinInitPrice: convert("0.001", 18),
            };

            await usdc.connect(user1).approve(multicall.address, launchParams.usdcAmount);
            const tx = await multicall.connect(user1).launch(launchParams);
            const receipt = await tx.wait();
            const launchEvent = await parseLaunchEvent(receipt);
            const rigAddr = launchEvent.args.rig;

            // Frontend step 1: Get rig state to display
            const initialState = await multicall.getRig(rigAddr, 0, user2.address);

            console.log("    Initial State:");
            console.log(`      Epoch: ${initialState.epochId}`);
            console.log(`      Price: ${divDec(initialState.price)} ETH`);
            console.log(`      UPS: ${divDec(initialState.ups)}`);
            console.log(`      User Quote: ${divDec(initialState.accountQuoteBalance)}`);

            // Frontend step 2: User decides to mine
            const rig = await ethers.getContractAt("MineRig", rigAddr);

            // Disable entropy for tests that don't send ETH for VRF fees
            await rig.connect(user1).setEntropyEnabled(false);

            const epochId = initialState.epochId;
            const price = initialState.price;
            const deadline = await getFutureDeadline();

            // Approve WETH for the mine price (slot 0 is pre-initialized with minInitPrice)
            if (price.gt(0)) {
                await weth.connect(user2).approve(multicall.address, price.mul(2));
            }

            await multicall.connect(user2).mine(
                rigAddr,
                0, // index
                epochId,
                deadline,
                price.mul(2),
                "Frontend mine",
                { value: 0 }
            );

            // Frontend step 3: Refresh state
            const afterMineState = await multicall.getRig(rigAddr, 0, user2.address);

            console.log("    After Mine State:");
            console.log(`      Epoch: ${afterMineState.epochId}`);
            console.log(`      Miner: ${afterMineState.miner}`);
            console.log(`      Price: ${divDec(afterMineState.price)} ETH`);

            expect(afterMineState.epochId).to.equal(initialState.epochId.add(1));
            expect(afterMineState.miner).to.equal(user2.address);
        });
    });

    // ============================================================
    // EDGE CASES AND ERROR HANDLING
    // ============================================================
    describe("Edge Cases and Error Handling", function () {
        let rig, auction;

        before(async function () {
            const launchParams = {
                launcher: AddressZero,
                quoteToken: weth.address,
                tokenName: "Edge Case Test",
                tokenSymbol: "EDGE",
                uri: "https://example.com/rig",
                usdcAmount: convert("200", 6),
                unitAmount: convert("1000000", 18),
                initialUps: convert("5", 18),
                tailUps: convert("0.05", 18),
                halvingAmount: convert("10000000", 18),
                rigEpochPeriod: 600,
                rigPriceMultiplier: convert("1.5", 18),
                rigMinInitPrice: convert("0.0001", 18),
                upsMultipliers: [convert("1", 18)],
                upsMultiplierDuration: 86400,
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 3600,
                auctionPriceMultiplier: convert("1.2", 18),
                auctionMinInitPrice: convert("0.001", 18),
            };

            await usdc.connect(user0).approve(multicall.address, launchParams.usdcAmount);
            const tx = await multicall.connect(user0).launch(launchParams);
            const receipt = await tx.wait();
            const launchEvent = await parseLaunchEvent(receipt);
            rig = await ethers.getContractAt("MineRig", launchEvent.args.rig);
            auction = await ethers.getContractAt("Auction", launchEvent.args.auction);

            // Disable entropy for tests that don't send ETH for VRF fees
            await rig.connect(user0).setEntropyEnabled(false);
        });

        it("Mine with exact price (no excess refund)", async function () {
            const slot = await rig.getSlot(0);
            const epochId = slot.epochId;
            const price = await rig.getPrice(0);
            const deadline = await getFutureDeadline();

            const usdcBefore = await weth.balanceOf(user1.address);

            await weth.connect(user1).approve(multicall.address, price);

            await multicall.connect(user1).mine(
                rig.address,
                0, // index
                epochId,
                deadline,
                price,
                "Exact price",
                { value: 0 }
            );

            const usdcAfter = await weth.balanceOf(user1.address);
            // Should have spent approximately the quoted price (small difference from block time elapsed)
            expect(usdcBefore.sub(usdcAfter)).to.be.closeTo(price, price.div(100));
        });

        it("Query non-existent rig reverts", async function () {
            const fakeRig = ethers.Wallet.createRandom().address;

            await expect(
                multicall.getRig(fakeRig, 0, user1.address)
            ).to.be.reverted;
        });

        it("Query getAuction with non-existent rig reverts", async function () {
            const fakeRig = ethers.Wallet.createRandom().address;

            await expect(
                multicall.getAuction(fakeRig, user1.address)
            ).to.be.reverted;
        });

        it("Rapid sequential mines via Multicall work correctly", async function () {
            for (let i = 0; i < 5; i++) {
                const slot = await rig.getSlot(0);
                const epochId = slot.epochId;
                const price = await rig.getPrice(0);
                const deadline = await getFutureDeadline();

                await weth.connect(user1).approve(multicall.address, price.add(convert("1", 6)));

                await multicall.connect(user1).mine(
                    rig.address,
                    0, // index
                    epochId,
                    deadline,
                    price.add(convert("1", 6)),
                    `Rapid mine ${i}`,
                    { value: 0 }
                );
            }

            const slot = await rig.getSlot(0);
            expect(slot.miner).to.equal(user1.address);
        });

        it("Long URI strings work via Multicall", async function () {
            const longUri = "x".repeat(5000);
            const slot = await rig.getSlot(0);
            const epochId = slot.epochId;
            const price = await rig.getPrice(0);
            const deadline = await getFutureDeadline();

            await weth.connect(user2).approve(multicall.address, price.add(convert("1", 6)));

            await multicall.connect(user2).mine(
                rig.address,
                0, // index
                epochId,
                deadline,
                price.add(convert("1", 6)),
                longUri,
                { value: 0 }
            );

            const slotAfter = await rig.getSlot(0);
            expect(slotAfter.uri).to.equal(longUri);
        });
    });

    // ============================================================
    // GAS ESTIMATION VIA MULTICALL
    // ============================================================
    describe("Gas Usage", function () {
        let gasRigAddr;

        before(async function () {
            // Launch a rig to use in gas tests
            const launchParams = {
                launcher: AddressZero,
                quoteToken: weth.address,
                tokenName: "Gas Rig",
                tokenSymbol: "GRIG",
                uri: "https://example.com/rig",
                usdcAmount: convert("200", 6),
                unitAmount: convert("1000000", 18),
                initialUps: convert("1", 18),
                tailUps: convert("0.01", 18),
                halvingAmount: convert("10000000", 18),
                rigEpochPeriod: 3600,
                rigPriceMultiplier: convert("1.5", 18),
                rigMinInitPrice: convert("0.0001", 18),
                upsMultipliers: [convert("1", 18)],
                upsMultiplierDuration: 86400,
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 86400,
                auctionPriceMultiplier: convert("1.1", 18),
                auctionMinInitPrice: convert("0.001", 18),
            };

            await usdc.connect(user0).approve(multicall.address, launchParams.usdcAmount);
            const tx = await multicall.connect(user0).launch(launchParams);
            const receipt = await tx.wait();
            const launchEvent = await parseLaunchEvent(receipt);
            gasRigAddr = launchEvent.args.rig;

            // Disable entropy for tests that don't send ETH for VRF fees
            const gasRig = await ethers.getContractAt("MineRig", gasRigAddr);
            await gasRig.connect(user0).setEntropyEnabled(false);
        });

        it("Launch gas cost", async function () {
            const launchParams = {
                launcher: AddressZero,
                quoteToken: weth.address,
                tokenName: "Gas Test",
                tokenSymbol: "GAS",
                uri: "https://example.com/rig",
                usdcAmount: convert("200", 6),
                unitAmount: convert("1000000", 18),
                initialUps: convert("1", 18),
                tailUps: convert("0.01", 18),
                halvingAmount: convert("10000000", 18),
                rigEpochPeriod: 3600,
                rigPriceMultiplier: convert("1.5", 18),
                rigMinInitPrice: convert("0.0001", 18),
                upsMultipliers: [convert("1", 18)],
                upsMultiplierDuration: 86400,
                auctionInitPrice: convert("1", 18),
                auctionEpochPeriod: 86400,
                auctionPriceMultiplier: convert("1.1", 18),
                auctionMinInitPrice: convert("0.001", 18),
            };

            await usdc.connect(user3).approve(multicall.address, launchParams.usdcAmount);
            const tx = await multicall.connect(user3).launch(launchParams);
            const receipt = await tx.wait();

            console.log(`    Launch gas used: ${receipt.gasUsed.toString()}`);
            expect(receipt.gasUsed).to.be.lt(7000000); // Reasonable limit
        });

        it("Mine gas cost", async function () {
            const rig = await ethers.getContractAt("MineRig", gasRigAddr);

            const slot = await rig.getSlot(0);
            const epochId = slot.epochId;
            const price = await rig.getPrice(0);
            const deadline = await getFutureDeadline();

            await weth.connect(user1).approve(multicall.address, price.add(convert("1", 6)));

            const tx = await multicall.connect(user1).mine(
                gasRigAddr,
                0, // index
                epochId,
                deadline,
                price.add(convert("1", 6)),
                "Gas test mine",
                { value: 0 }
            );
            const receipt = await tx.wait();

            console.log(`    Mine gas used: ${receipt.gasUsed.toString()}`);
            expect(receipt.gasUsed).to.be.lt(500000); // Reasonable limit
        });

        it("getRig view call gas estimation", async function () {
            // For view calls, we can estimate gas
            const gasEstimate = await multicall.estimateGas.getRig(gasRigAddr, 0, user1.address);
            console.log(`    getRig estimated gas: ${gasEstimate.toString()}`);
        });

        it("getAuction view call gas estimation", async function () {
            const gasEstimate = await multicall.estimateGas.getAuction(gasRigAddr, user1.address);
            console.log(`    getAuction estimated gas: ${gasEstimate.toString()}`);
        });
    });
});
