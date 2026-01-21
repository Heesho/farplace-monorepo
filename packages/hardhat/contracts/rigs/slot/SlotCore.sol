// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {ISlotRig} from "./interfaces/ISlotRig.sol";
import {ISlotRigFactory} from "./interfaces/ISlotRigFactory.sol";
import {IUnit} from "../../interfaces/IUnit.sol";
import {IUnitFactory} from "../../interfaces/IUnitFactory.sol";
import {IAuctionFactory} from "../../interfaces/IAuctionFactory.sol";
import {IUniswapV2Factory, IUniswapV2Router} from "../../interfaces/IUniswapV2.sol";
import {IRegistry} from "../../interfaces/IRegistry.sol";

/**
 * @title SlotCore
 * @author heesho
 * @notice The launchpad contract for deploying new SlotRig instances.
 *         Users provide DONUT tokens to launch a new slot-to-earn slot machine. The SlotCore contract:
 *         1. Deploys a new Unit token via UnitFactory
 *         2. Mints initial Unit tokens for liquidity
 *         3. Creates a Unit/DONUT liquidity pool on Uniswap V2
 *         4. Burns the initial LP tokens
 *         5. Deploys an Auction contract to collect and auction treasury fees
 *         6. Deploys a new SlotRig contract via SlotRigFactory
 *         7. Transfers Unit minting rights to the SlotRig (permanently locked)
 *         8. Transfers ownership of the SlotRig to the launcher
 *         9. Registers the SlotRig with the central Registry
 */
contract SlotCore is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /*----------  CONSTANTS  --------------------------------------------*/

    string public constant RIG_TYPE = "slot";
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // Rig parameter bounds (mirrored from SlotRig.sol for early validation)
    uint256 public constant RIG_MIN_EPOCH_PERIOD = 10 minutes;
    uint256 public constant RIG_MAX_EPOCH_PERIOD = 365 days;
    uint256 public constant RIG_MIN_PRICE_MULTIPLIER = 1.1e18;
    uint256 public constant RIG_MAX_PRICE_MULTIPLIER = 3e18;
    uint256 public constant RIG_ABS_MIN_INIT_PRICE = 1e6;
    uint256 public constant RIG_ABS_MAX_INIT_PRICE = type(uint192).max;
    uint256 public constant RIG_MAX_INITIAL_UPS = 1e24;
    uint256 public constant RIG_MIN_HALVING_PERIOD = 7 days;
    uint256 public constant RIG_MAX_HALVING_PERIOD = 365 days;

    // Auction parameter bounds (mirrored from Auction.sol for early validation)
    uint256 public constant AUCTION_MIN_EPOCH_PERIOD = 1 hours;
    uint256 public constant AUCTION_MAX_EPOCH_PERIOD = 365 days;
    uint256 public constant AUCTION_MIN_PRICE_MULTIPLIER = 1.1e18;
    uint256 public constant AUCTION_MAX_PRICE_MULTIPLIER = 3e18;
    uint256 public constant AUCTION_ABS_MIN_INIT_PRICE = 1e6;
    uint256 public constant AUCTION_ABS_MAX_INIT_PRICE = type(uint192).max;

    /*----------  IMMUTABLES  -------------------------------------------*/

    address public immutable registry; // central registry for all rig types
    address public immutable donutToken; // token required to launch
    address public immutable uniswapV2Factory; // Uniswap V2 factory
    address public immutable uniswapV2Router; // Uniswap V2 router
    address public immutable unitFactory; // factory for deploying Unit tokens
    address public immutable slotRigFactory; // factory for deploying SlotRigs
    address public immutable auctionFactory; // factory for deploying Auctions
    address public immutable entropy; // Pyth Entropy contract for randomness

    /*----------  STATE  ------------------------------------------------*/

    address public protocolFeeAddress; // receives protocol fees from rigs
    uint256 public minDonutForLaunch; // minimum DONUT required to launch

    address[] public deployedRigs; // array of all deployed rigs
    mapping(address => bool) public isDeployedRig; // rig => is valid
    mapping(address => address) public rigToLauncher; // rig => launcher address
    mapping(address => address) public rigToUnit; // rig => Unit token
    mapping(address => address) public rigToAuction; // rig => Auction contract
    mapping(address => address) public rigToLP; // rig => LP token
    mapping(address => address) public rigToQuote; // rig => quote token (payment token)

    /*----------  STRUCTS  ----------------------------------------------*/

    /**
     * @notice Parameters for launching a new SlotRig.
     * @dev quoteToken must be a standard ERC20 (no rebasing or fee-on-transfer tokens)
     */
    struct LaunchParams {
        address launcher; // address to receive SlotRig ownership and team fees
        address quoteToken; // ERC20 payment token for slotning (e.g., USDC, WETH)
        string tokenName; // Unit token name
        string tokenSymbol; // Unit token symbol
        uint256 donutAmount; // DONUT to provide for LP
        uint256 unitAmount; // Unit tokens minted for initial LP
        uint256 initialUps; // starting units per second
        uint256 tailUps; // minimum units per second
        uint256 halvingPeriod; // time between halvings
        uint256 rigEpochPeriod; // rig auction epoch duration
        uint256 rigPriceMultiplier; // rig price multiplier
        uint256 rigMinInitPrice; // rig minimum starting price
        uint256 auctionInitPrice; // auction starting price
        uint256 auctionEpochPeriod; // auction epoch duration
        uint256 auctionPriceMultiplier; // auction price multiplier
        uint256 auctionMinInitPrice; // auction minimum starting price
    }

    /*----------  ERRORS  -----------------------------------------------*/

    error SlotCore__InsufficientDonut();
    error SlotCore__ZeroLauncher();
    error SlotCore__ZeroQuoteToken();
    error SlotCore__EmptyTokenName();
    error SlotCore__EmptyTokenSymbol();
    error SlotCore__ZeroUnitAmount();
    error SlotCore__ZeroAddress();
    // Rig parameter errors
    error SlotCore__RigEpochPeriodOutOfRange();
    error SlotCore__RigPriceMultiplierOutOfRange();
    error SlotCore__RigMinInitPriceOutOfRange();
    error SlotCore__RigInitialUpsOutOfRange();
    error SlotCore__RigTailUpsOutOfRange();
    error SlotCore__RigHalvingPeriodOutOfRange();
    // Auction parameter errors
    error SlotCore__AuctionEpochPeriodOutOfRange();
    error SlotCore__AuctionPriceMultiplierOutOfRange();
    error SlotCore__AuctionInitPriceOutOfRange();
    error SlotCore__AuctionMinInitPriceOutOfRange();

    /*----------  EVENTS  -----------------------------------------------*/

    event SlotCore__Launched(
        address indexed launcher,
        address indexed rig,
        address indexed unit,
        address auction,
        address lpToken,
        address quoteToken,
        string tokenName,
        string tokenSymbol,
        uint256 donutAmount,
        uint256 unitAmount,
        uint256 initialUps,
        uint256 tailUps,
        uint256 halvingPeriod,
        uint256 rigEpochPeriod,
        uint256 rigPriceMultiplier,
        uint256 rigMinInitPrice,
        uint256 auctionInitPrice,
        uint256 auctionEpochPeriod,
        uint256 auctionPriceMultiplier,
        uint256 auctionMinInitPrice
    );
    event SlotCore__ProtocolFeeAddressSet(address protocolFeeAddress);
    event SlotCore__MinDonutForLaunchSet(uint256 minDonutForLaunch);

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    /**
     * @notice Deploy the SlotCore launchpad contract.
     * @param _registry Central registry for all rig types
     * @param _donutToken DONUT token address
     * @param _uniswapV2Factory Uniswap V2 factory address
     * @param _uniswapV2Router Uniswap V2 router address
     * @param _unitFactory UnitFactory contract address
     * @param _slotRigFactory SlotRigFactory contract address
     * @param _auctionFactory AuctionFactory contract address
     * @param _entropy Pyth Entropy contract address
     * @param _protocolFeeAddress Address to receive protocol fees
     * @param _minDonutForLaunch Minimum DONUT required to launch
     */
    constructor(
        address _registry,
        address _donutToken,
        address _uniswapV2Factory,
        address _uniswapV2Router,
        address _unitFactory,
        address _slotRigFactory,
        address _auctionFactory,
        address _entropy,
        address _protocolFeeAddress,
        uint256 _minDonutForLaunch
    ) {
        if (
            _registry == address(0) || _donutToken == address(0) || _uniswapV2Factory == address(0)
                || _uniswapV2Router == address(0) || _unitFactory == address(0) || _slotRigFactory == address(0)
                || _auctionFactory == address(0) || _entropy == address(0)
        ) {
            revert SlotCore__ZeroAddress();
        }

        registry = _registry;
        donutToken = _donutToken;
        uniswapV2Factory = _uniswapV2Factory;
        uniswapV2Router = _uniswapV2Router;
        unitFactory = _unitFactory;
        slotRigFactory = _slotRigFactory;
        auctionFactory = _auctionFactory;
        entropy = _entropy;
        protocolFeeAddress = _protocolFeeAddress;
        minDonutForLaunch = _minDonutForLaunch;
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Launch a new SlotRig with associated Unit token, LP, and Auction.
     * @dev Caller must approve DONUT tokens before calling.
     * @param params Launch parameters struct
     * @return unit Address of deployed Unit token
     * @return rig Address of deployed SlotRig contract
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

        // Deploy Unit token via factory (SlotCore becomes initial rig/minter)
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

        // Deploy Auction with LP as payment token
        auction = IAuctionFactory(auctionFactory).deploy(
            params.auctionInitPrice,
            lpToken,
            DEAD_ADDRESS,
            params.auctionEpochPeriod,
            params.auctionPriceMultiplier,
            params.auctionMinInitPrice
        );

        // Deploy SlotRig via factory
        // Treasury is the Auction contract (receives 90% of slot fees)
        rig = ISlotRigFactory(slotRigFactory).deploy(
            unit,
            params.quoteToken,
            entropy,
            auction, // treasury
            params.rigEpochPeriod,
            params.rigPriceMultiplier,
            params.rigMinInitPrice,
            params.initialUps,
            params.halvingPeriod,
            params.tailUps
        );

        // Transfer Unit minting rights to SlotRig (permanently locked)
        IUnit(unit).setRig(rig);

        // Transfer SlotRig ownership to launcher
        ISlotRig(rig).transferOwnership(params.launcher);

        // Update local registry
        deployedRigs.push(rig);
        isDeployedRig[rig] = true;
        rigToLauncher[rig] = params.launcher;
        rigToUnit[rig] = unit;
        rigToAuction[rig] = auction;
        rigToLP[rig] = lpToken;
        rigToQuote[rig] = params.quoteToken;

        // Register with central registry
        IRegistry(registry).register(rig, RIG_TYPE, unit, params.launcher);

        emit SlotCore__Launched(
            params.launcher,
            rig,
            unit,
            auction,
            lpToken,
            params.quoteToken,
            params.tokenName,
            params.tokenSymbol,
            params.donutAmount,
            params.unitAmount,
            params.initialUps,
            params.tailUps,
            params.halvingPeriod,
            params.rigEpochPeriod,
            params.rigPriceMultiplier,
            params.rigMinInitPrice,
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
        emit SlotCore__ProtocolFeeAddressSet(_protocolFeeAddress);
    }

    /**
     * @notice Update the minimum DONUT required to launch.
     * @param _minDonutForLaunch New minimum amount
     */
    function setMinDonutForLaunch(uint256 _minDonutForLaunch) external onlyOwner {
        minDonutForLaunch = _minDonutForLaunch;
        emit SlotCore__MinDonutForLaunchSet(_minDonutForLaunch);
    }

    /*----------  INTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Validate all launch parameters upfront to fail fast.
     * @dev Mirrors validation from SlotRig and Auction constructors for early revert.
     * @param params Launch parameters to validate
     */
    function _validateLaunchParams(LaunchParams calldata params) internal view {
        // Basic validations
        if (params.launcher == address(0)) revert SlotCore__ZeroLauncher();
        if (params.quoteToken == address(0)) revert SlotCore__ZeroQuoteToken();
        if (params.donutAmount < minDonutForLaunch) revert SlotCore__InsufficientDonut();
        if (bytes(params.tokenName).length == 0) revert SlotCore__EmptyTokenName();
        if (bytes(params.tokenSymbol).length == 0) revert SlotCore__EmptyTokenSymbol();
        if (params.unitAmount == 0) revert SlotCore__ZeroUnitAmount();

        // Rig parameter validations
        if (params.rigEpochPeriod < RIG_MIN_EPOCH_PERIOD || params.rigEpochPeriod > RIG_MAX_EPOCH_PERIOD) {
            revert SlotCore__RigEpochPeriodOutOfRange();
        }
        if (params.rigPriceMultiplier < RIG_MIN_PRICE_MULTIPLIER || params.rigPriceMultiplier > RIG_MAX_PRICE_MULTIPLIER) {
            revert SlotCore__RigPriceMultiplierOutOfRange();
        }
        if (params.rigMinInitPrice < RIG_ABS_MIN_INIT_PRICE || params.rigMinInitPrice > RIG_ABS_MAX_INIT_PRICE) {
            revert SlotCore__RigMinInitPriceOutOfRange();
        }
        if (params.initialUps == 0 || params.initialUps > RIG_MAX_INITIAL_UPS) {
            revert SlotCore__RigInitialUpsOutOfRange();
        }
        if (params.tailUps == 0 || params.tailUps > params.initialUps) {
            revert SlotCore__RigTailUpsOutOfRange();
        }
        if (params.halvingPeriod < RIG_MIN_HALVING_PERIOD || params.halvingPeriod > RIG_MAX_HALVING_PERIOD) {
            revert SlotCore__RigHalvingPeriodOutOfRange();
        }

        // Auction parameter validations
        if (params.auctionEpochPeriod < AUCTION_MIN_EPOCH_PERIOD || params.auctionEpochPeriod > AUCTION_MAX_EPOCH_PERIOD) {
            revert SlotCore__AuctionEpochPeriodOutOfRange();
        }
        if (params.auctionPriceMultiplier < AUCTION_MIN_PRICE_MULTIPLIER || params.auctionPriceMultiplier > AUCTION_MAX_PRICE_MULTIPLIER) {
            revert SlotCore__AuctionPriceMultiplierOutOfRange();
        }
        if (params.auctionMinInitPrice < AUCTION_ABS_MIN_INIT_PRICE || params.auctionMinInitPrice > AUCTION_ABS_MAX_INIT_PRICE) {
            revert SlotCore__AuctionMinInitPriceOutOfRange();
        }
        if (params.auctionInitPrice < params.auctionMinInitPrice || params.auctionInitPrice > AUCTION_ABS_MAX_INIT_PRICE) {
            revert SlotCore__AuctionInitPriceOutOfRange();
        }
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Get the total number of deployed slot rigs.
     * @return Number of slot rigs launched
     */
    function deployedRigsLength() external view returns (uint256) {
        return deployedRigs.length;
    }
}
