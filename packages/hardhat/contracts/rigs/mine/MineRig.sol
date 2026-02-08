// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IEntropyV2} from "@pythnetwork/entropy-sdk-solidity/IEntropyV2.sol";
import {IEntropyConsumer} from "@pythnetwork/entropy-sdk-solidity/IEntropyConsumer.sol";
import {IUnit} from "../../interfaces/IUnit.sol";
import {IMineCore} from "./interfaces/IMineCore.sol";

/**
 * @title MineRig
 * @author heesho
 * @notice A mine-based mining rig contract that uses Dutch auctions for slot acquisition.
 * @dev Miners compete to control slots by paying Dutch auction prices. While holding a slot,
 *      miners earn Unit token emissions proportional to time held. When displaced, the previous
 *      miner receives 80% of the incoming payment. Optional Pyth Entropy VRF assigns random
 *      UPS multipliers (1x-10x) to slots.
 *
 *      Mechanics:
 *      - Slot price starts high and decays linearly each epoch
 *      - Displaced miner receives 80% of slot purchase price (pull-based claim)
 *      - UPS halves based on total minted supply (geometric threshold series)
 *      - Optional VRF-based UPS multiplier per slot, lasting upsMultiplierDuration
 *
 *      Fee Split:
 *      - 80% to Previous Miner
 *      - 15% to Treasury
 *      - 4% to Team
 *      - 1% to Protocol
 */
contract MineRig is IEntropyConsumer, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    /*----------  CONSTANTS  --------------------------------------------*/

    // Fee distribution (basis points)
    uint256 public constant TOTAL_BPS = 2_000;      // 20% total fees (miner gets 80%)
    uint256 public constant TEAM_BPS = 400;         // 4% to team
    uint256 public constant PROTOCOL_BPS = 100;     // 1% to protocol
    // Treasury receives remainder (15%)
    uint256 public constant DIVISOR = 10_000;
    uint256 public constant PRECISION = 1e18;

    // Epoch period bounds
    uint256 public constant MIN_EPOCH_PERIOD = 10 minutes;
    uint256 public constant MAX_EPOCH_PERIOD = 365 days;

    // Price multiplier bounds (for Dutch auction reset)
    uint256 public constant MIN_PRICE_MULTIPLIER = 1.1e18;  // 110% minimum
    uint256 public constant MAX_PRICE_MULTIPLIER = 3e18;    // 300% maximum

    // Init price bounds
    uint256 public constant ABS_MIN_INIT_PRICE = 1e6;       // Minimum sane value (1 USDC with 6 decimals)
    uint256 public constant ABS_MAX_INIT_PRICE = type(uint192).max;

    // UPS bounds
    uint256 public constant MAX_INITIAL_UPS = 1e24;         // Prevent overflow in mined amount calc

    // Halving bounds
    uint256 public constant MIN_HALVING_AMOUNT = 1000 ether; // Prevent degenerate tokenomics
    uint256 public constant MAX_HALVING_AMOUNT = 1e27;       // Prevent effectively-never halvings

    // UPS multiplier bounds
    uint256 public constant DEFAULT_UPS_MULTIPLIER = 1e18;
    uint256 public constant MIN_UPS_MULTIPLIER = 1e18;      // 1x
    uint256 public constant MAX_UPS_MULTIPLIER = 10e18;     // 10x
    uint256 public constant MIN_UPS_MULTIPLIER_DURATION = 1 hours;
    uint256 public constant MAX_UPS_MULTIPLIER_DURATION = 7 days;

    // Capacity bounds
    uint256 public constant MAX_CAPACITY = 256;

    /*----------  IMMUTABLES  -------------------------------------------*/

    address public immutable unit;      // Unit token to be minted
    address public immutable quote;     // Payment token (e.g., USDC)
    address public immutable entropy;   // Pyth Entropy contract
    address public immutable core;      // Mine core contract
    uint256 public immutable startTime; // Contract deployment timestamp

    uint256 public immutable epochPeriod;       // Duration of each Dutch auction
    uint256 public immutable priceMultiplier;   // Multiplier for next epoch's starting price
    uint256 public immutable minInitPrice;      // Minimum starting price per epoch
    uint256 public immutable initialUps;        // Starting units per second
    uint256 public immutable halvingAmount;     // Token amount threshold for halving
    uint256 public immutable tailUps;           // Minimum units per second after halvings
    uint256 public immutable upsMultiplierDuration; // How long a UPS multiplier lasts

    /*----------  STATE  ------------------------------------------------*/

    address public treasury;
    address public team;
    uint256 public capacity = 1;
    uint256 public totalMinted;
    bool public entropyEnabled = true;
    uint256[] public upsMultipliers;
    string public uri;  // Global rig metadata URI

    mapping(uint256 => Slot) public indexToSlot;
    mapping(uint64 => uint256) public sequenceToIndex;
    mapping(uint64 => uint256) public sequenceToEpoch;
    mapping(address => uint256) public accountToClaimable;

    /*----------  STRUCTS  ----------------------------------------------*/

    struct Config {
        uint256 epochPeriod;
        uint256 priceMultiplier;
        uint256 minInitPrice;
        uint256 initialUps;
        uint256 halvingAmount;
        uint256 tailUps;
        uint256[] upsMultipliers;
        uint256 upsMultiplierDuration;
    }

    struct Slot {
        uint256 epochId;
        uint256 initPrice;
        uint256 startTime;
        uint256 ups;
        uint256 upsMultiplier;
        uint256 lastUpsMultiplierTime;
        address miner;
        string uri;
    }

    /*----------  ERRORS  -----------------------------------------------*/

    error MineRig__ZeroAddress();
    error MineRig__ZeroMiner();
    error MineRig__IndexOutOfBounds();
    error MineRig__EpochIdMismatch();
    error MineRig__MaxPriceExceeded();
    error MineRig__DeadlinePassed();
    error MineRig__InsufficientFee();
    error MineRig__NoEntropyRequired();
    error MineRig__CapacityBelowCurrent();
    error MineRig__CapacityExceedsMax();
    error MineRig__UpsMultiplierOutOfRange();
    error MineRig__UpsMultipliersEmpty();
    error MineRig__UpsMultiplierDurationOutOfRange();
    error MineRig__EpochPeriodOutOfRange();
    error MineRig__PriceMultiplierOutOfRange();
    error MineRig__MinInitPriceOutOfRange();
    error MineRig__InitialUpsOutOfRange();
    error MineRig__TailUpsOutOfRange();
    error MineRig__HalvingAmountOutOfRange();
    error MineRig__NothingToClaim();

    /*----------  EVENTS  -----------------------------------------------*/

    event MineRig__Mine(
        address sender,
        address indexed miner,
        uint256 indexed index,
        uint256 indexed epochId,
        uint256 price,
        string uri
    );
    event MineRig__UpsMultiplierSet(uint256 indexed index, uint256 indexed epochId, uint256 upsMultiplier);
    event MineRig__EntropyRequested(uint256 indexed index, uint256 indexed epochId, uint64 indexed sequenceNumber);
    event MineRig__EntropyIgnored(uint256 indexed index, uint256 indexed epochId);
    event MineRig__MinerFee(address indexed miner, uint256 indexed index, uint256 indexed epochId, uint256 amount);
    event MineRig__TreasuryFee(address indexed treasury, uint256 indexed index, uint256 indexed epochId, uint256 amount);
    event MineRig__TeamFee(address indexed team, uint256 indexed index, uint256 indexed epochId, uint256 amount);
    event MineRig__ProtocolFee(address indexed protocol, uint256 indexed index, uint256 indexed epochId, uint256 amount);
    event MineRig__Mint(address indexed miner, uint256 indexed index, uint256 indexed epochId, uint256 amount);
    event MineRig__TreasurySet(address indexed treasury);
    event MineRig__TeamSet(address indexed team);
    event MineRig__CapacitySet(uint256 capacity);
    event MineRig__EntropyEnabledSet(bool enabled);
    event MineRig__UriSet(string uri);
    event MineRig__Claimed(address indexed account, uint256 amount);

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    /**
     * @notice Deploy a new MineRig contract.
     * @param _unit Unit token address
     * @param _quote Payment token address (e.g., USDC)
     * @param _core Core contract address
     * @param _treasury Treasury address for fee collection
     * @param _team Team address for fee collection
     * @param _entropy Pyth Entropy contract address
     * @param _config Configuration struct with auction and emission parameters
     */
    constructor(
        address _unit,
        address _quote,
        address _core,
        address _treasury,
        address _team,
        address _entropy,
        Config memory _config
    ) {
        // Validate addresses (protocol is resolved via core)
        if (_unit == address(0)) revert MineRig__ZeroAddress();
        if (_quote == address(0)) revert MineRig__ZeroAddress();
        if (_core == address(0)) revert MineRig__ZeroAddress();
        if (_treasury == address(0)) revert MineRig__ZeroAddress();
        if (_entropy == address(0)) revert MineRig__ZeroAddress();

        // Validate epoch period
        if (_config.epochPeriod < MIN_EPOCH_PERIOD || _config.epochPeriod > MAX_EPOCH_PERIOD) {
            revert MineRig__EpochPeriodOutOfRange();
        }

        // Validate price multiplier
        if (_config.priceMultiplier < MIN_PRICE_MULTIPLIER || _config.priceMultiplier > MAX_PRICE_MULTIPLIER) {
            revert MineRig__PriceMultiplierOutOfRange();
        }

        // Validate min init price
        if (_config.minInitPrice < ABS_MIN_INIT_PRICE || _config.minInitPrice > ABS_MAX_INIT_PRICE) {
            revert MineRig__MinInitPriceOutOfRange();
        }

        // Validate initial UPS
        if (_config.initialUps == 0) revert MineRig__InitialUpsOutOfRange();
        if (_config.initialUps > MAX_INITIAL_UPS) revert MineRig__InitialUpsOutOfRange();

        // Validate tail UPS
        if (_config.tailUps == 0 || _config.tailUps > _config.initialUps) revert MineRig__TailUpsOutOfRange();

        // Validate halving amount
        if (_config.halvingAmount < MIN_HALVING_AMOUNT || _config.halvingAmount > MAX_HALVING_AMOUNT) {
            revert MineRig__HalvingAmountOutOfRange();
        }

        // Validate upsMultiplierDuration
        if (_config.upsMultiplierDuration < MIN_UPS_MULTIPLIER_DURATION || _config.upsMultiplierDuration > MAX_UPS_MULTIPLIER_DURATION) {
            revert MineRig__UpsMultiplierDurationOutOfRange();
        }

        // Validate upsMultipliers (must have at least one)
        if (_config.upsMultipliers.length == 0) revert MineRig__UpsMultipliersEmpty();
        for (uint256 i = 0; i < _config.upsMultipliers.length;) {
            if (_config.upsMultipliers[i] < MIN_UPS_MULTIPLIER || _config.upsMultipliers[i] > MAX_UPS_MULTIPLIER) {
                revert MineRig__UpsMultiplierOutOfRange();
            }
            unchecked { ++i; }
        }

        // Set immutables
        unit = _unit;
        quote = _quote;
        core = _core;
        entropy = _entropy;
        startTime = block.timestamp;

        epochPeriod = _config.epochPeriod;
        priceMultiplier = _config.priceMultiplier;
        minInitPrice = _config.minInitPrice;
        initialUps = _config.initialUps;
        halvingAmount = _config.halvingAmount;
        tailUps = _config.tailUps;
        upsMultiplierDuration = _config.upsMultiplierDuration;

        // Set initial state
        treasury = _treasury;
        team = _team;
        upsMultipliers = _config.upsMultipliers;

        // Initialize slot 0 with the team as the first miner
        indexToSlot[0] = Slot({
            epochId: 2,
            initPrice: _config.minInitPrice,
            startTime: block.timestamp,
            ups: _config.initialUps,
            upsMultiplier: DEFAULT_UPS_MULTIPLIER,
            lastUpsMultiplierTime: block.timestamp,
            miner: _team,
            uri: ""
        });
        emit MineRig__Mine(_team, _team, 0, 1, 0, "");
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Mine a slot by paying the current Dutch auction price.
     * @param miner Address to set as the slot miner (receives future minted tokens)
     * @param index Slot index to mine
     * @param epochId Expected epoch ID (reverts if mismatched for frontrun protection)
     * @param deadline Transaction deadline timestamp
     * @param maxPrice Maximum price willing to pay (slippage protection)
     * @param _uri Metadata URI for this mining action
     * @return price Actual price paid
     */
    function mine(
        address miner,
        uint256 index,
        uint256 epochId,
        uint256 deadline,
        uint256 maxPrice,
        string calldata _uri
    ) external payable nonReentrant returns (uint256 price) {
        if (miner == address(0)) revert MineRig__ZeroMiner();
        if (block.timestamp > deadline) revert MineRig__DeadlinePassed();
        if (index >= capacity) revert MineRig__IndexOutOfBounds();

        Slot memory slotCache = indexToSlot[index];

        if (epochId != slotCache.epochId) revert MineRig__EpochIdMismatch();

        price = _getPriceFromCache(slotCache);
        if (price > maxPrice) revert MineRig__MaxPriceExceeded();

        if (price > 0) {
            // Transfer full price to this contract
            IERC20(quote).safeTransferFrom(msg.sender, address(this), price);

            // Calculate fees
            uint256 minerFee = price * (DIVISOR - TOTAL_BPS) / DIVISOR;
            address protocol = IMineCore(core).protocolFeeAddress();
            uint256 teamFee = team != address(0) ? price * TEAM_BPS / DIVISOR : 0;
            uint256 protocolFee = protocol != address(0) ? price * PROTOCOL_BPS / DIVISOR : 0;
            uint256 treasuryFee = price - minerFee - teamFee - protocolFee; // remainder collects dust

            // Distribute fees
            accountToClaimable[slotCache.miner] += minerFee;
            emit MineRig__MinerFee(slotCache.miner, index, epochId, minerFee);

            IERC20(quote).safeTransfer(treasury, treasuryFee);
            emit MineRig__TreasuryFee(treasury, index, epochId, treasuryFee);

            if (teamFee > 0) {
                IERC20(quote).safeTransfer(team, teamFee);
                emit MineRig__TeamFee(team, index, epochId, teamFee);
            }

            if (protocolFee > 0) {
                IERC20(quote).safeTransfer(protocol, protocolFee);
                emit MineRig__ProtocolFee(protocol, index, epochId, protocolFee);
            }
        }

        uint256 newInitPrice = price * priceMultiplier / PRECISION;

        if (newInitPrice > ABS_MAX_INIT_PRICE) {
            newInitPrice = ABS_MAX_INIT_PRICE;
        } else if (newInitPrice < minInitPrice) {
            newInitPrice = minInitPrice;
        }

        uint256 mineTime = block.timestamp - slotCache.startTime;
        uint256 minedAmount = mineTime * slotCache.ups * slotCache.upsMultiplier / PRECISION;

        if (slotCache.miner != address(0)) {
            totalMinted += minedAmount;
            IUnit(unit).mint(slotCache.miner, minedAmount);
            emit MineRig__Mint(slotCache.miner, index, epochId, minedAmount);
        }

        unchecked {
            slotCache.epochId++;
        }
        slotCache.initPrice = newInitPrice;
        slotCache.startTime = block.timestamp;
        slotCache.miner = miner;
        slotCache.ups = _getUpsFromSupply() / capacity;
        slotCache.uri = _uri;

        bool shouldUpdateUpsMultiplier = block.timestamp - slotCache.lastUpsMultiplierTime > upsMultiplierDuration;
        if (shouldUpdateUpsMultiplier) {
            slotCache.upsMultiplier = DEFAULT_UPS_MULTIPLIER;
            slotCache.lastUpsMultiplierTime = block.timestamp;
            emit MineRig__UpsMultiplierSet(index, slotCache.epochId, DEFAULT_UPS_MULTIPLIER);
        }

        indexToSlot[index] = slotCache;

        emit MineRig__Mine(msg.sender, miner, index, epochId, price, _uri);

        // Only request entropy if randomness is enabled and upsMultiplier needs updating
        if (entropyEnabled && shouldUpdateUpsMultiplier) {
            uint128 fee = IEntropyV2(entropy).getFeeV2();
            if (msg.value < fee) revert MineRig__InsufficientFee();
            uint64 seq = IEntropyV2(entropy).requestV2{value: fee}();
            sequenceToIndex[seq] = index;
            sequenceToEpoch[seq] = slotCache.epochId;
            emit MineRig__EntropyRequested(index, slotCache.epochId, seq);
            // Excess ETH stays in contract
        } else if (msg.value > 0) {
            revert MineRig__NoEntropyRequired();
        }

        return price;
    }

    /**
     * @notice Claim accumulated miner fees for an account.
     * @dev Uses pull pattern to avoid issues with blacklisted addresses blocking mining.
     *      Anyone can trigger a claim for any account. Funds go to the account, not caller.
     * @param account The account to claim for
     */
    function claim(address account) external nonReentrant {
        if (account == address(0)) revert MineRig__ZeroAddress();
        uint256 amount = accountToClaimable[account];
        if (amount == 0) revert MineRig__NothingToClaim();
        accountToClaimable[account] = 0;
        IERC20(quote).safeTransfer(account, amount);
        emit MineRig__Claimed(account, amount);
    }

    /*----------  RESTRICTED FUNCTIONS  ---------------------------------*/

    /**
     * @notice Update the treasury address for fee collection.
     * @param _treasury New treasury address (cannot be zero)
     */
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert MineRig__ZeroAddress();
        treasury = _treasury;
        emit MineRig__TreasurySet(_treasury);
    }

    /**
     * @notice Update the team address for fee collection.
     * @dev Can be set to address(0) to disable team fees (redirects to treasury).
     * @param _team New team address
     */
    function setTeam(address _team) external onlyOwner {
        team = _team;
        emit MineRig__TeamSet(_team);
    }

    /**
     * @notice Increase the number of mining slots.
     * @dev Can only increase, never decrease.
     * @param _capacity New capacity (must be greater than current)
     */
    function setCapacity(uint256 _capacity) external onlyOwner {
        if (_capacity <= capacity) revert MineRig__CapacityBelowCurrent();
        if (_capacity > MAX_CAPACITY) revert MineRig__CapacityExceedsMax();
        capacity = _capacity;
        emit MineRig__CapacitySet(_capacity);
    }

    /**
     * @notice Enable or disable entropy for UPS multipliers.
     * @param _enabled True to enable entropy-based random multipliers
     */
    function setEntropyEnabled(bool _enabled) external onlyOwner {
        entropyEnabled = _enabled;
        emit MineRig__EntropyEnabledSet(_enabled);
    }

    /**
     * @notice Update the global metadata URI for the rig.
     * @param _uri New metadata URI (e.g., for logo, branding)
     */
    function setUri(string calldata _uri) external onlyOwner {
        uri = _uri;
        emit MineRig__UriSet(_uri);
    }

    /*----------  INTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Callback from Pyth Entropy with random number for UPS multiplier.
     * @dev Called by Entropy contract after randomness is generated.
     *      Ignores stale callbacks (epoch changed) or empty slots.
     * @param sequenceNumber Entropy request sequence number
     * @param randomNumber Random bytes32 from Pyth Entropy
     */
    function entropyCallback(uint64 sequenceNumber, address, /*provider*/ bytes32 randomNumber) internal override {
        uint256 index = sequenceToIndex[sequenceNumber];
        uint256 epoch = sequenceToEpoch[sequenceNumber];

        delete sequenceToIndex[sequenceNumber];
        delete sequenceToEpoch[sequenceNumber];

        Slot memory slotCache = indexToSlot[index];
        if (slotCache.epochId != epoch || slotCache.miner == address(0)) {
            emit MineRig__EntropyIgnored(index, epoch);
            return;
        }

        uint256 upsMultiplier = _drawUpsMultiplier(randomNumber);
        slotCache.upsMultiplier = upsMultiplier;
        slotCache.lastUpsMultiplierTime = block.timestamp;

        indexToSlot[index] = slotCache;
        emit MineRig__UpsMultiplierSet(index, epoch, upsMultiplier);
    }

    /**
     * @notice Get the Entropy contract address (required by IEntropyConsumer).
     * @return Entropy contract address
     */
    function getEntropy() internal view override returns (address) {
        return entropy;
    }

    /**
     * @notice Draw a random UPS multiplier from the configured array.
     * @dev Uses modulo to select index from upsMultipliers array.
     * @param randomNumber Random bytes32 to use for selection
     * @return Selected multiplier value (1e18 = 1x, 10e18 = 10x)
     */
    function _drawUpsMultiplier(bytes32 randomNumber) internal view returns (uint256) {
        uint256 length = upsMultipliers.length;
        if (length == 0) return DEFAULT_UPS_MULTIPLIER;
        uint256 idx = uint256(randomNumber) % length;
        return upsMultipliers[idx];
    }

    /**
     * @notice Calculate current Dutch auction price from cached slot state.
     * @dev Price decays linearly from initPrice to 0 over epochPeriod.
     * @param slotCache Cached slot state to calculate price from
     * @return Current price (0 if epoch has expired)
     */
    function _getPriceFromCache(Slot memory slotCache) internal view returns (uint256) {
        uint256 timePassed = block.timestamp - slotCache.startTime;

        if (timePassed > epochPeriod) {
            return 0;
        }

        return slotCache.initPrice - slotCache.initPrice * timePassed / epochPeriod;
    }

    /**
     * @notice Calculate current UPS based on total minted and halving schedule.
     * @dev Implements a Bitcoin-like halving mechanism where UPS halves at each threshold.
     *
     *      Threshold Formula (geometric series):
     *        threshold[0] = halvingAmount                           (1st halving)
     *        threshold[1] = halvingAmount + halvingAmount/2         (2nd halving)
     *        threshold[2] = halvingAmount + halvingAmount/2 + halvingAmount/4  (3rd halving)
     *        ...
     *        threshold[n] = halvingAmount * (2 - 1/2^n) ≈ 2 * halvingAmount (limit)
     *
     *      Example with halvingAmount = 1000, initialUps = 100:
     *        totalMinted < 1000:  ups = 100 (0 halvings)
     *        totalMinted < 1500:  ups = 50  (1 halving)
     *        totalMinted < 1750:  ups = 25  (2 halvings)
     *        totalMinted < 1875:  ups = 12  (3 halvings)
     *        ...continues until ups reaches tailUps floor
     *
     *      The loop is bounded at 64 iterations to prevent infinite loops.
     *      UPS is floored at tailUps to ensure mining never fully stops.
     *
     * @return ups Current units per second (before capacity division)
     */
    function _getUpsFromSupply() internal view returns (uint256 ups) {
        uint256 halvings = 0;
        uint256 threshold = halvingAmount;

        // Count how many halving thresholds have been crossed
        while (totalMinted >= threshold && halvings < 64) {
            halvings++;
            threshold += halvingAmount >> halvings; // Add next halving increment
        }

        // Apply halvings via bit shift (equivalent to dividing by 2^halvings)
        ups = initialUps >> halvings;
        if (ups < tailUps) ups = tailUps;
        return ups;
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Get the current VRF fee required for entropy.
     * @return Current entropy fee in wei
     */
    function getEntropyFee() external view returns (uint256) {
        return IEntropyV2(entropy).getFeeV2();
    }

    /**
     * @notice Get the current Dutch auction price for a slot.
     * @param index Slot index to query
     * @return Current price (linearly decays from initPrice to 0 over epochPeriod)
     */
    function getPrice(uint256 index) external view returns (uint256) {
        return _getPriceFromCache(indexToSlot[index]);
    }

    /**
     * @notice Get the current global units per second emission rate.
     * @return Current UPS (before capacity division)
     */
    function getUps() external view returns (uint256) {
        return _getUpsFromSupply();
    }

    /**
     * @notice Get the full state of a mining slot.
     * @param index Slot index to query
     * @return Slot struct with all state fields
     */
    function getSlot(uint256 index) external view returns (Slot memory) {
        return indexToSlot[index];
    }

    /**
     * @notice Get the full UPS multipliers array.
     * @return Array of possible UPS multiplier values
     */
    function getUpsMultipliers() external view returns (uint256[] memory) {
        return upsMultipliers;
    }

    /**
     * @notice Get the length of the UPS multipliers array.
     * @return Number of multiplier options
     */
    function getUpsMultipliersLength() external view returns (uint256) {
        return upsMultipliers.length;
    }

}
