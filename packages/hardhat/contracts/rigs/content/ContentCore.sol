// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IContentRig} from "./interfaces/IContentRig.sol";
import {IMinter} from "./interfaces/IMinter.sol";
import {IUnit} from "../../interfaces/IUnit.sol";
import {IUnitFactory} from "../../interfaces/IUnitFactory.sol";
import {IContentRigFactory} from "./interfaces/IContentRigFactory.sol";
import {IMinterFactory} from "./interfaces/IMinterFactory.sol";
import {IAuctionFactory} from "../../interfaces/IAuctionFactory.sol";
import {IUniswapV2Factory, IUniswapV2Router} from "../../interfaces/IUniswapV2.sol";
import {IRegistry} from "../../interfaces/IRegistry.sol";

/**
 * @title ContentCore
 * @author heesho
 * @notice The launchpad contract for deploying new ContentRig instances.
 *         Users provide DONUT tokens to launch a new content platform. The ContentCore contract:
 *         1. Deploys a new Unit token via UnitFactory
 *         2. Mints initial Unit tokens for liquidity
 *         3. Creates a Unit/DONUT liquidity pool on Uniswap V2
 *         4. Burns the initial LP tokens
 *         5. Deploys an Auction contract to collect and auction treasury fees
 *         6. Deploys a ContentRig NFT collection via ContentRigFactory (creates Rewarder)
 *         7. Deploys a Minter contract via MinterFactory
 *         8. Transfers Unit minting rights to the Minter (permanently locked)
 *         9. Transfers ownership of ContentRig to the launcher
 *        10. Registers the ContentRig with the central Registry
 */
contract ContentCore is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /*----------  CONSTANTS  --------------------------------------------*/

    string public constant RIG_TYPE = "content";
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // Minter parameter bounds (mirrored from Minter.sol for early validation)
    uint256 public constant MINTER_MAX_INITIAL_UPS = 1e24;
    uint256 public constant MINTER_MIN_HALVING_PERIOD = 7 days;
    uint256 public constant MINTER_MAX_HALVING_PERIOD = 365 days;

    // ContentRig parameter bounds (mirrored from ContentRig.sol for early validation)
    uint256 public constant CONTENT_ABS_MIN_INIT_PRICE = 1e6;
    uint256 public constant CONTENT_ABS_MAX_INIT_PRICE = type(uint192).max;

    // Auction parameter bounds (mirrored from Auction.sol for early validation)
    uint256 public constant AUCTION_MIN_EPOCH_PERIOD = 1 hours;
    uint256 public constant AUCTION_MAX_EPOCH_PERIOD = 365 days;
    uint256 public constant AUCTION_MIN_PRICE_MULTIPLIER = 1.1e18;
    uint256 public constant AUCTION_MAX_PRICE_MULTIPLIER = 3e18;
    uint256 public constant AUCTION_ABS_MIN_INIT_PRICE = 1e6;
    uint256 public constant AUCTION_ABS_MAX_INIT_PRICE = type(uint192).max;

    /*----------  IMMUTABLES  -------------------------------------------*/

    address public immutable registry; // central registry for all rig types
    address public immutable quote; // quote token for content collections (e.g. USDC)
    address public immutable donutToken; // token required to launch
    address public immutable uniswapV2Factory; // Uniswap V2 factory
    address public immutable uniswapV2Router; // Uniswap V2 router
    address public immutable unitFactory; // factory for deploying Unit tokens
    address public immutable contentRigFactory; // factory for deploying ContentRigs
    address public immutable minterFactory; // factory for deploying Minters
    address public immutable auctionFactory; // factory for deploying Auctions
    address public immutable rewarderFactory; // factory for deploying Rewarders

    /*----------  STATE  ------------------------------------------------*/

    address public protocolFeeAddress; // receives protocol fees from content collections
    uint256 public minDonutForLaunch; // minimum DONUT required to launch

    address[] public deployedRigs; // array of all deployed content rigs
    mapping(address => bool) public isDeployedRig; // rig => is valid
    mapping(address => address) public rigToLauncher; // rig => launcher address
    mapping(address => address) public rigToUnit; // rig => Unit token
    mapping(address => address) public rigToAuction; // rig => Auction contract
    mapping(address => address) public rigToMinter; // rig => Minter contract
    mapping(address => address) public rigToRewarder; // rig => Rewarder contract
    mapping(address => address) public rigToLP; // rig => LP token

    /*----------  STRUCTS  ----------------------------------------------*/

    /**
     * @notice Parameters for launching a new ContentRig.
     */
    struct LaunchParams {
        address launcher; // address to receive ownership
        string tokenName; // Unit token name
        string tokenSymbol; // Unit token symbol
        string uri; // metadata URI for the content
        uint256 donutAmount; // DONUT to provide for LP
        uint256 unitAmount; // Unit tokens minted for initial LP
        uint256 initialUps; // starting units per second
        uint256 tailUps; // minimum units per second
        uint256 halvingPeriod; // time between halvings
        uint256 contentMinInitPrice; // content minimum starting price
        bool contentIsModerated; // whether content requires approval
        uint256 auctionInitPrice; // auction starting price
        uint256 auctionEpochPeriod; // auction epoch duration
        uint256 auctionPriceMultiplier; // auction price multiplier
        uint256 auctionMinInitPrice; // auction minimum starting price
    }

    /*----------  ERRORS  -----------------------------------------------*/

    error ContentCore__InsufficientDonut();
    error ContentCore__InvalidLauncher();
    error ContentCore__EmptyTokenName();
    error ContentCore__EmptyTokenSymbol();
    error ContentCore__InvalidUnitAmount();
    error ContentCore__ZeroAddress();
    // Minter parameter errors
    error ContentCore__InitialUpsOutOfRange();
    error ContentCore__TailUpsOutOfRange();
    error ContentCore__HalvingPeriodOutOfRange();
    // ContentRig parameter errors
    error ContentCore__ContentMinInitPriceOutOfRange();
    // Auction parameter errors
    error ContentCore__AuctionEpochPeriodOutOfRange();
    error ContentCore__AuctionPriceMultiplierOutOfRange();
    error ContentCore__AuctionInitPriceOutOfRange();
    error ContentCore__AuctionMinInitPriceOutOfRange();

    /*----------  EVENTS  -----------------------------------------------*/

    event ContentCore__Launched(
        address indexed launcher,
        address indexed rig,
        address indexed unit,
        address minter,
        address rewarder,
        address auction,
        address lpToken,
        string tokenName,
        string tokenSymbol,
        string uri,
        uint256 donutAmount,
        uint256 unitAmount,
        uint256 initialUps,
        uint256 tailUps,
        uint256 halvingPeriod,
        uint256 contentMinInitPrice,
        bool contentIsModerated,
        uint256 auctionInitPrice,
        uint256 auctionEpochPeriod,
        uint256 auctionPriceMultiplier,
        uint256 auctionMinInitPrice
    );
    event ContentCore__ProtocolFeeAddressSet(address protocolFeeAddress);
    event ContentCore__MinDonutForLaunchSet(uint256 minDonutForLaunch);

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    /**
     * @notice Deploy the ContentCore launchpad contract.
     * @param _registry Central registry for all rig types
     * @param _quote Quote token address (e.g. USDC)
     * @param _donutToken DONUT token address
     * @param _uniswapV2Factory Uniswap V2 factory address
     * @param _uniswapV2Router Uniswap V2 router address
     * @param _unitFactory UnitFactory contract address
     * @param _contentRigFactory ContentRigFactory contract address
     * @param _minterFactory MinterFactory contract address
     * @param _auctionFactory AuctionFactory contract address
     * @param _rewarderFactory RewarderFactory contract address
     * @param _protocolFeeAddress Address to receive protocol fees
     * @param _minDonutForLaunch Minimum DONUT required to launch
     */
    constructor(
        address _registry,
        address _quote,
        address _donutToken,
        address _uniswapV2Factory,
        address _uniswapV2Router,
        address _unitFactory,
        address _contentRigFactory,
        address _minterFactory,
        address _auctionFactory,
        address _rewarderFactory,
        address _protocolFeeAddress,
        uint256 _minDonutForLaunch
    ) {
        if (
            _registry == address(0) || _quote == address(0) || _donutToken == address(0)
                || _uniswapV2Factory == address(0) || _uniswapV2Router == address(0) || _unitFactory == address(0)
                || _contentRigFactory == address(0) || _minterFactory == address(0) || _auctionFactory == address(0)
                || _rewarderFactory == address(0)
        ) {
            revert ContentCore__ZeroAddress();
        }

        registry = _registry;
        quote = _quote;
        donutToken = _donutToken;
        uniswapV2Factory = _uniswapV2Factory;
        uniswapV2Router = _uniswapV2Router;
        unitFactory = _unitFactory;
        contentRigFactory = _contentRigFactory;
        minterFactory = _minterFactory;
        auctionFactory = _auctionFactory;
        rewarderFactory = _rewarderFactory;
        protocolFeeAddress = _protocolFeeAddress;
        minDonutForLaunch = _minDonutForLaunch;
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Launch a new ContentRig with associated Unit token, LP, Minter, Rewarder, and Auction.
     * @dev Caller must approve DONUT tokens before calling.
     * @param params Launch parameters struct
     * @return unit Address of deployed Unit token
     * @return rig Address of deployed ContentRig contract
     * @return minter Address of deployed Minter contract
     * @return rewarder Address of deployed Rewarder contract
     * @return auction Address of deployed Auction contract
     * @return lpToken Address of Unit/DONUT LP token
     */
    function launch(LaunchParams calldata params)
        external
        nonReentrant
        returns (
            address unit,
            address rig,
            address minter,
            address rewarder,
            address auction,
            address lpToken
        )
    {
        // Validate ALL inputs upfront (fail fast before any state changes)
        _validateLaunchParams(params);

        // Transfer DONUT from launcher
        IERC20(donutToken).safeTransferFrom(msg.sender, address(this), params.donutAmount);

        // Deploy Unit token via factory (ContentCore becomes initial minter)
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

        // Deploy ContentRig via factory (creates Rewarder internally)
        rig = IContentRigFactory(contentRigFactory).deploy(
            params.tokenName,
            params.tokenSymbol,
            params.uri,
            unit,
            quote,
            auction,
            params.launcher, // team address = launcher
            address(this),
            rewarderFactory,
            params.contentMinInitPrice,
            params.contentIsModerated
        );

        // Get Rewarder address from ContentRig
        rewarder = IContentRig(rig).rewarder();

        // Deploy Minter via factory
        minter = IMinterFactory(minterFactory).deploy(
            unit,
            rewarder,
            params.initialUps,
            params.tailUps,
            params.halvingPeriod
        );

        // Transfer Unit minting rights to Minter (permanently locked since Minter has no setMinter function)
        IUnit(unit).setRig(minter);

        // Transfer ContentRig ownership to launcher
        IContentRig(rig).transferOwnership(params.launcher);

        // Update local registry
        deployedRigs.push(rig);
        isDeployedRig[rig] = true;
        rigToLauncher[rig] = params.launcher;
        rigToUnit[rig] = unit;
        rigToAuction[rig] = auction;
        rigToMinter[rig] = minter;
        rigToRewarder[rig] = rewarder;
        rigToLP[rig] = lpToken;

        // Register with central registry
        IRegistry(registry).register(rig, RIG_TYPE, unit, params.launcher);

        emit ContentCore__Launched(
            params.launcher,
            rig,
            unit,
            minter,
            rewarder,
            auction,
            lpToken,
            params.tokenName,
            params.tokenSymbol,
            params.uri,
            params.donutAmount,
            params.unitAmount,
            params.initialUps,
            params.tailUps,
            params.halvingPeriod,
            params.contentMinInitPrice,
            params.contentIsModerated,
            params.auctionInitPrice,
            params.auctionEpochPeriod,
            params.auctionPriceMultiplier,
            params.auctionMinInitPrice
        );

        return (unit, rig, minter, rewarder, auction, lpToken);
    }

    /*----------  RESTRICTED FUNCTIONS  ---------------------------------*/

    /**
     * @notice Update the protocol fee recipient address.
     * @dev Can be set to address(0) to disable protocol fees.
     * @param _protocolFeeAddress New protocol fee address
     */
    function setProtocolFeeAddress(address _protocolFeeAddress) external onlyOwner {
        protocolFeeAddress = _protocolFeeAddress;
        emit ContentCore__ProtocolFeeAddressSet(_protocolFeeAddress);
    }

    /**
     * @notice Update the minimum DONUT required to launch.
     * @param _minDonutForLaunch New minimum amount
     */
    function setMinDonutForLaunch(uint256 _minDonutForLaunch) external onlyOwner {
        minDonutForLaunch = _minDonutForLaunch;
        emit ContentCore__MinDonutForLaunchSet(_minDonutForLaunch);
    }

    /*----------  INTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Validate all launch parameters upfront to fail fast.
     * @dev Mirrors validation from Minter, ContentRig, and Auction constructors for early revert.
     * @param params Launch parameters to validate
     */
    function _validateLaunchParams(LaunchParams calldata params) internal view {
        // Basic validations
        if (params.launcher == address(0)) revert ContentCore__InvalidLauncher();
        if (params.donutAmount < minDonutForLaunch) revert ContentCore__InsufficientDonut();
        if (bytes(params.tokenName).length == 0) revert ContentCore__EmptyTokenName();
        if (bytes(params.tokenSymbol).length == 0) revert ContentCore__EmptyTokenSymbol();
        if (params.unitAmount == 0) revert ContentCore__InvalidUnitAmount();

        // Minter parameter validations
        if (params.initialUps == 0 || params.initialUps > MINTER_MAX_INITIAL_UPS) {
            revert ContentCore__InitialUpsOutOfRange();
        }
        if (params.tailUps == 0 || params.tailUps > params.initialUps) {
            revert ContentCore__TailUpsOutOfRange();
        }
        if (params.halvingPeriod < MINTER_MIN_HALVING_PERIOD || params.halvingPeriod > MINTER_MAX_HALVING_PERIOD) {
            revert ContentCore__HalvingPeriodOutOfRange();
        }

        // ContentRig parameter validations
        if (params.contentMinInitPrice < CONTENT_ABS_MIN_INIT_PRICE || params.contentMinInitPrice > CONTENT_ABS_MAX_INIT_PRICE) {
            revert ContentCore__ContentMinInitPriceOutOfRange();
        }

        // Auction parameter validations
        if (params.auctionEpochPeriod < AUCTION_MIN_EPOCH_PERIOD || params.auctionEpochPeriod > AUCTION_MAX_EPOCH_PERIOD) {
            revert ContentCore__AuctionEpochPeriodOutOfRange();
        }
        if (params.auctionPriceMultiplier < AUCTION_MIN_PRICE_MULTIPLIER || params.auctionPriceMultiplier > AUCTION_MAX_PRICE_MULTIPLIER) {
            revert ContentCore__AuctionPriceMultiplierOutOfRange();
        }
        if (params.auctionMinInitPrice < AUCTION_ABS_MIN_INIT_PRICE || params.auctionMinInitPrice > AUCTION_ABS_MAX_INIT_PRICE) {
            revert ContentCore__AuctionMinInitPriceOutOfRange();
        }
        if (params.auctionInitPrice < params.auctionMinInitPrice || params.auctionInitPrice > AUCTION_ABS_MAX_INIT_PRICE) {
            revert ContentCore__AuctionInitPriceOutOfRange();
        }
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Get the total number of deployed content rigs.
     * @return Number of content rigs launched
     */
    function deployedRigsLength() external view returns (uint256) {
        return deployedRigs.length;
    }
}
