/**
 * @title Auction Invariant and Business Logic Tests
 * @notice Comprehensive tests verifying Dutch auction mechanics for treasury asset sales
 * @dev Tests focus on price decay, asset distribution, and epoch management
 */

const convert = (amount, decimals = 18) => ethers.utils.parseUnits(amount.toString(), decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";
const AddressDead = "0x000000000000000000000000000000000000dEaD";

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

const ONE_HOUR = 3600;
const ONE_DAY = 86400;
const PRECISION = ethers.BigNumber.from("1000000000000000000");

describe("Auction Invariant Tests", function () {
  let owner, paymentReceiver, buyer0, buyer1, buyer2;
  let paymentToken, assetToken1, assetToken2, auction;

  before("Deploy contracts", async function () {
    await network.provider.send("hardhat_reset");

    [owner, paymentReceiver, buyer0, buyer1, buyer2] = await ethers.getSigners();

    // Deploy mock tokens
    const mockWethArtifact = await ethers.getContractFactory("MockWETH");
    paymentToken = await mockWethArtifact.deploy();
    assetToken1 = await mockWethArtifact.deploy();
    assetToken2 = await mockWethArtifact.deploy();

    // Deploy Auction
    const auctionArtifact = await ethers.getContractFactory("Auction");
    auction = await auctionArtifact.deploy(
      convert("100", 18), // initPrice: 100 tokens
      paymentToken.address,
      paymentReceiver.address,
      ONE_DAY, // epochPeriod
      convert("2", 18), // priceMultiplier (2x)
      convert("1", 18) // minInitPrice
    );

    // Fund buyers
    await paymentToken.connect(buyer0).deposit({ value: convert("1000", 18) });
    await paymentToken.connect(buyer1).deposit({ value: convert("1000", 18) });
    await paymentToken.connect(buyer2).deposit({ value: convert("1000", 18) });

    // Send assets to auction
    await assetToken1.connect(owner).deposit({ value: convert("500", 18) });
    await assetToken1.connect(owner).transfer(auction.address, convert("500", 18));

    await assetToken2.connect(owner).deposit({ value: convert("300", 18) });
    await assetToken2.connect(owner).transfer(auction.address, convert("300", 18));
  });

  /**
   * INVARIANT 1: Price decay formula
   * price = initPrice - (initPrice * timePassed / epochPeriod)
   */
  describe("INVARIANT: Price Decay Formula", function () {
    it("Price should equal initPrice at epoch start", async function () {
      const initPrice = await auction.initPrice();
      const price = await auction.getPrice();

      // Allow tolerance for time passing
      const tolerance = initPrice.div(100);
      expect(price).to.be.closeTo(initPrice, tolerance);
    });

    it("Price should be ~50% at epoch midpoint", async function () {
      const initPrice = await auction.initPrice();
      const epochPeriod = await auction.epochPeriod();

      await increaseTime(epochPeriod.toNumber() / 2);

      const price = await auction.getPrice();
      const expected = initPrice.div(2);
      const tolerance = expected.div(5);

      expect(price).to.be.closeTo(expected, tolerance);
    });

    it("Price should be 0 after epoch expires", async function () {
      const epochPeriod = await auction.epochPeriod();
      await increaseTime(epochPeriod.toNumber() / 2 + 1);

      const price = await auction.getPrice();
      expect(price).to.equal(0);
    });

    it("Price should never be negative", async function () {
      // Test at extreme time points
      for (let i = 0; i < 3; i++) {
        const price = await auction.getPrice();
        expect(price).to.be.gte(0);
        await increaseTime(ONE_DAY);
      }
    });
  });

  /**
   * INVARIANT 2: Price multiplier on buy
   * newInitPrice = max(minInitPrice, price * priceMultiplier / PRECISION)
   */
  describe("INVARIANT: Price Multiplier", function () {
    it("New initPrice should be price * multiplier", async function () {
      // First, buy to reset auction if price is 0 (from previous tests)
      let price = await auction.getPrice();
      let epochId = await auction.epochId();

      if (price.eq(0)) {
        // Send fresh assets and buy at price 0 to reset the auction
        await assetToken1.connect(owner).deposit({ value: convert("50", 18) });
        await assetToken1.connect(owner).transfer(auction.address, convert("50", 18));

        await auction.connect(buyer0).buy(
          [assetToken1.address],
          buyer0.address,
          epochId,
          1961439882,
          convert("1000", 18)
        );
      }

      // Now we should have a fresh epoch with initPrice > 0
      price = await auction.getPrice();
      epochId = await auction.epochId();
      const priceMultiplier = await auction.priceMultiplier();

      // If still 0, skip
      if (price.eq(0)) {
        this.skip();
      }

      // Send fresh assets for the test buy
      await assetToken1.connect(owner).deposit({ value: convert("50", 18) });
      await assetToken1.connect(owner).transfer(auction.address, convert("50", 18));

      await paymentToken.connect(buyer0).approve(auction.address, price.add(convert("10", 18)));
      const tx = await auction.connect(buyer0).buy(
        [assetToken1.address],
        buyer0.address,
        epochId,
        1961439882,
        price.add(convert("10", 18))
      );

      // Get actual price from event
      const receipt = await tx.wait();
      const buyEvent = receipt.events.find(e => e.event === "Auction__Buy");
      const actualPrice = buyEvent.args.paymentAmount;

      const newInitPrice = await auction.initPrice();
      const expectedInitPrice = actualPrice.mul(priceMultiplier).div(PRECISION);

      expect(newInitPrice).to.be.closeTo(expectedInitPrice, expectedInitPrice.div(100).add(1));
    });

    it("New initPrice should not be below minInitPrice", async function () {
      // Wait for price to decay to 0
      await increaseTime(ONE_DAY + 1);

      const price = await auction.getPrice();
      expect(price).to.equal(0);

      const epochId = await auction.epochId();
      const minInitPrice = await auction.minInitPrice();

      // Buy at price 0
      await auction.connect(buyer1).buy(
        [assetToken1.address],
        buyer1.address,
        epochId,
        1961439882,
        convert("1000", 18)
      );

      const newInitPrice = await auction.initPrice();
      expect(newInitPrice).to.equal(minInitPrice);
    });
  });

  /**
   * INVARIANT 3: Epoch ID increments
   */
  describe("INVARIANT: Epoch ID Increments", function () {
    it("Epoch ID should increment by 1 on each buy", async function () {
      // Send fresh assets
      await assetToken1.connect(owner).deposit({ value: convert("50", 18) });
      await assetToken1.connect(owner).transfer(auction.address, convert("50", 18));

      const epochIdBefore = await auction.epochId();

      // Buy to increment
      const price = await auction.getPrice();

      await paymentToken.connect(buyer2).approve(auction.address, price.add(convert("1000", 18)));
      await auction.connect(buyer2).buy(
        [assetToken1.address],
        buyer2.address,
        epochIdBefore,
        1961439882,
        price.add(convert("1000", 18))
      );

      const epochIdAfter = await auction.epochId();
      expect(epochIdAfter).to.equal(epochIdBefore.add(1));
    });
  });

  /**
   * INVARIANT 4: All assets transferred on buy
   */
  describe("INVARIANT: Asset Transfer", function () {
    it("All requested assets should be transferred to buyer", async function () {
      // Send fresh assets
      await assetToken1.connect(owner).deposit({ value: convert("100", 18) });
      await assetToken1.connect(owner).transfer(auction.address, convert("100", 18));

      const auctionBalBefore = await assetToken1.balanceOf(auction.address);
      const buyerBalBefore = await assetToken1.balanceOf(buyer0.address);

      const price = await auction.getPrice();
      const epochId = await auction.epochId();

      await paymentToken.connect(buyer0).approve(auction.address, price.add(convert("1000", 18)));
      await auction.connect(buyer0).buy(
        [assetToken1.address],
        buyer0.address,
        epochId,
        1961439882,
        price.add(convert("1000", 18))
      );

      const auctionBalAfter = await assetToken1.balanceOf(auction.address);
      const buyerBalAfter = await assetToken1.balanceOf(buyer0.address);

      // Auction should have transferred all of asset to buyer
      expect(auctionBalAfter).to.equal(0);
      expect(buyerBalAfter.sub(buyerBalBefore)).to.equal(auctionBalBefore);
    });
  });

  /**
   * INVARIANT 5: Payment goes to paymentReceiver
   */
  describe("INVARIANT: Payment Distribution", function () {
    it("Payment should go to paymentReceiver", async function () {
      // Send fresh assets
      await assetToken1.connect(owner).deposit({ value: convert("50", 18) });
      await assetToken1.connect(owner).transfer(auction.address, convert("50", 18));

      const price = await auction.getPrice();
      const epochId = await auction.epochId();

      if (price.eq(0)) {
        this.skip();
      }

      const receiverBalBefore = await paymentToken.balanceOf(paymentReceiver.address);

      // Approve extra to cover price decay
      await paymentToken.connect(buyer1).approve(auction.address, price.add(convert("10", 18)));
      const tx = await auction.connect(buyer1).buy(
        [assetToken1.address],
        buyer1.address,
        epochId,
        1961439882,
        price.add(convert("10", 18))
      );

      // Get actual payment amount from event
      const receipt = await tx.wait();
      const buyEvent = receipt.events.find(e => e.event === "Auction__Buy");
      const actualPayment = buyEvent.args.paymentAmount;

      const receiverBalAfter = await paymentToken.balanceOf(paymentReceiver.address);
      expect(receiverBalAfter.sub(receiverBalBefore)).to.equal(actualPayment);
    });
  });
});

describe("Auction Business Logic Tests", function () {
  let owner, paymentReceiver, buyer0, buyer1;
  let paymentToken, assetToken, auction;

  before("Deploy contracts", async function () {
    await network.provider.send("hardhat_reset");

    [owner, paymentReceiver, buyer0, buyer1] = await ethers.getSigners();

    const mockWethArtifact = await ethers.getContractFactory("MockWETH");
    paymentToken = await mockWethArtifact.deploy();
    assetToken = await mockWethArtifact.deploy();

    const auctionArtifact = await ethers.getContractFactory("Auction");
    auction = await auctionArtifact.deploy(
      convert("10", 18),
      paymentToken.address,
      paymentReceiver.address,
      ONE_HOUR, // Short epoch for testing
      convert("1.5", 18),
      convert("0.1", 18)
    );

    await paymentToken.connect(buyer0).deposit({ value: convert("1000", 18) });
    await paymentToken.connect(buyer1).deposit({ value: convert("1000", 18) });

    await assetToken.connect(owner).deposit({ value: convert("1000", 18) });
    await assetToken.connect(owner).transfer(auction.address, convert("500", 18));
  });

  describe("Buy Slippage Protection", function () {
    it("Should revert with expired deadline", async function () {
      const epochId = await auction.epochId();

      await expect(
        auction.connect(buyer0).buy(
          [assetToken.address],
          buyer0.address,
          epochId,
          1, // Expired deadline
          convert("1000", 18)
        )
      ).to.be.revertedWith("Auction__DeadlinePassed()");
    });

    it("Should revert with wrong epoch ID", async function () {
      await expect(
        auction.connect(buyer0).buy(
          [assetToken.address],
          buyer0.address,
          99999, // Wrong epoch ID
          1961439882,
          convert("1000", 18)
        )
      ).to.be.revertedWith("Auction__EpochIdMismatch()");
    });

    it("Should revert if price exceeds maxPaymentTokenAmount", async function () {
      const price = await auction.getPrice();
      const epochId = await auction.epochId();

      if (price.gt(0)) {
        await paymentToken.connect(buyer0).approve(auction.address, convert("1000", 18));

        await expect(
          auction.connect(buyer0).buy(
            [assetToken.address],
            buyer0.address,
            epochId,
            1961439882,
            0 // maxPaymentTokenAmount = 0
          )
        ).to.be.revertedWith("Auction__MaxPaymentAmountExceeded()");
      }
    });

    it("Should revert with empty assets array", async function () {
      const price = await auction.getPrice();
      const epochId = await auction.epochId();

      await paymentToken.connect(buyer0).approve(auction.address, price.add(convert("10", 18)));

      await expect(
        auction.connect(buyer0).buy(
          [],
          buyer0.address,
          epochId,
          1961439882,
          price.add(convert("10", 18))
        )
      ).to.be.revertedWith("Auction__EmptyAssets()");
    });
  });

  describe("Buy Flow", function () {
    it("Should allow buying at current price", async function () {
      const price = await auction.getPrice();
      const epochId = await auction.epochId();

      await paymentToken.connect(buyer0).approve(auction.address, price.add(convert("10", 18)));

      await expect(
        auction.connect(buyer0).buy(
          [assetToken.address],
          buyer0.address,
          epochId,
          1961439882,
          price.add(convert("10", 18))
        )
      ).to.not.be.reverted;
    });

    it("Should allow buying at price 0 after epoch expires", async function () {
      // Send fresh assets
      await assetToken.connect(owner).deposit({ value: convert("50", 18) });
      await assetToken.connect(owner).transfer(auction.address, convert("50", 18));

      await increaseTime(ONE_HOUR + 1);

      const price = await auction.getPrice();
      expect(price).to.equal(0);

      const epochId = await auction.epochId();

      // No payment needed
      await expect(
        auction.connect(buyer1).buy(
          [assetToken.address],
          buyer1.address,
          epochId,
          1961439882,
          convert("1000", 18)
        )
      ).to.not.be.reverted;
    });

    it("Should emit Buy event", async function () {
      // Send fresh assets
      await assetToken.connect(owner).deposit({ value: convert("100", 18) });
      await assetToken.connect(owner).transfer(auction.address, convert("100", 18));

      const price = await auction.getPrice();
      const epochId = await auction.epochId();

      await paymentToken.connect(buyer0).approve(auction.address, price.add(convert("100", 18)));

      await expect(
        auction.connect(buyer0).buy(
          [assetToken.address],
          buyer0.address,
          epochId,
          1961439882,
          price.add(convert("100", 18))
        )
      ).to.emit(auction, "Auction__Buy");
    });
  });

  describe("Asset Accumulation", function () {
    it("Auction can receive assets between buys", async function () {
      // Send assets
      await assetToken.connect(owner).deposit({ value: convert("200", 18) });
      await assetToken.connect(owner).transfer(auction.address, convert("200", 18));

      const balance = await assetToken.balanceOf(auction.address);
      expect(balance).to.equal(convert("200", 18));
    });

    it("Multiple assets can be bought in single transaction", async function () {
      // Deploy second asset
      const mockWethArtifact = await ethers.getContractFactory("MockWETH");
      const assetToken2 = await mockWethArtifact.deploy();

      await assetToken2.connect(owner).deposit({ value: convert("100", 18) });
      await assetToken2.connect(owner).transfer(auction.address, convert("100", 18));

      const price = await auction.getPrice();
      const epochId = await auction.epochId();

      const buyer0Asset1Before = await assetToken.balanceOf(buyer0.address);
      const buyer0Asset2Before = await assetToken2.balanceOf(buyer0.address);

      await paymentToken.connect(buyer0).approve(auction.address, price.add(convert("100", 18)));
      await auction.connect(buyer0).buy(
        [assetToken.address, assetToken2.address],
        buyer0.address,
        epochId,
        1961439882,
        price.add(convert("100", 18))
      );

      const buyer0Asset1After = await assetToken.balanceOf(buyer0.address);
      const buyer0Asset2After = await assetToken2.balanceOf(buyer0.address);

      expect(buyer0Asset1After).to.be.gt(buyer0Asset1Before);
      expect(buyer0Asset2After).to.be.gt(buyer0Asset2Before);
    });

    it("Empty assets array should revert", async function () {
      const price = await auction.getPrice();
      const epochId = await auction.epochId();

      await paymentToken.connect(buyer0).approve(auction.address, price.add(convert("100", 18)));

      await expect(
        auction.connect(buyer0).buy(
          [], // No assets requested
          buyer0.address,
          epochId,
          1961439882,
          price.add(convert("100", 18))
        )
      ).to.be.revertedWith("Auction__EmptyAssets()");
    });
  });

  describe("View Functions", function () {
    it("getPrice() should return current price", async function () {
      const price = await auction.getPrice();
      expect(price).to.be.gte(0);
    });

    it("epochId should be accessible", async function () {
      const epochId = await auction.epochId();
      expect(epochId).to.be.gte(0);
    });

    it("initPrice should be accessible", async function () {
      const initPrice = await auction.initPrice();
      expect(initPrice).to.be.gte(0);
    });

    it("startTime should be accessible", async function () {
      const startTime = await auction.startTime();
      expect(startTime).to.be.gt(0);
    });
  });
});
