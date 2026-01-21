// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IContentRig} from "./interfaces/IContentRig.sol";
import {IContentCore} from "./interfaces/IContentCore.sol";
import {IRewarder} from "./interfaces/IRewarder.sol";
import {IMinter} from "./interfaces/IMinter.sol";
import {IAuction} from "../../interfaces/IAuction.sol";

/**
 * @title ContentMulticall
 * @author heesho
 * @notice Helper contract for batched operations and aggregated view functions for ContentRig.
 * @dev Provides content collection, reward claiming, and comprehensive state queries.
 *      Quote token is read from each rig - users must approve this contract for the rig's quote token.
 */
contract ContentMulticall {
    using SafeERC20 for IERC20;

    /*----------  ERRORS  -----------------------------------------------*/

    error ContentMulticall__ZeroAddress();
    error ContentMulticall__InvalidRig();
    error ContentMulticall__ArrayLengthMismatch();

    /*----------  IMMUTABLES  -------------------------------------------*/

    address public immutable core;
    address public immutable donut;

    /*----------  STRUCTS  ----------------------------------------------*/

    /**
     * @notice Aggregated state for a ContentRig (Unit ecosystem).
     */
    struct RigState {
        // Registry data
        address unit;
        address minter;
        address rewarder;
        address auction;
        address lp;
        address launcher;
        // Content state
        string uri;
        bool isModerated;
        uint256 totalSupply;
        // Global metrics
        uint256 unitPrice;
        uint256 marketCapInDonut;
        uint256 liquidityInDonut;
        uint256 weeklyEmission;
        // User state
        uint256 accountQuoteBalance;
        uint256 accountDonutBalance;
        uint256 accountUnitBalance;
        uint256 accountContentOwned;
        uint256 accountContentStaked;
        uint256 accountUnitEarned;
        uint256 accountClaimable;
        bool accountIsModerator;
    }

    /**
     * @notice State for a single content token.
     */
    struct ContentState {
        uint256 tokenId;
        uint256 epochId;
        uint256 startTime;
        uint256 initPrice;
        uint256 stake;
        uint256 price;
        uint256 rewardForDuration;
        address creator;
        address owner;
        string uri;
        bool isApproved;
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
     * @param _core ContentCore contract address
     * @param _donut DONUT token address
     */
    constructor(address _core, address _donut) {
        if (_core == address(0) || _donut == address(0)) revert ContentMulticall__ZeroAddress();
        core = _core;
        donut = _donut;
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Collect content using quote token.
     * @dev User must approve quote token to this contract. Refunds excess.
     * @param rig ContentRig contract address
     * @param tokenId Token ID to collect
     * @param epochId Expected epoch ID
     * @param deadline Transaction deadline
     * @param maxPrice Maximum price willing to pay
     */
    function collect(
        address rig,
        uint256 tokenId,
        uint256 epochId,
        uint256 deadline,
        uint256 maxPrice
    ) external {
        if (!IContentCore(core).isDeployedRig(rig)) revert ContentMulticall__InvalidRig();

        // Get previous owner for auto-claim
        address prevOwner = IContentRig(rig).ownerOf(tokenId);

        address quoteToken = IContentRig(rig).quote();
        IERC20(quoteToken).safeTransferFrom(msg.sender, address(this), maxPrice);
        IERC20(quoteToken).safeApprove(rig, 0);
        IERC20(quoteToken).safeApprove(rig, maxPrice);
        IContentRig(rig).collect(msg.sender, tokenId, epochId, deadline, maxPrice);

        // Auto-claim for previous owner (best effort - won't block collection if claim fails)
        if (prevOwner != address(0) && IContentRig(rig).accountToClaimable(prevOwner) > 0) {
            try IContentRig(rig).claim(prevOwner) {} catch {}
        }

        // Refund unused quote tokens (in case price changed)
        uint256 quoteBalance = IERC20(quoteToken).balanceOf(address(this));
        if (quoteBalance > 0) {
            IERC20(quoteToken).safeTransfer(msg.sender, quoteBalance);
        }
    }

    /**
     * @notice Claim quote token fees from a ContentRig.
     * @param rig ContentRig contract address
     * @param account Account to claim for
     */
    function claimFees(address rig, address account) external {
        if (!IContentCore(core).isDeployedRig(rig)) revert ContentMulticall__InvalidRig();
        IContentRig(rig).claim(account);
    }

    /**
     * @notice Claim staking rewards from the Rewarder.
     * @param rig ContentRig contract address
     * @param account Account to claim for
     */
    function claimRewards(address rig, address account) external {
        if (!IContentCore(core).isDeployedRig(rig)) revert ContentMulticall__InvalidRig();
        address rewarder = IContentCore(core).rigToRewarder(rig);
        IRewarder(rewarder).getReward(account);
    }

    /**
     * @notice Update the minter period (trigger weekly emission).
     * @param rig ContentRig contract address
     */
    function updateMinterPeriod(address rig) external {
        if (!IContentCore(core).isDeployedRig(rig)) revert ContentMulticall__InvalidRig();
        address minter = IContentCore(core).rigToMinter(rig);
        IMinter(minter).updatePeriod();
    }

    /**
     * @notice Buy from an auction using LP tokens.
     * @dev Transfers LP tokens from caller, approves auction, and executes buy.
     * @param rig ContentRig contract address (used to look up auction)
     * @param epochId Expected epoch ID
     * @param deadline Transaction deadline
     * @param maxPaymentTokenAmount Maximum LP tokens willing to pay
     */
    function buy(address rig, uint256 epochId, uint256 deadline, uint256 maxPaymentTokenAmount) external {
        if (!IContentCore(core).isDeployedRig(rig)) revert ContentMulticall__InvalidRig();
        address auction = IContentCore(core).rigToAuction(rig);
        address lpToken = IAuction(auction).paymentToken();
        uint256 price = IAuction(auction).getPrice();
        address[] memory assets = new address[](1);
        assets[0] = IContentRig(rig).quote();

        IERC20(lpToken).safeTransferFrom(msg.sender, address(this), price);
        IERC20(lpToken).safeApprove(auction, 0);
        IERC20(lpToken).safeApprove(auction, price);
        IAuction(auction).buy(assets, msg.sender, epochId, deadline, maxPaymentTokenAmount);
    }

    /**
     * @notice Launch a new ContentRig via Core.
     * @dev Transfers DONUT from caller, approves Core, and calls launch with caller as launcher.
     * @param params Launch parameters (launcher field is overwritten with msg.sender)
     * @return unit Address of deployed Unit token
     * @return content Address of deployed ContentRig contract
     * @return minter Address of deployed Minter contract
     * @return rewarder Address of deployed Rewarder contract
     * @return auction Address of deployed Auction contract
     * @return lpToken Address of Unit/DONUT LP token
     */
    function launch(IContentCore.LaunchParams calldata params)
        external
        returns (
            address unit,
            address content,
            address minter,
            address rewarder,
            address auction,
            address lpToken
        )
    {
        // Transfer DONUT from user
        IERC20(donut).safeTransferFrom(msg.sender, address(this), params.donutAmount);
        IERC20(donut).safeApprove(core, 0);
        IERC20(donut).safeApprove(core, params.donutAmount);

        // Build params with msg.sender as launcher
        IContentCore.LaunchParams memory launchParams = IContentCore.LaunchParams({
            launcher: msg.sender,
            tokenName: params.tokenName,
            tokenSymbol: params.tokenSymbol,
            uri: params.uri,
            donutAmount: params.donutAmount,
            unitAmount: params.unitAmount,
            initialUps: params.initialUps,
            tailUps: params.tailUps,
            halvingPeriod: params.halvingPeriod,
            contentMinInitPrice: params.contentMinInitPrice,
            contentIsModerated: params.contentIsModerated,
            auctionInitPrice: params.auctionInitPrice,
            auctionEpochPeriod: params.auctionEpochPeriod,
            auctionPriceMultiplier: params.auctionPriceMultiplier,
            auctionMinInitPrice: params.auctionMinInitPrice
        });

        return IContentCore(core).launch(launchParams);
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Get aggregated state for a ContentRig (Unit ecosystem).
     * @param rig ContentRig contract address
     * @param account User address (or address(0) to skip balance queries)
     * @return state Aggregated rig state
     */
    function getRig(address rig, address account) external view returns (RigState memory state) {
        // Registry data
        state.unit = IContentCore(core).rigToUnit(rig);
        state.minter = IContentCore(core).rigToMinter(rig);
        state.rewarder = IContentCore(core).rigToRewarder(rig);
        state.auction = IContentCore(core).rigToAuction(rig);
        state.lp = IContentCore(core).rigToLP(rig);
        state.launcher = IContentCore(core).rigToLauncher(rig);

        // Content state
        state.uri = IContentRig(rig).uri();
        state.isModerated = IContentRig(rig).isModerated();
        state.totalSupply = IContentRig(rig).totalSupply();

        // Calculate Unit price, market cap, and liquidity in DONUT from LP reserves
        if (state.lp != address(0)) {
            uint256 donutInLP = IERC20(donut).balanceOf(state.lp);
            uint256 unitInLP = IERC20(state.unit).balanceOf(state.lp);
            state.unitPrice = unitInLP == 0 ? 0 : donutInLP * 1e18 / unitInLP;
            state.liquidityInDonut = donutInLP * 2;

            // Market cap = total unit supply * unit price in DONUT
            uint256 unitTotalSupply = IERC20(state.unit).totalSupply();
            state.marketCapInDonut = unitTotalSupply * state.unitPrice / 1e18;
        }

        // Weekly emission (Unit tokens to content stakers)
        state.weeklyEmission = IRewarder(state.rewarder).getRewardForDuration(state.unit);

        // User state
        if (account != address(0)) {
            address quoteToken = IContentRig(rig).quote();
            state.accountQuoteBalance = IERC20(quoteToken).balanceOf(account);
            state.accountDonutBalance = IERC20(donut).balanceOf(account);
            state.accountUnitBalance = IERC20(state.unit).balanceOf(account);
            state.accountContentOwned = IContentRig(rig).balanceOf(account);
            state.accountContentStaked = IRewarder(state.rewarder).accountToBalance(account);
            state.accountUnitEarned = IRewarder(state.rewarder).earned(account, state.unit);
            state.accountClaimable = IContentRig(rig).accountToClaimable(account);
            state.accountIsModerator =
                IContentRig(rig).owner() == account || IContentRig(rig).accountToIsModerator(account);
        }

        return state;
    }

    /**
     * @notice Get state for a specific content token.
     * @param rig ContentRig contract address
     * @param tokenId Token ID
     * @return state Content token state
     */
    function getContent(address rig, uint256 tokenId) external view returns (ContentState memory state) {
        address rewarder = IContentRig(rig).rewarder();
        address unitToken = IContentRig(rig).unit();

        state.tokenId = tokenId;
        state.epochId = IContentRig(rig).tokenIdToEpochId(tokenId);
        state.startTime = IContentRig(rig).tokenIdToStartTime(tokenId);
        state.initPrice = IContentRig(rig).tokenIdToInitPrice(tokenId);
        state.stake = IContentRig(rig).tokenIdToStake(tokenId);
        state.price = IContentRig(rig).getPrice(tokenId);
        state.creator = IContentRig(rig).tokenIdToCreator(tokenId);
        state.owner = IContentRig(rig).ownerOf(tokenId);
        state.uri = IContentRig(rig).tokenURI(tokenId);
        state.isApproved = IContentRig(rig).tokenIdToApproved(tokenId);

        // Calculate this content's share of weekly rewards
        uint256 totalStaked = IRewarder(rewarder).totalSupply();
        uint256 totalRewardForDuration = IRewarder(rewarder).getRewardForDuration(unitToken);
        state.rewardForDuration = totalStaked == 0 ? 0 : totalRewardForDuration * state.stake / totalStaked;

        return state;
    }

    /**
     * @notice Get state for multiple content tokens.
     * @param rig ContentRig contract address
     * @param tokenIds Array of token IDs
     * @return states Array of content token states
     */
    function getContentMultiple(
        address rig,
        uint256[] calldata tokenIds
    ) external view returns (ContentState[] memory states) {
        uint256 length = tokenIds.length;
        states = new ContentState[](length);
        for (uint256 i = 0; i < length;) {
            states[i] = this.getContent(rig, tokenIds[i]);
            unchecked { ++i; }
        }
        return states;
    }

    /**
     * @notice Get aggregated state for an Auction and user balances.
     * @param rig ContentRig contract address (used to look up auction)
     * @param account User address (or address(0) to skip balance queries)
     * @return state Aggregated auction state
     */
    function getAuction(address rig, address account) external view returns (AuctionState memory state) {
        address auction = IContentCore(core).rigToAuction(rig);

        state.epochId = IAuction(auction).epochId();
        state.initPrice = IAuction(auction).initPrice();
        state.startTime = IAuction(auction).startTime();
        state.paymentToken = IAuction(auction).paymentToken();
        state.price = IAuction(auction).getPrice();

        // LP price in DONUT = (DONUT in LP * 2) / LP total supply
        uint256 lpTotalSupply = IERC20(state.paymentToken).totalSupply();
        state.paymentTokenPrice =
            lpTotalSupply == 0 ? 0 : IERC20(donut).balanceOf(state.paymentToken) * 2e18 / lpTotalSupply;

        address quoteToken = IContentRig(rig).quote();
        state.quoteAccumulated = IERC20(quoteToken).balanceOf(auction);
        state.accountQuoteBalance = account == address(0) ? 0 : IERC20(quoteToken).balanceOf(account);
        state.accountPaymentTokenBalance = account == address(0) ? 0 : IERC20(state.paymentToken).balanceOf(account);

        return state;
    }
}
