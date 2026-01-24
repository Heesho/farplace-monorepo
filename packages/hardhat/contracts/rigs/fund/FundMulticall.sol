// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IFundRig} from "./interfaces/IFundRig.sol";
import {IFundCore} from "./interfaces/IFundCore.sol";
import {IAuction} from "../../interfaces/IAuction.sol";

/**
 * @title FundMulticall
 * @author heesho
 * @notice Helper contract for batched operations and aggregated view functions for FundRig.
 * @dev Provides donation batching, claim batching, and comprehensive state queries.
 *      Payment token is read from each rig - users must approve this contract for the rig's payment token.
 */
contract FundMulticall {
    using SafeERC20 for IERC20;

    /*----------  ERRORS  -----------------------------------------------*/

    error FundMulticall__ZeroAddress();
    error FundMulticall__InvalidRig();
    error FundMulticall__ArrayLengthMismatch();

    /*----------  IMMUTABLES  -------------------------------------------*/

    address public immutable core;
    address public immutable donut;

    /*----------  STRUCTS  ----------------------------------------------*/

    /**
     * @notice Aggregated state for a FundRig.
     */
    struct RigState {
        // Rig state
        uint256 currentDay;
        uint256 todayEmission;
        uint256 todayTotalDonated;
        uint256 startTime;
        address treasury;
        address team;
        // Global rig state
        uint256 unitPrice;
        string rigUri;
        // User balances
        uint256 accountPaymentTokenBalance;
        uint256 accountDonutBalance;
        uint256 accountUnitBalance;
        uint256 accountTodayDonation;
    }

    /**
     * @notice Claimable day info for a user.
     */
    struct ClaimableDay {
        uint256 day;
        uint256 donation;
        uint256 pendingReward;
        bool hasClaimed;
    }

    /**
     * @notice Aggregated state for an Auction contract.
     */
    struct AuctionState {
        uint256 epochId;
        uint256 initPrice;
        uint256 startTime;
        address paymentToken;
        uint256 price;
        uint256 paymentTokenPrice;
        uint256 quoteAccumulated;
        uint256 accountQuoteBalance;
        uint256 accountPaymentTokenBalance;
    }

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    /**
     * @notice Deploy the Multicall helper contract.
     * @param _core FundCore contract address
     * @param _donut DONUT token address
     */
    constructor(address _core, address _donut) {
        if (_core == address(0) || _donut == address(0)) revert FundMulticall__ZeroAddress();
        core = _core;
        donut = _donut;
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Fund a rig using the rig's payment token.
     * @dev User must approve the payment token to this contract.
     * @param rig Rig contract address
     * @param account The account to credit for this funding
     * @param recipient The whitelisted fund address
     * @param amount The amount of payment tokens to fund
     */
    function fund(
        address rig,
        address account,
        address recipient,
        uint256 amount
    ) external {
        if (!IFundCore(core).isDeployedRig(rig)) revert FundMulticall__InvalidRig();

        address paymentToken = IFundRig(rig).paymentToken();
        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(paymentToken).safeApprove(rig, 0);
        IERC20(paymentToken).safeApprove(rig, amount);
        IFundRig(rig).fund(account, recipient, amount);
    }

    /**
     * @notice Claim rewards for a single day.
     * @param rig Rig contract address
     * @param account The account to claim for
     * @param day The day to claim
     */
    function claim(address rig, address account, uint256 day) external {
        if (!IFundCore(core).isDeployedRig(rig)) revert FundMulticall__InvalidRig();
        IFundRig(rig).claim(account, day);
    }

    /**
     * @notice Claim rewards for multiple days in a single transaction.
     * @dev Skips days that are already claimed, have no donation, or haven't ended.
     * @param rig Rig contract address
     * @param account The account to claim for
     * @param dayIds Array of days to claim
     */
    function claimMultiple(address rig, address account, uint256[] calldata dayIds) external {
        if (!IFundCore(core).isDeployedRig(rig)) revert FundMulticall__InvalidRig();
        uint256 length = dayIds.length;
        if (length == 0) revert FundMulticall__ArrayLengthMismatch();

        uint256 currentDay = IFundRig(rig).currentDay();
        for (uint256 i = 0; i < length;) {
            // Skip if already claimed, no donation, or day hasn't ended
            if (
                !IFundRig(rig).dayAccountToHasClaimed(dayIds[i], account) &&
                IFundRig(rig).dayAccountToDonation(dayIds[i], account) > 0 &&
                dayIds[i] < currentDay
            ) {
                IFundRig(rig).claim(account, dayIds[i]);
            }
            unchecked { ++i; }
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
        if (!IFundCore(core).isDeployedRig(rig)) revert FundMulticall__InvalidRig();
        address auction = IFundCore(core).rigToAuction(rig);
        address lpToken = IAuction(auction).paymentToken();
        uint256 price = IAuction(auction).getPrice();
        address[] memory assets = new address[](1);
        assets[0] = IFundRig(rig).paymentToken();

        IERC20(lpToken).safeTransferFrom(msg.sender, address(this), price);
        IERC20(lpToken).safeApprove(auction, 0);
        IERC20(lpToken).safeApprove(auction, price);
        IAuction(auction).buy(assets, msg.sender, epochId, deadline, maxPaymentTokenAmount);
    }

    /**
     * @notice Launch a new rig via Core.
     * @dev Transfers DONUT from caller, approves Core, and calls launch with caller as launcher.
     * @param params Launch parameters (launcher field is overwritten with msg.sender)
     * @return unit Address of deployed Unit token
     * @return rig Address of deployed Rig contract
     * @return auction Address of deployed Auction contract
     * @return lpToken Address of Unit/DONUT LP token
     */
    function launch(IFundCore.LaunchParams calldata params)
        external
        returns (address unit, address rig, address auction, address lpToken)
    {
        // Transfer DONUT from user
        IERC20(donut).safeTransferFrom(msg.sender, address(this), params.donutAmount);
        IERC20(donut).safeApprove(core, 0);
        IERC20(donut).safeApprove(core, params.donutAmount);

        // Build params with msg.sender as launcher
        IFundCore.LaunchParams memory launchParams = IFundCore.LaunchParams({
            launcher: msg.sender,
            quoteToken: params.quoteToken,
            tokenName: params.tokenName,
            tokenSymbol: params.tokenSymbol,
            donutAmount: params.donutAmount,
            unitAmount: params.unitAmount,
            initialEmission: params.initialEmission,
            minEmission: params.minEmission,
            minDonation: params.minDonation,
            auctionInitPrice: params.auctionInitPrice,
            auctionEpochPeriod: params.auctionEpochPeriod,
            auctionPriceMultiplier: params.auctionPriceMultiplier,
            auctionMinInitPrice: params.auctionMinInitPrice
        });

        return IFundCore(core).launch(launchParams);
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Get aggregated state for a FundRig and user balances.
     * @param rig Rig contract address
     * @param account User address (or address(0) to skip balance queries)
     * @return state Aggregated rig state
     */
    function getRig(address rig, address account) external view returns (RigState memory state) {
        uint256 day = IFundRig(rig).currentDay();

        state.currentDay = day;
        state.todayEmission = IFundRig(rig).getDayEmission(day);
        state.todayTotalDonated = IFundRig(rig).getDayTotal(day);
        state.startTime = IFundRig(rig).startTime();
        state.treasury = IFundRig(rig).treasury();
        state.team = IFundRig(rig).team();

        address unitToken = IFundRig(rig).unit();
        address auction = IFundCore(core).rigToAuction(rig);

        // Calculate Unit price in DONUT from LP reserves
        if (auction != address(0)) {
            address lpToken = IAuction(auction).paymentToken();
            uint256 donutInLP = IERC20(donut).balanceOf(lpToken);
            uint256 unitInLP = IERC20(unitToken).balanceOf(lpToken);
            state.unitPrice = unitInLP == 0 ? 0 : donutInLP * 1e18 / unitInLP;
        }

        // Rig metadata
        state.rigUri = IFundRig(rig).uri();

        // User balances
        address paymentToken = IFundRig(rig).paymentToken();
        state.accountPaymentTokenBalance = account == address(0) ? 0 : IERC20(paymentToken).balanceOf(account);
        state.accountDonutBalance = account == address(0) ? 0 : IERC20(donut).balanceOf(account);
        state.accountUnitBalance = account == address(0) ? 0 : IERC20(unitToken).balanceOf(account);
        state.accountTodayDonation = account == address(0) ? 0 : IFundRig(rig).getUserDonation(day, account);

        return state;
    }

    /**
     * @notice Get claimable days for a user within a range.
     * @param rig Rig contract address
     * @param account User address
     * @param startDay First day to check (inclusive)
     * @param endDay Last day to check (exclusive)
     * @return claimableDays Array of claimable day info
     */
    function getClaimableDays(
        address rig,
        address account,
        uint256 startDay,
        uint256 endDay
    ) external view returns (ClaimableDay[] memory claimableDays) {
        if (endDay <= startDay) {
            return new ClaimableDay[](0);
        }

        uint256 count = endDay - startDay;
        claimableDays = new ClaimableDay[](count);

        for (uint256 i = 0; i < count;) {
            uint256 day = startDay + i;
            claimableDays[i] = ClaimableDay({
                day: day,
                donation: IFundRig(rig).dayAccountToDonation(day, account),
                pendingReward: IFundRig(rig).getPendingReward(day, account),
                hasClaimed: IFundRig(rig).dayAccountToHasClaimed(day, account)
            });
            unchecked { ++i; }
        }

        return claimableDays;
    }

    /**
     * @notice Get total pending rewards across a range of days.
     * @param rig Rig contract address
     * @param account User address
     * @param startDay First day to check (inclusive)
     * @param endDay Last day to check (exclusive)
     * @return totalPending Total unclaimed Unit tokens across all checked days
     * @return unclaimedDays Array of day numbers that have unclaimed rewards
     */
    function getTotalPendingRewards(
        address rig,
        address account,
        uint256 startDay,
        uint256 endDay
    ) external view returns (uint256 totalPending, uint256[] memory unclaimedDays) {
        if (endDay <= startDay) {
            return (0, new uint256[](0));
        }

        // First pass: count unclaimed days
        uint256 unclaimedCount = 0;
        for (uint256 day = startDay; day < endDay;) {
            uint256 pending = IFundRig(rig).getPendingReward(day, account);
            if (pending > 0) {
                totalPending += pending;
                unclaimedCount++;
            }
            unchecked { ++day; }
        }

        // Second pass: collect unclaimed day numbers
        unclaimedDays = new uint256[](unclaimedCount);
        uint256 index = 0;
        for (uint256 day = startDay; day < endDay;) {
            if (IFundRig(rig).getPendingReward(day, account) > 0) {
                unclaimedDays[index] = day;
                unchecked { ++index; }
            }
            unchecked { ++day; }
        }

        return (totalPending, unclaimedDays);
    }

    /**
     * @notice Get emission schedule for upcoming days.
     * @param rig Rig contract address
     * @param numDays Number of days to project
     * @return emissions Array of daily emissions starting from current day
     */
    function getEmissionSchedule(address rig, uint256 numDays)
        external
        view
        returns (uint256[] memory emissions)
    {
        uint256 currentDay = IFundRig(rig).currentDay();
        emissions = new uint256[](numDays);

        for (uint256 i = 0; i < numDays;) {
            emissions[i] = IFundRig(rig).getDayEmission(currentDay + i);
            unchecked { ++i; }
        }

        return emissions;
    }

    /**
     * @notice Check if an address is a whitelisted fund recipient.
     * @param rig Rig contract address
     * @param recipient Address to check
     * @return isRecipient True if recipient is whitelisted
     */
    function isRecipient(address rig, address recipient) external view returns (bool) {
        return IFundRig(rig).accountToIsRecipient(recipient);
    }

    /**
     * @notice Get aggregated state for an Auction and user balances.
     * @param rig Rig contract address (used to look up auction)
     * @param account User address (or address(0) to skip balance queries)
     * @return state Aggregated auction state
     */
    function getAuction(address rig, address account) external view returns (AuctionState memory state) {
        address auction = IFundCore(core).rigToAuction(rig);

        state.epochId = IAuction(auction).epochId();
        state.initPrice = IAuction(auction).initPrice();
        state.startTime = IAuction(auction).startTime();
        state.paymentToken = IAuction(auction).paymentToken();
        state.price = IAuction(auction).getPrice();

        // LP price in DONUT = (DONUT in LP * 2) / LP total supply
        uint256 lpTotalSupply = IERC20(state.paymentToken).totalSupply();
        state.paymentTokenPrice =
            lpTotalSupply == 0 ? 0 : IERC20(donut).balanceOf(state.paymentToken) * 2e18 / lpTotalSupply;

        address paymentToken = IFundRig(rig).paymentToken();
        state.quoteAccumulated = IERC20(paymentToken).balanceOf(auction);
        state.accountQuoteBalance = account == address(0) ? 0 : IERC20(paymentToken).balanceOf(account);
        state.accountPaymentTokenBalance = account == address(0) ? 0 : IERC20(state.paymentToken).balanceOf(account);

        return state;
    }
}
