// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IFundRig} from "./interfaces/IFundRig.sol";
import {IFundRigFactory} from "./interfaces/IFundRigFactory.sol";
import {IUnit} from "../../interfaces/IUnit.sol";
import {IUnitFactory} from "../../interfaces/IUnitFactory.sol";
import {IAuctionFactory} from "../../interfaces/IAuctionFactory.sol";
import {IUniswapV2Factory, IUniswapV2Router} from "../../interfaces/IUniswapV2.sol";
import {IRegistry} from "../../interfaces/IRegistry.sol";

/**
 * @title FundCore
 * @author heesho
 * @notice The launchpad contract for deploying new FundRig instances.
 *         Users provide USDC tokens to launch a new donation-based token distribution.
 *         The FundCore contract:
 *         1. Deploys a new Unit token via UnitFactory
 *         2. Mints initial Unit tokens for liquidity
 *         3. Creates a Unit/USDC liquidity pool on Uniswap V2
 *         4. Burns the initial LP tokens
 *         5. Deploys an Auction contract to collect and auction treasury fees
 *         6. Deploys a FundRig contract via FundRigFactory
 *         7. Transfers Unit minting rights to the FundRig (permanently locked)
 *         8. Transfers ownership of the FundRig to the launcher
 *         9. Registers the FundRig with the central Registry
 */
contract FundCore is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /*----------  CONSTANTS  --------------------------------------------*/

    string public constant RIG_TYPE = "fund";
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /*----------  IMMUTABLES  -------------------------------------------*/

    address public immutable registry; // central registry for all rig types
    address public immutable usdcToken; // token required to launch
    address public immutable uniswapV2Factory; // Uniswap V2 factory
    address public immutable uniswapV2Router; // Uniswap V2 router
    address public immutable unitFactory; // factory for deploying Unit tokens
    address public immutable fundRigFactory; // factory for deploying FundRigs
    address public immutable auctionFactory; // factory for deploying Auctions

    /*----------  STATE  ------------------------------------------------*/

    address public protocolFeeAddress; // receives protocol fees
    uint256 public minUsdcForLaunch; // minimum USDC required to launch

    address[] public rigs; // enumerable list of deployed rigs
    mapping(address => bool) public rigToIsRig; // rig => is valid
    mapping(address => uint256) public rigToIndex; // rig => index in rigs[]
    mapping(address => address) public rigToAuction; // rig => Auction contract
    mapping(address => address) public rigToLP; // rig => LP token address

    /*----------  STRUCTS  ----------------------------------------------*/

    /**
     * @notice Parameters for launching a new FundRig.
     * @dev quoteToken must be a standard ERC20 (no rebasing or fee-on-transfer tokens).
     */
    struct LaunchParams {
        address launcher; // address to receive ownership
        address quoteToken; // ERC20 payment token for donations (e.g., USDC, WETH)
        address recipient; // address to receive 50% of donations (required)
        string tokenName; // Unit token name
        string tokenSymbol; // Unit token symbol
        string uri; // metadata URI for the rig
        uint256 usdcAmount; // USDC to provide for LP
        uint256 unitAmount; // Unit tokens minted for initial LP
        uint256 initialEmission; // starting Unit emission per day
        uint256 minEmission; // minimum Unit emission per day (floor)
        uint256 halvingPeriod; // number of days between emission halvings
        uint256 auctionInitPrice; // auction starting price
        uint256 auctionEpochPeriod; // auction epoch duration
        uint256 auctionPriceMultiplier; // auction price multiplier
        uint256 auctionMinInitPrice; // auction minimum starting price
    }

    /*----------  ERRORS  -----------------------------------------------*/

    error FundCore__InsufficientUsdc();
    error FundCore__ZeroLauncher();
    error FundCore__ZeroQuoteToken();
    error FundCore__ZeroRecipient();
    error FundCore__EmptyTokenName();
    error FundCore__EmptyTokenSymbol();
    error FundCore__EmptyUri();
    error FundCore__ZeroUnitAmount();
    error FundCore__ZeroAddress();

    /*----------  EVENTS  -----------------------------------------------*/

    event FundCore__Launched(
        address indexed launcher,
        address indexed rig,
        address indexed unit,
        address recipient,
        address auction,
        address lpToken,
        address quoteToken,
        string tokenName,
        string tokenSymbol,
        string uri,
        uint256 usdcAmount,
        uint256 unitAmount,
        uint256 initialEmission,
        uint256 minEmission,
        uint256 halvingPeriod,
        uint256 auctionInitPrice,
        uint256 auctionEpochPeriod,
        uint256 auctionPriceMultiplier,
        uint256 auctionMinInitPrice
    );
    event FundCore__ProtocolFeeAddressSet(address protocolFeeAddress);
    event FundCore__MinUsdcForLaunchSet(uint256 minUsdcForLaunch);

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    /**
     * @notice Deploy the FundCore launchpad contract.
     * @param _registry Central registry for all rig types
     * @param _usdcToken USDC token address
     * @param _uniswapV2Factory Uniswap V2 factory address
     * @param _uniswapV2Router Uniswap V2 router address
     * @param _unitFactory UnitFactory contract address
     * @param _fundRigFactory FundRigFactory contract address
     * @param _auctionFactory AuctionFactory contract address
     * @param _protocolFeeAddress Address to receive protocol fees
     * @param _minUsdcForLaunch Minimum USDC required to launch
     */
    constructor(
        address _registry,
        address _usdcToken,
        address _uniswapV2Factory,
        address _uniswapV2Router,
        address _unitFactory,
        address _fundRigFactory,
        address _auctionFactory,
        address _protocolFeeAddress,
        uint256 _minUsdcForLaunch
    ) {
        if (
            _registry == address(0) || _usdcToken == address(0) || _uniswapV2Factory == address(0)
                || _uniswapV2Router == address(0) || _unitFactory == address(0) || _fundRigFactory == address(0)
                || _auctionFactory == address(0)
        ) {
            revert FundCore__ZeroAddress();
        }

        registry = _registry;
        usdcToken = _usdcToken;
        uniswapV2Factory = _uniswapV2Factory;
        uniswapV2Router = _uniswapV2Router;
        unitFactory = _unitFactory;
        fundRigFactory = _fundRigFactory;
        auctionFactory = _auctionFactory;
        protocolFeeAddress = _protocolFeeAddress;
        minUsdcForLaunch = _minUsdcForLaunch;
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Launch a new FundRig with associated Unit token, LP, and Auction.
     * @dev Caller must approve USDC tokens before calling.
     * @param params Launch parameters struct
     * @return unit Address of deployed Unit token
     * @return rig Address of deployed FundRig contract
     * @return auction Address of deployed Auction contract
     * @return lpToken Address of Unit/USDC LP token
     */
    function launch(LaunchParams calldata params)
        external
        nonReentrant
        returns (address unit, address rig, address auction, address lpToken)
    {
        // Validate ALL inputs upfront (fail fast before any state changes)
        _validateLaunchParams(params);

        // Transfer USDC from launcher
        IERC20(usdcToken).safeTransferFrom(msg.sender, address(this), params.usdcAmount);

        // Deploy Unit token via factory (FundCore becomes initial minter)
        unit = IUnitFactory(unitFactory).deploy(params.tokenName, params.tokenSymbol);

        // Mint initial Unit tokens for LP seeding
        IUnit(unit).mint(address(this), params.unitAmount);

        // Create Unit/USDC LP via Uniswap V2
        IERC20(unit).safeApprove(uniswapV2Router, 0);
        IERC20(unit).safeApprove(uniswapV2Router, params.unitAmount);
        IERC20(usdcToken).safeApprove(uniswapV2Router, 0);
        IERC20(usdcToken).safeApprove(uniswapV2Router, params.usdcAmount);

        (,, uint256 liquidity) = IUniswapV2Router(uniswapV2Router).addLiquidity(
            unit,
            usdcToken,
            params.unitAmount,
            params.usdcAmount,
            params.unitAmount,
            params.usdcAmount,
            address(this),
            block.timestamp + 20 minutes
        );

        // Get LP token address and burn initial liquidity
        lpToken = IUniswapV2Factory(uniswapV2Factory).getPair(unit, usdcToken);
        IERC20(lpToken).safeTransfer(DEAD_ADDRESS, liquidity);

        // Deploy Auction with LP as payment token (receives treasury fees, burns LP)
        auction = IAuctionFactory(auctionFactory).deploy(
            lpToken,
            DEAD_ADDRESS,
            params.auctionInitPrice,
            params.auctionEpochPeriod,
            params.auctionPriceMultiplier,
            params.auctionMinInitPrice
        );

        // Deploy FundRig via factory
        // Recipient receives 50% of donations
        // Treasury is the Auction contract (receives 45% of donations)
        // Team is the launcher (receives 4% of donations)
        rig = IFundRigFactory(fundRigFactory).deploy(
            unit,
            params.quoteToken,
            address(this), // core
            auction, // treasury (45%)
            params.launcher, // team (4%)
            params.recipient, // recipient (50%)
            params.initialEmission,
            params.minEmission,
            params.halvingPeriod
        );

        // Transfer Unit minting rights to FundRig (permanently locked)
        IUnit(unit).setRig(rig);

        // Set initial URI for the rig (required)
        IFundRig(rig).setUri(params.uri);

        // Transfer FundRig ownership to launcher
        IFundRig(rig).transferOwnership(params.launcher);

        // Update local registry
        rigToIsRig[rig] = true;
        rigToIndex[rig] = rigs.length;
        rigs.push(rig);
        rigToLP[rig] = lpToken;
        rigToAuction[rig] = auction;

        // Register with central registry
        IRegistry(registry).register(rig, unit, params.launcher);

        emit FundCore__Launched(
            params.launcher,
            rig,
            unit,
            params.recipient,
            auction,
            lpToken,
            params.quoteToken,
            params.tokenName,
            params.tokenSymbol,
            params.uri,
            params.usdcAmount,
            params.unitAmount,
            params.initialEmission,
            params.minEmission,
            params.halvingPeriod,
            params.auctionInitPrice,
            params.auctionEpochPeriod,
            params.auctionPriceMultiplier,
            params.auctionMinInitPrice
        );

        return (unit, rig, auction, lpToken);
    }

    /*----------  RESTRICTED FUNCTIONS  ---------------------------------*/

    /**
     * @notice Update the protocol fee recipient address.
     * @dev Can be set to address(0) to disable protocol fees.
     * @param _protocolFeeAddress New protocol fee address
     */
    function setProtocolFeeAddress(address _protocolFeeAddress) external onlyOwner {
        protocolFeeAddress = _protocolFeeAddress;
        emit FundCore__ProtocolFeeAddressSet(_protocolFeeAddress);
    }

    /**
     * @notice Update the minimum USDC required to launch.
     * @param _minUsdcForLaunch New minimum amount
     */
    function setMinUsdcForLaunch(uint256 _minUsdcForLaunch) external onlyOwner {
        minUsdcForLaunch = _minUsdcForLaunch;
        emit FundCore__MinUsdcForLaunchSet(_minUsdcForLaunch);
    }

    /*----------  INTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Validate Core-specific launch parameters.
     * @dev Rig and Auction parameters are validated by their respective constructors.
     * @param params Launch parameters to validate
     */
    function _validateLaunchParams(LaunchParams calldata params) internal view {
        if (params.launcher == address(0)) revert FundCore__ZeroLauncher();
        if (params.quoteToken == address(0)) revert FundCore__ZeroQuoteToken();
        if (params.recipient == address(0)) revert FundCore__ZeroRecipient();
        if (params.usdcAmount < minUsdcForLaunch) revert FundCore__InsufficientUsdc();
        if (bytes(params.tokenName).length == 0) revert FundCore__EmptyTokenName();
        if (bytes(params.tokenSymbol).length == 0) revert FundCore__EmptyTokenSymbol();
        if (bytes(params.uri).length == 0) revert FundCore__EmptyUri();
        if (params.unitAmount == 0) revert FundCore__ZeroUnitAmount();
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Returns the number of deployed rigs.
     * @return The length of the rigs array
     */
    function rigsLength() external view returns (uint256) {
        return rigs.length;
    }

}
