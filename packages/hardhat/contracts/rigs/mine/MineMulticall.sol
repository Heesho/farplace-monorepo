// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMineRig} from "./interfaces/IMineRig.sol";
import {IAuction} from "../../interfaces/IAuction.sol";
import {IMineCore} from "./interfaces/IMineCore.sol";

/**
 * @title MineMulticall
 * @author heesho
 * @notice Helper contract for batched operations and aggregated view functions for MineRig.
 * @dev Provides single-slot mining with entropy fee handling,
 *      and comprehensive state queries for Rigs and Auctions.
 *      Quote token is read from each rig - users must approve this contract for the rig's quote token.
 *      ETH is only needed for entropy fees when randomness is enabled.
 */
contract MineMulticall {
    using SafeERC20 for IERC20;

    /*----------  ERRORS  -----------------------------------------------*/

    error MineMulticall__ZeroAddress();
    error MineMulticall__InvalidRig();
    error MineMulticall__InsufficientETH();
    error MineMulticall__ExcessETH();

    /*----------  IMMUTABLES  -------------------------------------------*/

    address public immutable core;  // Core contract reference
    address public immutable usdc; // USDC token address

    /*----------  STRUCTS  ----------------------------------------------*/

    /**
     * @notice Aggregated state for a Rig slot.
     */
    struct RigState {
        // Slot-specific state
        uint256 epochId;           // current epoch
        uint256 initPrice;         // epoch starting price
        uint256 epochStartTime;    // epoch start timestamp
        uint256 glazed;            // tokens earned so far this epoch
        uint256 price;             // current Dutch auction price
        uint256 ups;               // stored units per second for this slot
        uint256 upsMultiplier;     // multiplier for this slot
        address miner;             // current miner
        string slotUri;            // metadata URI for this slot
        bool needsEntropy;         // whether this slot needs entropy update
        uint256 entropyFee;        // current entropy fee if randomness enabled
        // Global rig state
        uint256 nextUps;           // calculated current ups (global)
        uint256 unitPrice;         // Unit token price in USDC
        string rigUri;             // metadata URI for the rig (global)
        uint256 capacity;          // total number of slots
        // User balances
        uint256 accountQuoteBalance;   // user's quote token balance
        uint256 accountUsdcBalance;   // user's USDC balance
        uint256 accountUnitBalance;    // user's Unit balance
        uint256 accountClaimable;      // user's claimable miner fees
    }

    /**
     * @notice Aggregated state for an Auction contract.
     */
    struct AuctionState {
        // Auction state
        uint256 epochId;                    // current epoch
        uint256 initPrice;                  // epoch starting price
        uint256 startTime;                  // epoch start timestamp
        address lpToken;                    // LP token used for payment (Unit-USDC LP)
        uint256 price;                      // current Dutch auction price (in LP tokens)
        uint256 lpTokenPrice;          // LP token price in USDC
        uint256 quoteAccumulated;           // Quote token held by auction (from treasury fees)
        // User balances
        uint256 accountQuoteBalance;        // user's quote token balance
        uint256 accountLpTokenBalance; // user's LP balance
    }

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    /**
     * @notice Deploy the Multicall helper contract.
     * @param _core Core contract address
     * @param _usdc USDC token address
     */
    constructor(address _core, address _usdc) {
        if (_core == address(0) || _usdc == address(0)) revert MineMulticall__ZeroAddress();
        core = _core;
        usdc = _usdc;
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Mine a single rig slot using the rig's quote token.
     * @dev User must approve the rig's quote token to this contract. ETH only needed for entropy fee.
     *      Sends ETH for entropy if randomness enabled and multiplier duration expired.
     *      Auto-claims for the previous miner (best effort - won't revert if claim fails).
     * @param rig Rig contract address
     * @param index Slot index to mine (0 for single-slot rigs)
     * @param epochId Expected epoch ID
     * @param deadline Transaction deadline
     * @param maxPrice Maximum quote token price willing to pay
     * @param slotUri Metadata URI for this mining action
     */
    function mine(
        address rig,
        uint256 index,
        uint256 epochId,
        uint256 deadline,
        uint256 maxPrice,
        string calldata slotUri
    ) external payable {
        if (!IMineCore(core).rigToIsRig(rig)) revert MineMulticall__InvalidRig();

        // Calculate entropy fee if needed
        uint256 entropyFee = _calculateEntropyFee(rig, index);
        if (msg.value < entropyFee) revert MineMulticall__InsufficientETH();

        // Get previous miner for auto-claim after mining
        address prevMiner = IMineRig(rig).getSlot(index).miner;

        // Get quote token and current price
        address quoteToken = IMineRig(rig).quote();
        uint256 price = IMineRig(rig).getPrice(index);
        if (price > 0) {
            IERC20(quoteToken).safeTransferFrom(msg.sender, address(this), price);
            IERC20(quoteToken).safeApprove(rig, 0);
            IERC20(quoteToken).safeApprove(rig, price);
        }

        // Mine with entropy fee forwarded
        if (msg.value > entropyFee) revert MineMulticall__ExcessETH();
        IMineRig(rig).mine{value: entropyFee}(msg.sender, index, epochId, deadline, maxPrice, slotUri);

        // Auto-claim for previous miner (best effort - won't block mining if claim fails)
        if (prevMiner != address(0) && IMineRig(rig).accountToClaimable(prevMiner) > 0) {
            try IMineRig(rig).claim(prevMiner) {} catch {}
        }

        // Refund any unused quote tokens (in case price changed)
        uint256 quoteBalance = IERC20(quoteToken).balanceOf(address(this));
        if (quoteBalance > 0) {
            IERC20(quoteToken).safeTransfer(msg.sender, quoteBalance);
        }
    }

    /**
     * @notice Buy from an auction using LP tokens.
     * @dev Transfers LP tokens from caller, approves auction, and executes buy.
     * @param rig Rig contract address (used to look up auction)
     * @param epochId Expected epoch ID
     * @param deadline Transaction deadline
     * @param maxPaymentTokenAmount Maximum LP tokens willing to pay
     */
    function buy(address rig, uint256 epochId, uint256 deadline, uint256 maxPaymentTokenAmount) external {
        if (!IMineCore(core).rigToIsRig(rig)) revert MineMulticall__InvalidRig();
        address auction = IMineCore(core).rigToAuction(rig);
        address lpToken = IAuction(auction).paymentToken();
        uint256 price = IAuction(auction).getPrice();
        address[] memory assets = new address[](1);
        assets[0] = IMineRig(rig).quote();

        IERC20(lpToken).safeTransferFrom(msg.sender, address(this), price);
        IERC20(lpToken).safeApprove(auction, 0);
        IERC20(lpToken).safeApprove(auction, price);
        IAuction(auction).buy(assets, msg.sender, epochId, deadline, maxPaymentTokenAmount);
    }

    /**
     * @notice Launch a new rig via Core.
     * @dev Transfers USDC from caller, approves Core, and calls launch with caller as launcher.
     * @param params Launch parameters (launcher field is overwritten with msg.sender)
     * @return unit Address of deployed Unit token
     * @return rig Address of deployed Rig contract
     * @return auction Address of deployed Auction contract
     * @return lpToken Address of Unit/USDC LP token
     */
    function launch(IMineCore.LaunchParams calldata params)
        external
        returns (address unit, address rig, address auction, address lpToken)
    {
        // Transfer USDC from user
        IERC20(usdc).safeTransferFrom(msg.sender, address(this), params.usdcAmount);
        IERC20(usdc).safeApprove(core, 0);
        IERC20(usdc).safeApprove(core, params.usdcAmount);

        // Build params with msg.sender as launcher
        IMineCore.LaunchParams memory launchParams = IMineCore.LaunchParams({
            launcher: msg.sender,
            quoteToken: params.quoteToken,
            tokenName: params.tokenName,
            tokenSymbol: params.tokenSymbol,
            uri: params.uri,
            usdcAmount: params.usdcAmount,
            unitAmount: params.unitAmount,
            initialUps: params.initialUps,
            tailUps: params.tailUps,
            halvingAmount: params.halvingAmount,
            rigEpochPeriod: params.rigEpochPeriod,
            rigPriceMultiplier: params.rigPriceMultiplier,
            rigMinInitPrice: params.rigMinInitPrice,
            upsMultipliers: params.upsMultipliers,
            upsMultiplierDuration: params.upsMultiplierDuration,
            auctionInitPrice: params.auctionInitPrice,
            auctionEpochPeriod: params.auctionEpochPeriod,
            auctionPriceMultiplier: params.auctionPriceMultiplier,
            auctionMinInitPrice: params.auctionMinInitPrice
        });

        return IMineCore(core).launch(launchParams);
    }

    /*----------  INTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Calculate entropy fee for a slot if randomness is enabled and multiplier needs update.
     * @param rig Rig contract address
     * @param index Slot index
     * @return fee Entropy fee to send (0 if not needed)
     */
    function _calculateEntropyFee(address rig, uint256 index) internal view returns (uint256 fee) {
        if (!IMineRig(rig).entropyEnabled()) {
            return 0;
        }

        IMineRig.Slot memory slot = IMineRig(rig).getSlot(index);
        uint256 duration = IMineRig(rig).upsMultiplierDuration();
        bool needsUpdate = block.timestamp - slot.lastUpsMultiplierTime > duration;

        if (needsUpdate) {
            return IMineRig(rig).getEntropyFee();
        }

        return 0;
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Get aggregated state for a Rig slot and user balances.
     * @param rig Rig contract address
     * @param index Slot index to query (0 for single-slot rigs)
     * @param account User address (or address(0) to skip balance queries)
     * @return state Aggregated rig state
     */
    function getRig(address rig, uint256 index, address account) external view returns (RigState memory state) {
        IMineRig.Slot memory slot = IMineRig(rig).getSlot(index);

        state.epochId = slot.epochId;
        state.initPrice = slot.initPrice;
        state.epochStartTime = slot.startTime;
        state.ups = slot.ups;
        state.upsMultiplier = slot.upsMultiplier;
        state.glazed = slot.ups * slot.upsMultiplier * (block.timestamp - slot.startTime) / 1e18;
        state.price = IMineRig(rig).getPrice(index);
        state.nextUps = IMineRig(rig).getUps();
        state.miner = slot.miner;
        state.slotUri = slot.uri;
        state.rigUri = IMineRig(rig).uri();
        state.capacity = IMineRig(rig).capacity();

        // Entropy state
        if (IMineRig(rig).entropyEnabled()) {
            uint256 duration = IMineRig(rig).upsMultiplierDuration();
            state.needsEntropy = block.timestamp - slot.lastUpsMultiplierTime > duration;
            state.entropyFee = state.needsEntropy ? IMineRig(rig).getEntropyFee() : 0;
        }

        address unitToken = IMineRig(rig).unit();

        // Calculate Unit price in USDC from LP reserves
        // USDC has 6 decimals, Unit has 18. Multiply by 1e30 (= 1e12 normalization * 1e18 precision)
        address lpToken = IMineCore(core).rigToLP(rig);
        if (lpToken != address(0)) {
            uint256 usdcInLP = IERC20(usdc).balanceOf(lpToken);
            uint256 unitInLP = IERC20(unitToken).balanceOf(lpToken);
            state.unitPrice = unitInLP == 0 ? 0 : usdcInLP * 1e30 / unitInLP;
        }

        // User balances
        address quoteToken = IMineRig(rig).quote();
        state.accountQuoteBalance = account == address(0) ? 0 : IERC20(quoteToken).balanceOf(account);
        state.accountUsdcBalance = account == address(0) ? 0 : IERC20(usdc).balanceOf(account);
        state.accountUnitBalance = account == address(0) ? 0 : IERC20(unitToken).balanceOf(account);
        state.accountClaimable = account == address(0) ? 0 : IMineRig(rig).accountToClaimable(account);

        return state;
    }

    /**
     * @notice Get multiple slots' state in a single call.
     * @param rig Rig contract address
     * @param indices Array of slot indices to query
     * @param account User address (or address(0) to skip balance queries)
     * @return states Array of aggregated rig states
     */
    function getRigMultiple(
        address rig,
        uint256[] calldata indices,
        address account
    ) external view returns (RigState[] memory states) {
        uint256 length = indices.length;
        states = new RigState[](length);
        for (uint256 i = 0; i < length;) {
            states[i] = this.getRig(rig, indices[i], account);
            unchecked { ++i; }
        }
        return states;
    }

    /**
     * @notice Get aggregated state for an Auction and user balances.
     * @param rig Rig contract address (used to look up auction)
     * @param account User address (or address(0) to skip balance queries)
     * @return state Aggregated auction state
     */
    function getAuction(address rig, address account) external view returns (AuctionState memory state) {
        address auction = IMineCore(core).rigToAuction(rig);

        state.epochId = IAuction(auction).epochId();
        state.initPrice = IAuction(auction).initPrice();
        state.startTime = IAuction(auction).startTime();
        state.lpToken = IAuction(auction).paymentToken();
        state.price = IAuction(auction).getPrice();

        // LP price in USDC = (USDC in LP * 2) / LP total supply
        // USDC has 6 decimals, LP has 18. Multiply by 2e30 (= 2 * 1e12 normalization * 1e18 precision)
        uint256 lpTotalSupply = IERC20(state.lpToken).totalSupply();
        state.lpTokenPrice =
            lpTotalSupply == 0 ? 0 : IERC20(usdc).balanceOf(state.lpToken) * 2e30 / lpTotalSupply;

        address quoteToken = IMineRig(rig).quote();
        state.quoteAccumulated = IERC20(quoteToken).balanceOf(auction);
        state.accountQuoteBalance = account == address(0) ? 0 : IERC20(quoteToken).balanceOf(account);
        state.accountLpTokenBalance = account == address(0) ? 0 : IERC20(state.lpToken).balanceOf(account);

        return state;
    }

}
