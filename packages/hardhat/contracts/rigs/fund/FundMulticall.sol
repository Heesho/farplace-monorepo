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
    error FundMulticall__EmptyArray();

    /*----------  IMMUTABLES  -------------------------------------------*/

    address public immutable core;
    address public immutable usdc;

    /*----------  STRUCTS  ----------------------------------------------*/

    /**
     * @notice Aggregated state for a FundRig.
     */
    struct RigState {
        // Rig state
        uint256 currentEpoch;
        uint256 currentEpochEmission;
        uint256 currentEpochTotalDonated;
        uint256 startTime;
        address recipient;
        address treasury;
        address team;
        // Global rig state
        uint256 unitPrice;
        string rigUri;
        // User balances
        uint256 accountQuoteBalance;
        uint256 accountUsdcBalance;
        uint256 accountUnitBalance;
        uint256 accountCurrentEpochDonation;
    }

    /**
     * @notice Claimable epoch info for a user.
     */
    struct ClaimableEpoch {
        uint256 epoch;
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
        address lpToken;
        uint256 price;
        uint256 lpTokenPrice;
        uint256 quoteAccumulated;
        uint256 accountQuoteBalance;
        uint256 accountLpTokenBalance;
    }

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    /**
     * @notice Deploy the Multicall helper contract.
     * @param _core FundCore contract address
     * @param _usdc USDC token address
     */
    constructor(address _core, address _usdc) {
        if (_core == address(0) || _usdc == address(0)) revert FundMulticall__ZeroAddress();
        core = _core;
        usdc = _usdc;
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Fund a rig using the rig's payment token.
     * @dev User must approve the payment token to this contract.
     * @param rig Rig contract address
     * @param account The account to credit for this funding
     * @param amount The amount of payment tokens to fund
     */
    function fund(
        address rig,
        address account,
        uint256 amount,
        string calldata _uri
    ) external {
        if (!IFundCore(core).rigToIsRig(rig)) revert FundMulticall__InvalidRig();

        address quoteToken = IFundRig(rig).quote();
        IERC20(quoteToken).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(quoteToken).safeApprove(rig, 0);
        IERC20(quoteToken).safeApprove(rig, amount);
        IFundRig(rig).fund(account, amount, _uri);
    }

    /**
     * @notice Claim rewards for a single epoch.
     * @param rig Rig contract address
     * @param account The account to claim for
     * @param epoch The epoch to claim
     */
    function claim(address rig, address account, uint256 epoch) external {
        if (!IFundCore(core).rigToIsRig(rig)) revert FundMulticall__InvalidRig();
        IFundRig(rig).claim(account, epoch);
    }

    /**
     * @notice Claim rewards for multiple epochs in a single transaction.
     * @dev Skips epochs that are already claimed, have no donation, or haven't ended.
     * @param rig Rig contract address
     * @param account The account to claim for
     * @param epochIds Array of epochs to claim
     */
    function claimMultiple(address rig, address account, uint256[] calldata epochIds) external {
        if (!IFundCore(core).rigToIsRig(rig)) revert FundMulticall__InvalidRig();
        uint256 length = epochIds.length;
        if (length == 0) revert FundMulticall__EmptyArray();

        uint256 currentEpoch = IFundRig(rig).currentEpoch();
        for (uint256 i = 0; i < length;) {
            // Skip if already claimed, no donation, or epoch hasn't ended
            if (
                !IFundRig(rig).epochAccountToHasClaimed(epochIds[i], account) &&
                IFundRig(rig).epochAccountToDonation(epochIds[i], account) > 0 &&
                epochIds[i] < currentEpoch
            ) {
                IFundRig(rig).claim(account, epochIds[i]);
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
        if (!IFundCore(core).rigToIsRig(rig)) revert FundMulticall__InvalidRig();
        address auction = IFundCore(core).rigToAuction(rig);
        address lpToken = IAuction(auction).paymentToken();
        uint256 price = IAuction(auction).getPrice();
        address[] memory assets = new address[](1);
        assets[0] = IFundRig(rig).quote();

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
    function launch(IFundCore.LaunchParams calldata params)
        external
        returns (address unit, address rig, address auction, address lpToken)
    {
        // Transfer USDC from user
        IERC20(usdc).safeTransferFrom(msg.sender, address(this), params.usdcAmount);
        IERC20(usdc).safeApprove(core, 0);
        IERC20(usdc).safeApprove(core, params.usdcAmount);

        // Build params with msg.sender as launcher
        IFundCore.LaunchParams memory launchParams = IFundCore.LaunchParams({
            launcher: msg.sender,
            quoteToken: params.quoteToken,
            recipient: params.recipient,
            tokenName: params.tokenName,
            tokenSymbol: params.tokenSymbol,
            uri: params.uri,
            usdcAmount: params.usdcAmount,
            unitAmount: params.unitAmount,
            initialEmission: params.initialEmission,
            minEmission: params.minEmission,
            halvingPeriod: params.halvingPeriod,
            epochDuration: params.epochDuration,
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
        uint256 epoch = IFundRig(rig).currentEpoch();

        state.currentEpoch = epoch;
        state.currentEpochEmission = IFundRig(rig).getEpochEmission(epoch);
        state.currentEpochTotalDonated = IFundRig(rig).epochToTotalDonated(epoch);
        state.startTime = IFundRig(rig).startTime();
        state.recipient = IFundRig(rig).recipient();
        state.treasury = IFundRig(rig).treasury();
        state.team = IFundRig(rig).team();

        address unitToken = IFundRig(rig).unit();

        // Calculate Unit price in USDC from LP reserves
        // USDC has 6 decimals, Unit has 18. Multiply by 1e30 (= 1e12 normalization * 1e18 precision)
        address lpToken = IFundCore(core).rigToLP(rig);
        if (lpToken != address(0)) {
            uint256 usdcInLP = IERC20(usdc).balanceOf(lpToken);
            uint256 unitInLP = IERC20(unitToken).balanceOf(lpToken);
            state.unitPrice = unitInLP == 0 ? 0 : usdcInLP * 1e30 / unitInLP;
        }

        // Rig metadata
        state.rigUri = IFundRig(rig).uri();

        // User balances
        address quoteToken = IFundRig(rig).quote();
        state.accountQuoteBalance = account == address(0) ? 0 : IERC20(quoteToken).balanceOf(account);
        state.accountUsdcBalance = account == address(0) ? 0 : IERC20(usdc).balanceOf(account);
        state.accountUnitBalance = account == address(0) ? 0 : IERC20(unitToken).balanceOf(account);
        state.accountCurrentEpochDonation = account == address(0) ? 0 : IFundRig(rig).epochAccountToDonation(epoch, account);

        return state;
    }

    /**
     * @notice Get claimable epochs for a user within a range.
     * @param rig Rig contract address
     * @param account User address
     * @param startEpoch First epoch to check (inclusive)
     * @param endEpoch Last epoch to check (exclusive)
     * @return claimableEpochs Array of claimable epoch info
     */
    function getClaimableEpochs(
        address rig,
        address account,
        uint256 startEpoch,
        uint256 endEpoch
    ) external view returns (ClaimableEpoch[] memory claimableEpochs) {
        if (endEpoch <= startEpoch) {
            return new ClaimableEpoch[](0);
        }

        uint256 count = endEpoch - startEpoch;
        claimableEpochs = new ClaimableEpoch[](count);

        for (uint256 i = 0; i < count;) {
            uint256 epoch = startEpoch + i;
            claimableEpochs[i] = ClaimableEpoch({
                epoch: epoch,
                donation: IFundRig(rig).epochAccountToDonation(epoch, account),
                pendingReward: IFundRig(rig).getPendingReward(epoch, account),
                hasClaimed: IFundRig(rig).epochAccountToHasClaimed(epoch, account)
            });
            unchecked { ++i; }
        }

        return claimableEpochs;
    }

    /**
     * @notice Get total pending rewards across a range of epochs.
     * @param rig Rig contract address
     * @param account User address
     * @param startEpoch First epoch to check (inclusive)
     * @param endEpoch Last epoch to check (exclusive)
     * @return totalPending Total unclaimed Unit tokens across all checked epochs
     * @return unclaimedEpochs Array of epoch numbers that have unclaimed rewards
     */
    function getTotalPendingRewards(
        address rig,
        address account,
        uint256 startEpoch,
        uint256 endEpoch
    ) external view returns (uint256 totalPending, uint256[] memory unclaimedEpochs) {
        if (endEpoch <= startEpoch) {
            return (0, new uint256[](0));
        }

        // First pass: count unclaimed epochs
        uint256 unclaimedCount = 0;
        for (uint256 epoch = startEpoch; epoch < endEpoch;) {
            uint256 pending = IFundRig(rig).getPendingReward(epoch, account);
            if (pending > 0) {
                totalPending += pending;
                unclaimedCount++;
            }
            unchecked { ++epoch; }
        }

        // Second pass: collect unclaimed epoch numbers
        unclaimedEpochs = new uint256[](unclaimedCount);
        uint256 index = 0;
        for (uint256 epoch = startEpoch; epoch < endEpoch;) {
            if (IFundRig(rig).getPendingReward(epoch, account) > 0) {
                unclaimedEpochs[index] = epoch;
                unchecked { ++index; }
            }
            unchecked { ++epoch; }
        }

        return (totalPending, unclaimedEpochs);
    }

    /**
     * @notice Get emission schedule for upcoming epochs.
     * @param rig Rig contract address
     * @param numEpochs Number of epochs to project
     * @return emissions Array of epoch emissions starting from current epoch
     */
    function getEmissionSchedule(address rig, uint256 numEpochs)
        external
        view
        returns (uint256[] memory emissions)
    {
        uint256 currentEpoch = IFundRig(rig).currentEpoch();
        emissions = new uint256[](numEpochs);

        for (uint256 i = 0; i < numEpochs;) {
            emissions[i] = IFundRig(rig).getEpochEmission(currentEpoch + i);
            unchecked { ++i; }
        }

        return emissions;
    }

    /**
     * @notice Get the recipient address for a FundRig.
     * @param rig Rig contract address
     * @return recipient The recipient address that receives 50% of donations
     */
    function getRecipient(address rig) external view returns (address) {
        return IFundRig(rig).recipient();
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
        state.lpToken = IAuction(auction).paymentToken();
        state.price = IAuction(auction).getPrice();

        // LP price in USDC = (USDC in LP * 2) / LP total supply
        // USDC has 6 decimals, LP has 18. Multiply by 2e30 (= 2 * 1e12 normalization * 1e18 precision)
        uint256 lpTotalSupply = IERC20(state.lpToken).totalSupply();
        state.lpTokenPrice =
            lpTotalSupply == 0 ? 0 : IERC20(usdc).balanceOf(state.lpToken) * 2e30 / lpTotalSupply;

        address quoteToken = IFundRig(rig).quote();
        state.quoteAccumulated = IERC20(quoteToken).balanceOf(auction);
        state.accountQuoteBalance = account == address(0) ? 0 : IERC20(quoteToken).balanceOf(account);
        state.accountLpTokenBalance = account == address(0) ? 0 : IERC20(state.lpToken).balanceOf(account);

        return state;
    }
}
