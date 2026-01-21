// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IEntropyV2} from "@pythnetwork/entropy-sdk-solidity/IEntropyV2.sol";
import {IEntropyConsumer} from "@pythnetwork/entropy-sdk-solidity/IEntropyConsumer.sol";
import {IUnit} from "../../interfaces/IUnit.sol";
import {ISlotCore} from "./interfaces/ISlotCore.sol";

/**
 * @title SlotRig
 * @author heesho
 * @notice A slot machine-style mining rig where users slot to win Unit tokens from a prize pool.
 * @dev Users pay a Dutch auction-style price to slot. Pyth Entropy VRF determines the payout
 *      percentage from a configurable odds array. Emissions accumulate in the prize pool.
 *
 *      Mechanics:
 *      - Slot price starts high and decays linearly each epoch
 *      - VRF randomness determines payout percentage of prize pool
 *      - Emissions continuously accumulate in the prize pool
 *      - Emissions halve over time with a tail rate floor
 *
 *      Fee Split:
 *      - 95% to Treasury
 *      - 4% to Team
 *      - 1% to Protocol
 */
contract SlotRig is IEntropyConsumer, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    /*----------  CONSTANTS  --------------------------------------------*/

    uint256 public constant TEAM_BPS = 400; // 4% to team
    uint256 public constant PROTOCOL_BPS = 100; // 1% to protocol
    // Treasury receives remainder (95%)
    uint256 public constant DIVISOR = 10_000;
    uint256 public constant PRECISION = 1e18;

    // Dutch auction bounds
    uint256 public constant MIN_EPOCH_PERIOD = 10 minutes;
    uint256 public constant MAX_EPOCH_PERIOD = 365 days;
    uint256 public constant MIN_PRICE_MULTIPLIER = 1.1e18;
    uint256 public constant MAX_PRICE_MULTIPLIER = 3e18;
    uint256 public constant ABS_MIN_INIT_PRICE = 1e6;
    uint256 public constant ABS_MAX_INIT_PRICE = type(uint192).max;

    // Emission bounds
    uint256 public constant MAX_INITIAL_UPS = 1e24;
    uint256 public constant MIN_HALVING_PERIOD = 7 days;
    uint256 public constant MAX_HALVING_PERIOD = 365 days;

    // Odds validation (basis points: 10000 = 100%)
    uint256 public constant MIN_ODDS_BPS = 100; // Minimum 1% payout per slot
    uint256 public constant MAX_ODDS_BPS = 10000; // Maximum 100%

    /*----------  IMMUTABLES  -------------------------------------------*/

    address public immutable unit;
    address public immutable quote;
    address public immutable core;
    IEntropyV2 public immutable entropy;
    uint256 public immutable startTime;

    // Configurable emission parameters
    uint256 public immutable initialUps;
    uint256 public immutable tailUps;
    uint256 public immutable halvingPeriod;

    // Configurable auction parameters
    uint256 public immutable epochPeriod;
    uint256 public immutable priceMultiplier;
    uint256 public immutable minInitPrice;

    /*----------  STATE  ------------------------------------------------*/

    address public treasury;
    address public team;

    // Dutch auction state
    uint256 public epochId;
    uint256 public initPrice;
    uint256 public slotStartTime;

    // Track last emission mint time for prize pool accumulation
    uint256 public lastEmissionTime;

    // Odds array in basis points
    uint256[] public odds;

    // Pending slots waiting for VRF callback
    mapping(uint64 => address) public sequenceToSlotner;
    mapping(uint64 => uint256) public sequenceToEpoch;

    /*----------  ERRORS  -----------------------------------------------*/

    error SlotRig__InvalidSlotner();
    error SlotRig__EpochIdMismatch();
    error SlotRig__MaxPriceExceeded();
    error SlotRig__Expired();
    error SlotRig__InsufficientFee();
    error SlotRig__InvalidAddress();
    error SlotRig__InvalidOdds();
    error SlotRig__OddsTooLow();
    error SlotRig__EpochPeriodOutOfRange();
    error SlotRig__PriceMultiplierOutOfRange();
    error SlotRig__MinInitPriceOutOfRange();
    error SlotRig__InitialUpsOutOfRange();
    error SlotRig__TailUpsOutOfRange();
    error SlotRig__HalvingPeriodOutOfRange();

    /*----------  EVENTS  -----------------------------------------------*/

    event SlotRig__Slot(
        address indexed sender,
        address indexed slotner,
        uint256 indexed epochId,
        uint256 price
    );
    event SlotRig__Win(
        address indexed slotner,
        uint256 indexed epochId,
        uint256 oddsBps,
        uint256 amount
    );
    event SlotRig__EntropyRequested(uint256 indexed epochId, uint64 indexed sequenceNumber);
    event SlotRig__TreasuryFee(address indexed treasury, uint256 indexed epochId, uint256 amount);
    event SlotRig__TeamFee(address indexed team, uint256 indexed epochId, uint256 amount);
    event SlotRig__ProtocolFee(address indexed protocol, uint256 indexed epochId, uint256 amount);
    event SlotRig__EmissionMinted(uint256 indexed epochId, uint256 amount);
    event SlotRig__TreasurySet(address indexed treasury);
    event SlotRig__TeamSet(address indexed team);
    event SlotRig__OddsSet(uint256[] odds);

    /*----------  STRUCTS  ----------------------------------------------*/

    struct Config {
        uint256 epochPeriod;
        uint256 priceMultiplier;
        uint256 minInitPrice;
        uint256 initialUps;
        uint256 halvingPeriod;
        uint256 tailUps;
    }

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    /**
     * @notice Deploy a new SlotRig contract.
     * @param _unit Unit token address
     * @param _quote Payment token address (e.g., USDC)
     * @param _entropy Pyth Entropy contract address
     * @param _treasury Treasury address for fee collection
     * @param _core Core contract address
     * @param config Configuration struct with auction and emission parameters
     */
    constructor(
        address _unit,
        address _quote,
        address _entropy,
        address _treasury,
        address _core,
        Config memory config
    ) {
        if (_unit == address(0)) revert SlotRig__InvalidAddress();
        if (_quote == address(0)) revert SlotRig__InvalidAddress();
        if (_entropy == address(0)) revert SlotRig__InvalidAddress();
        if (_treasury == address(0)) revert SlotRig__InvalidAddress();
        if (_core == address(0)) revert SlotRig__InvalidAddress();

        // Validate config
        if (config.epochPeriod < MIN_EPOCH_PERIOD || config.epochPeriod > MAX_EPOCH_PERIOD) {
            revert SlotRig__EpochPeriodOutOfRange();
        }
        if (config.priceMultiplier < MIN_PRICE_MULTIPLIER || config.priceMultiplier > MAX_PRICE_MULTIPLIER) {
            revert SlotRig__PriceMultiplierOutOfRange();
        }
        if (config.minInitPrice < ABS_MIN_INIT_PRICE || config.minInitPrice > ABS_MAX_INIT_PRICE) {
            revert SlotRig__MinInitPriceOutOfRange();
        }
        if (config.initialUps == 0 || config.initialUps > MAX_INITIAL_UPS) {
            revert SlotRig__InitialUpsOutOfRange();
        }
        if (config.tailUps == 0 || config.tailUps > config.initialUps) {
            revert SlotRig__TailUpsOutOfRange();
        }
        if (config.halvingPeriod < MIN_HALVING_PERIOD || config.halvingPeriod > MAX_HALVING_PERIOD) {
            revert SlotRig__HalvingPeriodOutOfRange();
        }

        unit = _unit;
        quote = _quote;
        entropy = IEntropyV2(_entropy);
        treasury = _treasury;
        core = _core;

        epochPeriod = config.epochPeriod;
        priceMultiplier = config.priceMultiplier;
        minInitPrice = config.minInitPrice;
        initialUps = config.initialUps;
        tailUps = config.tailUps;
        halvingPeriod = config.halvingPeriod;

        startTime = block.timestamp;
        lastEmissionTime = block.timestamp;
        slotStartTime = block.timestamp;
        initPrice = config.minInitPrice;

        // Default odds: 1% payout (can be changed by owner)
        odds.push(MIN_ODDS_BPS);
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Slot the slot machine to win Unit tokens from the prize pool.
     * @dev Pays the current Dutch auction price, then VRF determines payout percentage.
     * @param slotner Address to receive winnings
     * @param _epochId Expected epoch (frontrun protection)
     * @param deadline Transaction deadline
     * @param maxPrice Maximum price willing to pay (slippage protection)
     * @return price Actual price paid
     */
    function slot(
        address slotner,
        uint256 _epochId,
        uint256 deadline,
        uint256 maxPrice
    ) external payable nonReentrant returns (uint256 price) {
        if (slotner == address(0)) revert SlotRig__InvalidSlotner();
        if (block.timestamp > deadline) revert SlotRig__Expired();
        if (_epochId != epochId) revert SlotRig__EpochIdMismatch();

        price = getPrice();
        if (price > maxPrice) revert SlotRig__MaxPriceExceeded();

        // Distribute fees from slot price
        if (price > 0) {
            address protocol = ISlotCore(core).protocolFeeAddress();
            uint256 teamFee = team != address(0) ? price * TEAM_BPS / DIVISOR : 0;
            uint256 protocolFee = protocol != address(0) ? price * PROTOCOL_BPS / DIVISOR : 0;
            uint256 treasuryFee = price - teamFee - protocolFee;

            IERC20(quote).safeTransferFrom(msg.sender, treasury, treasuryFee);
            emit SlotRig__TreasuryFee(treasury, epochId, treasuryFee);

            if (teamFee > 0) {
                IERC20(quote).safeTransferFrom(msg.sender, team, teamFee);
                emit SlotRig__TeamFee(team, epochId, teamFee);
            }

            if (protocolFee > 0) {
                IERC20(quote).safeTransferFrom(msg.sender, protocol, protocolFee);
                emit SlotRig__ProtocolFee(protocol, epochId, protocolFee);
            }
        }

        // Mint accumulated emissions to prize pool (this contract)
        uint256 emissionAmount = _mintEmissions();
        if (emissionAmount > 0) {
            emit SlotRig__EmissionMinted(epochId, emissionAmount);
        }

        // Update Dutch auction for next epoch
        uint256 newInitPrice = price * priceMultiplier / PRECISION;
        if (newInitPrice > ABS_MAX_INIT_PRICE) {
            newInitPrice = ABS_MAX_INIT_PRICE;
        } else if (newInitPrice < minInitPrice) {
            newInitPrice = minInitPrice;
        }

        uint256 currentEpochId = epochId;
        unchecked {
            epochId++;
        }
        initPrice = newInitPrice;
        slotStartTime = block.timestamp;

        emit SlotRig__Slot(msg.sender, slotner, currentEpochId, price);

        // Request VRF for slot outcome
        uint128 fee = entropy.getFeeV2();
        if (msg.value < fee) revert SlotRig__InsufficientFee();
        uint64 seq = entropy.requestV2{value: fee}();
        sequenceToSlotner[seq] = slotner;
        sequenceToEpoch[seq] = epochId; // Store the NEW epoch (post-increment)
        emit SlotRig__EntropyRequested(epochId, seq);

        return price;
    }

    /*----------  ENTROPY CALLBACK  -------------------------------------*/

    /**
     * @notice Callback from Pyth Entropy with VRF result.
     * @dev Determines payout from odds array and transfers winnings.
     */
    function entropyCallback(uint64 sequenceNumber, address, bytes32 randomNumber) internal override {
        address slotner = sequenceToSlotner[sequenceNumber];
        uint256 epoch = sequenceToEpoch[sequenceNumber];

        delete sequenceToSlotner[sequenceNumber];
        delete sequenceToEpoch[sequenceNumber];

        // Validate slotner still exists
        if (slotner == address(0)) return;

        // Draw odds and calculate winnings
        uint256 oddsBps = _drawOdds(randomNumber);
        uint256 pool = IERC20(unit).balanceOf(address(this));
        uint256 winAmount = pool * oddsBps / DIVISOR;

        if (winAmount > 0) {
            IERC20(unit).safeTransfer(slotner, winAmount);
        }

        emit SlotRig__Win(slotner, epoch, oddsBps, winAmount);
    }

    /*----------  INTERNAL FUNCTIONS  -----------------------------------*/

    function _drawOdds(bytes32 randomNumber) internal view returns (uint256) {
        uint256 length = odds.length;
        if (length == 0) return MIN_ODDS_BPS;
        uint256 index = uint256(randomNumber) % length;
        return odds[index];
    }

    function _mintEmissions() internal returns (uint256 amount) {
        uint256 timeElapsed = block.timestamp - lastEmissionTime;
        if (timeElapsed == 0) return 0;

        uint256 ups = _getUpsFromTime(block.timestamp);
        amount = timeElapsed * ups;

        if (amount > 0) {
            IUnit(unit).mint(address(this), amount);
        }

        lastEmissionTime = block.timestamp;
        return amount;
    }

    function _getUpsFromTime(uint256 time) internal view returns (uint256 ups) {
        uint256 halvings = time <= startTime ? 0 : (time - startTime) / halvingPeriod;
        ups = initialUps >> halvings;
        if (ups < tailUps) ups = tailUps;
        return ups;
    }

    function _validateAndSetOdds(uint256[] memory _odds) internal {
        uint256 length = _odds.length;
        if (length == 0) revert SlotRig__InvalidOdds();

        for (uint256 i = 0; i < length; i++) {
            if (_odds[i] < MIN_ODDS_BPS) revert SlotRig__OddsTooLow();
            if (_odds[i] > MAX_ODDS_BPS) revert SlotRig__InvalidOdds();
        }

        odds = _odds;
        emit SlotRig__OddsSet(_odds);
    }

    /*----------  RESTRICTED FUNCTIONS  ---------------------------------*/

    /**
     * @notice Update the treasury address.
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert SlotRig__InvalidAddress();
        treasury = _treasury;
        emit SlotRig__TreasurySet(_treasury);
    }

    /**
     * @notice Update the team address.
     * @dev Can be set to address(0) to redirect team fees to treasury.
     * @param _team New team address (or address(0) to disable)
     */
    function setTeam(address _team) external onlyOwner {
        team = _team;
        emit SlotRig__TeamSet(_team);
    }

    /**
     * @notice Update the odds array for slot payouts.
     * @dev Each element is a payout percentage in basis points (100 = 1%).
     * @param _odds New odds array
     */
    function setOdds(uint256[] calldata _odds) external onlyOwner {
        _validateAndSetOdds(_odds);
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Get the Entropy contract address (required by IEntropyConsumer).
     */
    function getEntropy() internal view override returns (address) {
        return address(entropy);
    }

    /**
     * @notice Get the current VRF fee required for a slot.
     */
    function getEntropyFee() external view returns (uint256) {
        return entropy.getFeeV2();
    }

    /**
     * @notice Get the current Dutch auction slot price.
     * @return Current price (linearly decays from initPrice to 0 over epochPeriod)
     */
    function getPrice() public view returns (uint256) {
        uint256 timePassed = block.timestamp - slotStartTime;
        if (timePassed > epochPeriod) return 0;
        return initPrice - initPrice * timePassed / epochPeriod;
    }

    /**
     * @notice Get the current units per second emission rate.
     */
    function getUps() external view returns (uint256) {
        return _getUpsFromTime(block.timestamp);
    }

    /**
     * @notice Get the current prize pool balance.
     */
    function getPrizePool() external view returns (uint256) {
        return IERC20(unit).balanceOf(address(this));
    }

    /**
     * @notice Get pending emissions that would be minted on next slot.
     */
    function getPendingEmissions() external view returns (uint256) {
        uint256 timeElapsed = block.timestamp - lastEmissionTime;
        if (timeElapsed == 0) return 0;
        uint256 ups = _getUpsFromTime(block.timestamp);
        return timeElapsed * ups;
    }

    /**
     * @notice Get the full odds array.
     */
    function getOdds() external view returns (uint256[] memory) {
        return odds;
    }

    /**
     * @notice Get the length of the odds array.
     */
    function getOddsLength() external view returns (uint256) {
        return odds.length;
    }

    /**
     * @notice Get the current epoch ID.
     */
    function getEpochId() external view returns (uint256) {
        return epochId;
    }

    /**
     * @notice Get the current init price.
     */
    function getInitPrice() external view returns (uint256) {
        return initPrice;
    }

    /**
     * @notice Get the slot start time.
     */
    function getSlotStartTime() external view returns (uint256) {
        return slotStartTime;
    }
}
