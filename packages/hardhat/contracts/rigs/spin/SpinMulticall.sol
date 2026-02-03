// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISpinRig} from "./interfaces/ISpinRig.sol";
import {ISpinCore} from "./interfaces/ISpinCore.sol";
import {IAuction} from "../../interfaces/IAuction.sol";

/**
 * @title SpinMulticall
 * @author heesho
 * @notice Helper contract for batched operations and aggregated view functions for SpinRig.
 * @dev Provides spin operations with entropy fee handling,
 *      and comprehensive state queries for Rigs and Auctions.
 *      Quote token is read from each rig - users must approve this contract for the rig's quote token.
 *      ETH is needed for entropy fees.
 */
contract SpinMulticall {
    using SafeERC20 for IERC20;

    /*----------  ERRORS  -----------------------------------------------*/

    error SpinMulticall__ZeroAddress();
    error SpinMulticall__InvalidRig();
    error SpinMulticall__InsufficientETH();
    error SpinMulticall__ExcessETH();

    /*----------  IMMUTABLES  -------------------------------------------*/

    address public immutable core;
    address public immutable usdc;

    /*----------  STRUCTS  ----------------------------------------------*/

    /**
     * @notice Aggregated state for a SpinRig.
     */
    struct RigState {
        // Rig state
        uint256 epochId;
        uint256 initPrice;
        uint256 spinStartTime;
        uint256 price;
        uint256 ups;
        uint256 prizePool;
        uint256 pendingEmissions;
        uint256 entropyFee;
        // Global rig state
        uint256 unitPrice;
        string rigUri;
        // User balances
        uint256 accountQuoteBalance;
        uint256 accountUsdcBalance;
        uint256 accountUnitBalance;
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
     * @param _core SpinCore contract address
     * @param _usdc USDC token address
     */
    constructor(address _core, address _usdc) {
        if (_core == address(0) || _usdc == address(0)) revert SpinMulticall__ZeroAddress();
        core = _core;
        usdc = _usdc;
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Spin on a rig using the rig's quote token.
     * @dev User must approve the rig's quote token to this contract. ETH needed for entropy fee.
     * @param rig Rig contract address
     * @param epochId Expected epoch ID
     * @param deadline Transaction deadline
     * @param maxPrice Maximum quote token price willing to pay
     */
    function spin(
        address rig,
        uint256 epochId,
        uint256 deadline,
        uint256 maxPrice
    ) external payable {
        if (!ISpinCore(core).rigToIsRig(rig)) revert SpinMulticall__InvalidRig();

        // Calculate entropy fee (only required when entropy is enabled)
        uint256 entropyFee = ISpinRig(rig).entropyEnabled() ? ISpinRig(rig).getEntropyFee() : 0;
        if (msg.value < entropyFee) revert SpinMulticall__InsufficientETH();
        if (msg.value > entropyFee) revert SpinMulticall__ExcessETH();

        // Get quote token and current price
        address quoteToken = ISpinRig(rig).quote();
        uint256 price = ISpinRig(rig).getPrice();
        if (price > 0) {
            IERC20(quoteToken).safeTransferFrom(msg.sender, address(this), price);
            IERC20(quoteToken).safeApprove(rig, 0);
            IERC20(quoteToken).safeApprove(rig, price);
        }

        // Spin with entropy fee forwarded
        ISpinRig(rig).spin{value: entropyFee}(msg.sender, epochId, deadline, maxPrice);

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
        if (!ISpinCore(core).rigToIsRig(rig)) revert SpinMulticall__InvalidRig();
        address auction = ISpinCore(core).rigToAuction(rig);
        address paymentToken = IAuction(auction).paymentToken();
        uint256 price = IAuction(auction).getPrice();
        address[] memory assets = new address[](1);
        assets[0] = ISpinRig(rig).quote();

        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), price);
        IERC20(paymentToken).safeApprove(auction, 0);
        IERC20(paymentToken).safeApprove(auction, price);
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
    function launch(ISpinCore.LaunchParams calldata params)
        external
        returns (address unit, address rig, address auction, address lpToken)
    {
        // Transfer USDC from user
        IERC20(usdc).safeTransferFrom(msg.sender, address(this), params.usdcAmount);
        IERC20(usdc).safeApprove(core, 0);
        IERC20(usdc).safeApprove(core, params.usdcAmount);

        // Build params with msg.sender as launcher
        ISpinCore.LaunchParams memory launchParams = ISpinCore.LaunchParams({
            launcher: msg.sender,
            quoteToken: params.quoteToken,
            tokenName: params.tokenName,
            tokenSymbol: params.tokenSymbol,
            uri: params.uri,
            usdcAmount: params.usdcAmount,
            unitAmount: params.unitAmount,
            initialUps: params.initialUps,
            tailUps: params.tailUps,
            halvingPeriod: params.halvingPeriod,
            rigEpochPeriod: params.rigEpochPeriod,
            rigPriceMultiplier: params.rigPriceMultiplier,
            rigMinInitPrice: params.rigMinInitPrice,
            odds: params.odds,
            auctionInitPrice: params.auctionInitPrice,
            auctionEpochPeriod: params.auctionEpochPeriod,
            auctionPriceMultiplier: params.auctionPriceMultiplier,
            auctionMinInitPrice: params.auctionMinInitPrice
        });

        return ISpinCore(core).launch(launchParams);
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Get aggregated state for a SpinRig and user balances.
     * @param rig Rig contract address
     * @param account User address (or address(0) to skip balance queries)
     * @return state Aggregated rig state
     */
    function getRig(address rig, address account) external view returns (RigState memory state) {
        state.epochId = ISpinRig(rig).epochId();
        state.initPrice = ISpinRig(rig).initPrice();
        state.spinStartTime = ISpinRig(rig).spinStartTime();
        state.price = ISpinRig(rig).getPrice();
        state.ups = ISpinRig(rig).getUps();
        state.prizePool = ISpinRig(rig).getPrizePool();
        state.pendingEmissions = ISpinRig(rig).getPendingEmissions();
        state.entropyFee = ISpinRig(rig).getEntropyFee();

        address unitToken = ISpinRig(rig).unit();

        // Calculate Unit price in USDC from LP reserves
        // USDC has 6 decimals, Unit has 18. Multiply by 1e30 (= 1e12 normalization * 1e18 precision)
        address lpToken = ISpinCore(core).rigToLP(rig);
        if (lpToken != address(0)) {
            uint256 usdcInLP = IERC20(usdc).balanceOf(lpToken);
            uint256 unitInLP = IERC20(unitToken).balanceOf(lpToken);
            state.unitPrice = unitInLP == 0 ? 0 : usdcInLP * 1e30 / unitInLP;
        }

        // Rig metadata
        state.rigUri = ISpinRig(rig).uri();

        // User balances
        address quoteToken = ISpinRig(rig).quote();
        state.accountQuoteBalance = account == address(0) ? 0 : IERC20(quoteToken).balanceOf(account);
        state.accountUsdcBalance = account == address(0) ? 0 : IERC20(usdc).balanceOf(account);
        state.accountUnitBalance = account == address(0) ? 0 : IERC20(unitToken).balanceOf(account);

        return state;
    }

    /**
     * @notice Get aggregated state for an Auction and user balances.
     * @param rig Rig contract address (used to look up auction)
     * @param account User address (or address(0) to skip balance queries)
     * @return state Aggregated auction state
     */
    function getAuction(address rig, address account) external view returns (AuctionState memory state) {
        address auction = ISpinCore(core).rigToAuction(rig);

        state.epochId = IAuction(auction).epochId();
        state.initPrice = IAuction(auction).initPrice();
        state.startTime = IAuction(auction).startTime();
        state.paymentToken = IAuction(auction).paymentToken();
        state.price = IAuction(auction).getPrice();

        // LP price in USDC = (USDC in LP * 2) / LP total supply
        // USDC has 6 decimals, LP has 18. Multiply by 2e30 (= 2 * 1e12 normalization * 1e18 precision)
        uint256 lpTotalSupply = IERC20(state.paymentToken).totalSupply();
        state.paymentTokenPrice =
            lpTotalSupply == 0 ? 0 : IERC20(usdc).balanceOf(state.paymentToken) * 2e30 / lpTotalSupply;

        address quoteToken = ISpinRig(rig).quote();
        state.quoteAccumulated = IERC20(quoteToken).balanceOf(auction);
        state.accountQuoteBalance = account == address(0) ? 0 : IERC20(quoteToken).balanceOf(account);
        state.accountPaymentTokenBalance = account == address(0) ? 0 : IERC20(state.paymentToken).balanceOf(account);

        return state;
    }

    /**
     * @notice Get the odds array for a SpinRig.
     * @param rig Rig contract address
     * @return odds Array of odds in basis points
     */
    function getOdds(address rig) external view returns (uint256[] memory) {
        return ISpinRig(rig).getOdds();
    }

    /**
     * @notice Get the entropy fee for a SpinRig.
     * @param rig Rig contract address
     * @return fee Entropy fee in wei
     */
    function getEntropyFee(address rig) external view returns (uint256) {
        return ISpinRig(rig).getEntropyFee();
    }
}
