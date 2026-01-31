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
 *         Users provide DONUT tokens to launch a new donation-based token distribution.
 *         The FundCore contract:
 *         1. Deploys a new Unit token via UnitFactory
 *         2. Mints initial Unit tokens for liquidity
 *         3. Creates a Unit/DONUT liquidity pool on Uniswap V2
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
    address public immutable donutToken; // token required to launch
    address public immutable uniswapV2Factory; // Uniswap V2 factory
    address public immutable uniswapV2Router; // Uniswap V2 router
    address public immutable unitFactory; // factory for deploying Unit tokens
    address public immutable fundRigFactory; // factory for deploying FundRigs
    address public immutable auctionFactory; // factory for deploying Auctions

    /*----------  STATE  ------------------------------------------------*/

    address public protocolFeeAddress; // receives protocol fees
    uint256 public minDonutForLaunch; // minimum DONUT required to launch

    address[] public deployedRigs; // array of all deployed fund rigs
    mapping(address => bool) public isDeployedRig; // rig => is valid
    mapping(address => address) public rigToLauncher; // rig => launcher address
    mapping(address => address) public rigToUnit; // rig => Unit token
    mapping(address => address) public rigToAuction; // rig => Auction contract
    mapping(address => address) public rigToLP; // rig => LP token
    mapping(address => address) public rigToQuote; // rig => quote token (payment token)
    mapping(address => address) public rigToRecipient; // rig => recipient address

    /*----------  STRUCTS  ----------------------------------------------*/

    /**
     * @notice Parameters for launching a new FundRig.
     */
    struct LaunchParams {
        address launcher; // address to receive ownership
        address quoteToken; // ERC20 payment token for donations (e.g., USDC, WETH)
        address recipient; // address to receive 50% of donations (required)
        string tokenName; // Unit token name
        string tokenSymbol; // Unit token symbol
        uint256 donutAmount; // DONUT to provide for LP
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

    error FundCore__InsufficientDonut();
    error FundCore__ZeroLauncher();
    error FundCore__ZeroQuoteToken();
    error FundCore__ZeroRecipient();
    error FundCore__EmptyTokenName();
    error FundCore__EmptyTokenSymbol();
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
        uint256 donutAmount,
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
    event FundCore__MinDonutForLaunchSet(uint256 minDonutForLaunch);

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    /**
     * @notice Deploy the FundCore launchpad contract.
     * @param _registry Central registry for all rig types
     * @param _donutToken DONUT token address
     * @param _uniswapV2Factory Uniswap V2 factory address
     * @param _uniswapV2Router Uniswap V2 router address
     * @param _unitFactory UnitFactory contract address
     * @param _fundRigFactory FundRigFactory contract address
     * @param _auctionFactory AuctionFactory contract address
     * @param _protocolFeeAddress Address to receive protocol fees
     * @param _minDonutForLaunch Minimum DONUT required to launch
     */
    constructor(
        address _registry,
        address _donutToken,
        address _uniswapV2Factory,
        address _uniswapV2Router,
        address _unitFactory,
        address _fundRigFactory,
        address _auctionFactory,
        address _protocolFeeAddress,
        uint256 _minDonutForLaunch
    ) {
        if (
            _registry == address(0) || _donutToken == address(0) || _uniswapV2Factory == address(0)
                || _uniswapV2Router == address(0) || _unitFactory == address(0) || _fundRigFactory == address(0)
                || _auctionFactory == address(0)
        ) {
            revert FundCore__ZeroAddress();
        }

        registry = _registry;
        donutToken = _donutToken;
        uniswapV2Factory = _uniswapV2Factory;
        uniswapV2Router = _uniswapV2Router;
        unitFactory = _unitFactory;
        fundRigFactory = _fundRigFactory;
        auctionFactory = _auctionFactory;
        protocolFeeAddress = _protocolFeeAddress;
        minDonutForLaunch = _minDonutForLaunch;
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Launch a new FundRig with associated Unit token, LP, and Auction.
     * @dev Caller must approve DONUT tokens before calling.
     * @param params Launch parameters struct
     * @return unit Address of deployed Unit token
     * @return rig Address of deployed FundRig contract
     * @return auction Address of deployed Auction contract
     * @return lpToken Address of Unit/DONUT LP token
     */
    function launch(LaunchParams calldata params)
        external
        nonReentrant
        returns (address unit, address rig, address auction, address lpToken)
    {
        // Validate ALL inputs upfront (fail fast before any state changes)
        _validateLaunchParams(params);

        // Transfer DONUT from launcher
        IERC20(donutToken).safeTransferFrom(msg.sender, address(this), params.donutAmount);

        // Deploy Unit token via factory (FundCore becomes initial minter)
        unit = IUnitFactory(unitFactory).deploy(params.tokenName, params.tokenSymbol);

        // Mint initial Unit tokens for LP seeding
        IUnit(unit).mint(address(this), params.unitAmount);

        // Create Unit/DONUT LP via Uniswap V2
        IERC20(unit).safeApprove(uniswapV2Router, 0);
        IERC20(unit).safeApprove(uniswapV2Router, params.unitAmount);
        IERC20(donutToken).safeApprove(uniswapV2Router, 0);
        IERC20(donutToken).safeApprove(uniswapV2Router, params.donutAmount);

        (,, uint256 liquidity) = IUniswapV2Router(uniswapV2Router).addLiquidity(
            unit,
            donutToken,
            params.unitAmount,
            params.donutAmount,
            params.unitAmount,
            params.donutAmount,
            address(this),
            block.timestamp + 20 minutes
        );

        // Get LP token address and burn initial liquidity
        lpToken = IUniswapV2Factory(uniswapV2Factory).getPair(unit, donutToken);
        IERC20(lpToken).safeTransfer(DEAD_ADDRESS, liquidity);

        // Deploy Auction with LP as payment token (receives treasury fees, burns LP)
        auction = IAuctionFactory(auctionFactory).deploy(
            params.auctionInitPrice,
            lpToken,
            DEAD_ADDRESS,
            params.auctionEpochPeriod,
            params.auctionPriceMultiplier,
            params.auctionMinInitPrice
        );

        // Deploy FundRig via factory
        // Recipient receives 50% of donations
        // Treasury is the Auction contract (receives 45% of donations)
        // Team is the launcher (receives 4% of donations)
        rig = IFundRigFactory(fundRigFactory).deploy(
            params.quoteToken,
            unit,
            params.recipient, // recipient (50%)
            auction, // treasury (45%)
            params.launcher, // team (4%)
            address(this), // core
            params.initialEmission,
            params.minEmission,
            params.halvingPeriod
        );

        // Transfer Unit minting rights to FundRig (permanently locked)
        IUnit(unit).setRig(rig);

        // Transfer FundRig ownership to launcher
        IFundRig(rig).transferOwnership(params.launcher);

        // Update local registry
        deployedRigs.push(rig);
        isDeployedRig[rig] = true;
        rigToLauncher[rig] = params.launcher;
        rigToUnit[rig] = unit;
        rigToAuction[rig] = auction;
        rigToLP[rig] = lpToken;
        rigToQuote[rig] = params.quoteToken;
        rigToRecipient[rig] = params.recipient;

        // Register with central registry
        IRegistry(registry).register(rig, RIG_TYPE, unit, params.launcher);

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
            params.donutAmount,
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
     * @notice Update the minimum DONUT required to launch.
     * @param _minDonutForLaunch New minimum amount
     */
    function setMinDonutForLaunch(uint256 _minDonutForLaunch) external onlyOwner {
        minDonutForLaunch = _minDonutForLaunch;
        emit FundCore__MinDonutForLaunchSet(_minDonutForLaunch);
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
        if (params.donutAmount < minDonutForLaunch) revert FundCore__InsufficientDonut();
        if (bytes(params.tokenName).length == 0) revert FundCore__EmptyTokenName();
        if (bytes(params.tokenSymbol).length == 0) revert FundCore__EmptyTokenSymbol();
        if (params.unitAmount == 0) revert FundCore__ZeroUnitAmount();
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Get the total number of deployed fund rigs.
     * @return Number of fund rigs launched
     */
    function deployedRigsLength() external view returns (uint256) {
        return deployedRigs.length;
    }
}
