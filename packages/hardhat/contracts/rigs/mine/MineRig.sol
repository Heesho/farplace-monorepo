// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IEntropyV2} from "@pythnetwork/entropy-sdk-solidity/IEntropyV2.sol";
import {IEntropyConsumer} from "@pythnetwork/entropy-sdk-solidity/IEntropyConsumer.sol";
import {IUnit} from "../../interfaces/IUnit.sol";

/**
 * @title MineRig
 * @author heesho
 * @notice A mine-based mining rig contract that uses Dutch auctions for slot acquisition.
 *         Miners compete to control slots, paying fees that are distributed to
 *         protocol, treasury, team, and previous miners. Unit tokens are minted
 *         based on time held and multiplier bonuses from optional Pyth Entropy randomness.
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
    address public immutable protocol;  // Protocol fee recipient
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
    bool public multipliersEnabled;
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

    error Rig__ZeroAddress();
    error Rig__ZeroMiner();
    error Rig__IndexOutOfBounds();
    error Rig__EpochIdMismatch();
    error Rig__MaxPriceExceeded();
    error Rig__DeadlinePassed();
    error Rig__InsufficientFee();
    error Rig__NoEntropyRequired();
    error Rig__ZeroTreasury();
    error Rig__CapacityBelowCurrent();
    error Rig__CapacityExceedsMax();
    error Rig__UpsMultiplierOutOfRange();
    error Rig__UpsMultiplierDurationOutOfRange();
    error Rig__EpochPeriodOutOfRange();
    error Rig__PriceMultiplierOutOfRange();
    error Rig__MinInitPriceOutOfRange();
    error Rig__ZeroInitialUps();
    error Rig__InitialUpsExceedsMax();
    error Rig__TailUpsOutOfRange();
    error Rig__ZeroHalvingAmount();
    error Rig__HalvingAmountBelowMin();
    error Rig__NothingToClaim();

    /*----------  EVENTS  -----------------------------------------------*/

    event Rig__Mine(
        address sender,
        address indexed miner,
        uint256 indexed index,
        uint256 indexed epochId,
        uint256 price,
        string uri
    );
    event Rig__UpsMultiplierSet(uint256 indexed index, uint256 indexed epochId, uint256 upsMultiplier);
    event Rig__EntropyRequested(uint256 indexed index, uint256 indexed epochId, uint64 indexed sequenceNumber);
    event Rig__ProtocolFee(address indexed protocol, uint256 indexed index, uint256 indexed epochId, uint256 amount);
    event Rig__TreasuryFee(address indexed treasury, uint256 indexed index, uint256 indexed epochId, uint256 amount);
    event Rig__TeamFee(address indexed team, uint256 indexed index, uint256 indexed epochId, uint256 amount);
    event Rig__MinerFee(address indexed miner, uint256 indexed index, uint256 indexed epochId, uint256 amount);
    event Rig__Mint(address indexed miner, uint256 indexed index, uint256 indexed epochId, uint256 amount);
    event Rig__TreasurySet(address indexed treasury);
    event Rig__TeamSet(address indexed team);
    event Rig__CapacitySet(uint256 capacity);
    event Rig__MultipliersEnabledSet(bool enabled);
    event Rig__UriSet(string uri);
    event Rig__Claimed(address indexed account, uint256 amount);

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    constructor(
        address _unit,
        address _quote,
        address _entropy,
        address _protocol,
        address _treasury,
        Config memory _config
    ) {
        // Validate addresses (protocol can be zero - fee redirects to treasury)
        if (_unit == address(0)) revert Rig__ZeroAddress();
        if (_quote == address(0)) revert Rig__ZeroAddress();
        if (_entropy == address(0)) revert Rig__ZeroAddress();
        if (_treasury == address(0)) revert Rig__ZeroAddress();

        // Validate epoch period
        if (_config.epochPeriod < MIN_EPOCH_PERIOD || _config.epochPeriod > MAX_EPOCH_PERIOD) {
            revert Rig__EpochPeriodOutOfRange();
        }

        // Validate price multiplier
        if (_config.priceMultiplier < MIN_PRICE_MULTIPLIER || _config.priceMultiplier > MAX_PRICE_MULTIPLIER) {
            revert Rig__PriceMultiplierOutOfRange();
        }

        // Validate min init price
        if (_config.minInitPrice < ABS_MIN_INIT_PRICE || _config.minInitPrice > ABS_MAX_INIT_PRICE) {
            revert Rig__MinInitPriceOutOfRange();
        }

        // Validate initial UPS
        if (_config.initialUps == 0) revert Rig__ZeroInitialUps();
        if (_config.initialUps > MAX_INITIAL_UPS) revert Rig__InitialUpsExceedsMax();

        // Validate tail UPS
        if (_config.tailUps == 0 || _config.tailUps > _config.initialUps) revert Rig__TailUpsOutOfRange();

        // Validate halving amount
        if (_config.halvingAmount == 0) revert Rig__ZeroHalvingAmount();
        if (_config.halvingAmount < MIN_HALVING_AMOUNT) revert Rig__HalvingAmountBelowMin();

        // Validate upsMultiplierDuration
        if (_config.upsMultiplierDuration < MIN_UPS_MULTIPLIER_DURATION || _config.upsMultiplierDuration > MAX_UPS_MULTIPLIER_DURATION) {
            revert Rig__UpsMultiplierDurationOutOfRange();
        }

        // Validate upsMultipliers (empty is OK - means no multipliers, always 1x)
        for (uint256 i = 0; i < _config.upsMultipliers.length;) {
            if (_config.upsMultipliers[i] < MIN_UPS_MULTIPLIER || _config.upsMultipliers[i] > MAX_UPS_MULTIPLIER) {
                revert Rig__UpsMultiplierOutOfRange();
            }
            unchecked { ++i; }
        }

        // Set immutables
        unit = _unit;
        quote = _quote;
        entropy = _entropy;
        protocol = _protocol;
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
        upsMultipliers = _config.upsMultipliers;
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
        if (miner == address(0)) revert Rig__ZeroMiner();
        if (block.timestamp > deadline) revert Rig__DeadlinePassed();
        if (index >= capacity) revert Rig__IndexOutOfBounds();

        Slot memory slotCache = indexToSlot[index];

        if (epochId != slotCache.epochId) revert Rig__EpochIdMismatch();

        price = _getPriceFromCache(slotCache);
        if (price > maxPrice) revert Rig__MaxPriceExceeded();

        if (price > 0) {
            // Transfer full price to this contract
            IERC20(quote).safeTransferFrom(msg.sender, address(this), price);

            // Calculate fees
            uint256 minerFee = price * (DIVISOR - TOTAL_BPS) / DIVISOR;
            uint256 protocolFee = protocol != address(0) ? price * PROTOCOL_BPS / DIVISOR : 0;
            uint256 teamFee = team != address(0) ? price * TEAM_BPS / DIVISOR : 0;
            uint256 treasuryFee = price - minerFee - protocolFee - teamFee; // remainder collects dust

            // Distribute fees
            accountToClaimable[slotCache.miner] += minerFee;
            emit Rig__MinerFee(slotCache.miner, index, epochId, minerFee);

            IERC20(quote).safeTransfer(treasury, treasuryFee);
            emit Rig__TreasuryFee(treasury, index, epochId, treasuryFee);

            if (protocolFee > 0) {
                IERC20(quote).safeTransfer(protocol, protocolFee);
                emit Rig__ProtocolFee(protocol, index, epochId, protocolFee);
            }

            if (teamFee > 0) {
                IERC20(quote).safeTransfer(team, teamFee);
                emit Rig__TeamFee(team, index, epochId, teamFee);
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
            emit Rig__Mint(slotCache.miner, index, epochId, minedAmount);
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
            emit Rig__UpsMultiplierSet(index, slotCache.epochId, DEFAULT_UPS_MULTIPLIER);
        }

        indexToSlot[index] = slotCache;

        emit Rig__Mine(msg.sender, miner, index, epochId, price, _uri);

        // Only request entropy if randomness is enabled and upsMultiplier needs updating
        if (multipliersEnabled && shouldUpdateUpsMultiplier) {
            uint128 fee = IEntropyV2(entropy).getFeeV2();
            if (msg.value < fee) revert Rig__InsufficientFee();
            uint64 seq = IEntropyV2(entropy).requestV2{value: fee}();
            sequenceToIndex[seq] = index;
            sequenceToEpoch[seq] = slotCache.epochId;
            emit Rig__EntropyRequested(index, slotCache.epochId, seq);
            // Excess ETH stays in contract
        } else if (msg.value > 0) {
            revert Rig__NoEntropyRequired();
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
        uint256 amount = accountToClaimable[account];
        if (amount == 0) revert Rig__NothingToClaim();
        accountToClaimable[account] = 0;
        IERC20(quote).safeTransfer(account, amount);
        emit Rig__Claimed(account, amount);
    }

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
        if (slotCache.epochId != epoch || slotCache.miner == address(0)) return;

        uint256 upsMultiplier = _drawUpsMultiplier(randomNumber);
        slotCache.upsMultiplier = upsMultiplier;
        slotCache.lastUpsMultiplierTime = block.timestamp;

        indexToSlot[index] = slotCache;
        emit Rig__UpsMultiplierSet(index, epoch, upsMultiplier);
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

    /*----------  OWNER FUNCTIONS  --------------------------------------*/

    /**
     * @notice Update the treasury address for fee collection.
     * @param _treasury New treasury address (cannot be zero)
     */
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert Rig__ZeroTreasury();
        treasury = _treasury;
        emit Rig__TreasurySet(_treasury);
    }

    /**
     * @notice Update the team address for fee collection.
     * @dev Can be set to address(0) to disable team fees (redirects to treasury).
     * @param _team New team address
     */
    function setTeam(address _team) external onlyOwner {
        team = _team;
        emit Rig__TeamSet(_team);
    }

    /**
     * @notice Increase the number of mining slots.
     * @dev Can only increase, never decrease.
     * @param _capacity New capacity (must be greater than current)
     */
    function setCapacity(uint256 _capacity) external onlyOwner {
        if (_capacity <= capacity) revert Rig__CapacityBelowCurrent();
        if (_capacity > MAX_CAPACITY) revert Rig__CapacityExceedsMax();
        capacity = _capacity;
        emit Rig__CapacitySet(_capacity);
    }

    /**
     * @notice Enable or disable multipliers for UPS.
     * @param _enabled True to enable entropy-based random multipliers
     */
    function setMultipliersEnabled(bool _enabled) external onlyOwner {
        multipliersEnabled = _enabled;
        emit Rig__MultipliersEnabledSet(_enabled);
    }

    /**
     * @notice Update the global metadata URI for the rig.
     * @param _uri New metadata URI (e.g., for logo, branding)
     */
    function setUri(string calldata _uri) external onlyOwner {
        uri = _uri;
        emit Rig__UriSet(_uri);
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    function getEntropy() internal view override returns (address) {
        return entropy;
    }

    function getEntropyFee() external view returns (uint256) {
        return IEntropyV2(entropy).getFeeV2();
    }

    function getPrice(uint256 index) external view returns (uint256) {
        return _getPriceFromCache(indexToSlot[index]);
    }

    function getUps() external view returns (uint256) {
        return _getUpsFromSupply();
    }

    function getSlot(uint256 index) external view returns (Slot memory) {
        return indexToSlot[index];
    }

    function getUpsMultipliers() external view returns (uint256[] memory) {
        return upsMultipliers;
    }

    function getUpsMultipliersLength() external view returns (uint256) {
        return upsMultipliers.length;
    }

    function isMultipliersEnabled() external view returns (bool) {
        return multipliersEnabled;
    }
}
