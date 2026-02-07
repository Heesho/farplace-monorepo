// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IEntropyV2} from "@pythnetwork/entropy-sdk-solidity/IEntropyV2.sol";
import {IEntropyConsumer} from "@pythnetwork/entropy-sdk-solidity/IEntropyConsumer.sol";
import {IUnit} from "../../interfaces/IUnit.sol";
import {ISpinCore} from "./interfaces/ISpinCore.sol";

/**
 * @title SpinRig
 * @author heesho
 * @notice A slot machine-style mining rig where users spin to win Unit tokens from a prize pool.
 * @dev Users pay a Dutch auction-style price to spin. Pyth Entropy VRF determines the payout
 *      percentage from a configurable odds array. Emissions accumulate in the prize pool.
 *
 *      Mechanics:
 *      - Spin price starts high and decays linearly each epoch
 *      - VRF randomness determines payout percentage of prize pool
 *      - Emissions continuously accumulate in the prize pool
 *      - Emissions halve over time with a tail rate floor
 *
 *      Fee Split:
 *      - 95% to Treasury
 *      - 4% to Team
 *      - 1% to Protocol
 */
contract SpinRig is IEntropyConsumer, ReentrancyGuard, Ownable {
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
    uint256 public constant MIN_ODDS_BPS = 10; // Minimum 0.1% payout per spin
    uint256 public constant MAX_ODDS_BPS = 8000; // Maximum 80% - ensures pool never fully drains

    /*----------  IMMUTABLES  -------------------------------------------*/

    address public immutable unit;
    address public immutable quote;
    address public immutable core;
    address public immutable entropy;
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
    uint256 public spinStartTime;

    // Track last emission mint time for prize pool accumulation
    uint256 public lastEmissionTime;

    // Odds array in basis points
    uint256[] public odds;

    // Pending spins waiting for VRF callback
    mapping(uint64 => address) public sequenceToSpinner;
    mapping(uint64 => uint256) public sequenceToEpoch;

    // Entropy toggle
    bool public entropyEnabled = true;

    // Metadata URI for the rig
    string public uri;

    /*----------  STRUCTS  ----------------------------------------------*/

    struct Config {
        uint256 epochPeriod;
        uint256 priceMultiplier;
        uint256 minInitPrice;
        uint256 initialUps;
        uint256 halvingPeriod;
        uint256 tailUps;
        uint256[] odds;
    }

    /*----------  ERRORS  -----------------------------------------------*/

    error SpinRig__ZeroAddress();
    error SpinRig__ZeroSpinner();
    error SpinRig__EpochIdMismatch();
    error SpinRig__MaxPriceExceeded();
    error SpinRig__Expired();
    error SpinRig__InsufficientFee();
    error SpinRig__InvalidOdds();
    error SpinRig__OddsTooLow();
    error SpinRig__EpochPeriodOutOfRange();
    error SpinRig__PriceMultiplierOutOfRange();
    error SpinRig__MinInitPriceOutOfRange();
    error SpinRig__InitialUpsOutOfRange();
    error SpinRig__TailUpsOutOfRange();
    error SpinRig__HalvingPeriodOutOfRange();

    /*----------  EVENTS  -----------------------------------------------*/

    event SpinRig__Spin(
        address indexed sender,
        address indexed spinner,
        uint256 indexed epochId,
        uint256 price,
        string uri
    );
    event SpinRig__Win(
        address indexed spinner,
        uint256 indexed epochId,
        uint256 oddsBps,
        uint256 amount
    );
    event SpinRig__EntropyRequested(uint256 indexed epochId, uint64 indexed sequenceNumber);
    event SpinRig__TreasuryFee(address indexed treasury, uint256 indexed epochId, uint256 amount);
    event SpinRig__TeamFee(address indexed team, uint256 indexed epochId, uint256 amount);
    event SpinRig__ProtocolFee(address indexed protocol, uint256 indexed epochId, uint256 amount);
    event SpinRig__EmissionMinted(uint256 indexed epochId, uint256 amount);
    event SpinRig__TreasurySet(address indexed treasury);
    event SpinRig__TeamSet(address indexed team);
    event SpinRig__UriSet(string uri);
    event SpinRig__EntropyEnabledSet(bool enabled);

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    /**
     * @notice Deploy a new SpinRig contract.
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
        if (_unit == address(0)) revert SpinRig__ZeroAddress();
        if (_quote == address(0)) revert SpinRig__ZeroAddress();
        if (_core == address(0)) revert SpinRig__ZeroAddress();
        if (_treasury == address(0)) revert SpinRig__ZeroAddress();
        if (_entropy == address(0)) revert SpinRig__ZeroAddress();

        // Validate config
        if (_config.epochPeriod < MIN_EPOCH_PERIOD || _config.epochPeriod > MAX_EPOCH_PERIOD) {
            revert SpinRig__EpochPeriodOutOfRange();
        }
        if (_config.priceMultiplier < MIN_PRICE_MULTIPLIER || _config.priceMultiplier > MAX_PRICE_MULTIPLIER) {
            revert SpinRig__PriceMultiplierOutOfRange();
        }
        if (_config.minInitPrice < ABS_MIN_INIT_PRICE || _config.minInitPrice > ABS_MAX_INIT_PRICE) {
            revert SpinRig__MinInitPriceOutOfRange();
        }
        if (_config.initialUps == 0 || _config.initialUps > MAX_INITIAL_UPS) {
            revert SpinRig__InitialUpsOutOfRange();
        }
        if (_config.tailUps == 0 || _config.tailUps > _config.initialUps) {
            revert SpinRig__TailUpsOutOfRange();
        }
        if (_config.halvingPeriod < MIN_HALVING_PERIOD || _config.halvingPeriod > MAX_HALVING_PERIOD) {
            revert SpinRig__HalvingPeriodOutOfRange();
        }

        unit = _unit;
        quote = _quote;
        core = _core;
        treasury = _treasury;
        team = _team;
        entropy = _entropy;

        epochPeriod = _config.epochPeriod;
        priceMultiplier = _config.priceMultiplier;
        minInitPrice = _config.minInitPrice;
        initialUps = _config.initialUps;
        tailUps = _config.tailUps;
        halvingPeriod = _config.halvingPeriod;

        startTime = block.timestamp;
        lastEmissionTime = block.timestamp;
        spinStartTime = block.timestamp;
        initPrice = _config.minInitPrice;

        // Validate and set odds from config (immutable after deployment)
        _validateAndSetOdds(_config.odds);
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Spin the slot machine to win Unit tokens from the prize pool.
     * @dev Pays the current Dutch auction price, then VRF determines payout percentage.
     * @param spinner Address to receive winnings
     * @param _epochId Expected epoch (frontrun protection)
     * @param deadline Transaction deadline
     * @param maxPrice Maximum price willing to pay (slippage protection)
     * @return price Actual price paid
     */
    function spin(
        address spinner,
        uint256 _epochId,
        uint256 deadline,
        uint256 maxPrice,
        string calldata _uri
    ) external payable nonReentrant returns (uint256 price) {
        if (spinner == address(0)) revert SpinRig__ZeroSpinner();
        if (block.timestamp > deadline) revert SpinRig__Expired();
        if (_epochId != epochId) revert SpinRig__EpochIdMismatch();

        price = getPrice();
        if (price > maxPrice) revert SpinRig__MaxPriceExceeded();

        // Distribute fees from spin price
        if (price > 0) {
            address protocol = ISpinCore(core).protocolFeeAddress();
            uint256 teamFee = team != address(0) ? price * TEAM_BPS / DIVISOR : 0;
            uint256 protocolFee = protocol != address(0) ? price * PROTOCOL_BPS / DIVISOR : 0;
            uint256 treasuryFee = price - teamFee - protocolFee;

            IERC20(quote).safeTransferFrom(msg.sender, treasury, treasuryFee);
            emit SpinRig__TreasuryFee(treasury, epochId, treasuryFee);

            if (teamFee > 0) {
                IERC20(quote).safeTransferFrom(msg.sender, team, teamFee);
                emit SpinRig__TeamFee(team, epochId, teamFee);
            }

            if (protocolFee > 0) {
                IERC20(quote).safeTransferFrom(msg.sender, protocol, protocolFee);
                emit SpinRig__ProtocolFee(protocol, epochId, protocolFee);
            }
        }

        // Mint accumulated emissions to prize pool (this contract)
        uint256 emissionAmount = _mintEmissions();
        if (emissionAmount > 0) {
            emit SpinRig__EmissionMinted(epochId, emissionAmount);
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
        spinStartTime = block.timestamp;

        emit SpinRig__Spin(msg.sender, spinner, currentEpochId, price, _uri);

        if (entropyEnabled) {
            // Request VRF for spin outcome
            uint128 fee = IEntropyV2(entropy).getFeeV2();
            if (msg.value < fee) revert SpinRig__InsufficientFee();
            uint64 seq = IEntropyV2(entropy).requestV2{value: fee}();
            sequenceToSpinner[seq] = spinner;
            sequenceToEpoch[seq] = currentEpochId;
            emit SpinRig__EntropyRequested(currentEpochId, seq);
        } else {
            if (msg.value > 0) revert SpinRig__InsufficientFee();
            // Fallback: use odds[0] as deterministic payout
            uint256 oddsBps = odds[0];
            uint256 pool = IERC20(unit).balanceOf(address(this));
            uint256 winAmount = pool * oddsBps / DIVISOR;
            if (winAmount > 0) {
                IERC20(unit).safeTransfer(spinner, winAmount);
            }
            emit SpinRig__Win(spinner, currentEpochId, oddsBps, winAmount);
        }

        return price;
    }

    /*----------  RESTRICTED FUNCTIONS  ---------------------------------*/

    /**
     * @notice Update the treasury address.
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert SpinRig__ZeroAddress();
        treasury = _treasury;
        emit SpinRig__TreasurySet(_treasury);
    }

    /**
     * @notice Update the team address.
     * @dev Can be set to address(0) to redirect team fees to treasury.
     * @param _team New team address (or address(0) to disable)
     */
    function setTeam(address _team) external onlyOwner {
        team = _team;
        emit SpinRig__TeamSet(_team);
    }

    /**
     * @notice Enable or disable entropy for spin outcomes.
     * @param _enabled True to enable entropy-based random odds, false to use odds[0] as fallback
     */
    function setEntropyEnabled(bool _enabled) external onlyOwner {
        entropyEnabled = _enabled;
        emit SpinRig__EntropyEnabledSet(_enabled);
    }

    /**
     * @notice Update the metadata URI for the rig.
     * @param _uri New metadata URI (e.g., for logo, branding)
     */
    function setUri(string calldata _uri) external onlyOwner {
        uri = _uri;
        emit SpinRig__UriSet(_uri);
    }

    /*----------  INTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Callback from Pyth Entropy with VRF result.
     * @dev Determines payout from odds array and transfers winnings.
     * @param sequenceNumber Entropy request sequence number
     * @param randomNumber Random bytes32 from Pyth Entropy
     */
    function entropyCallback(uint64 sequenceNumber, address, bytes32 randomNumber) internal override {
        address spinner = sequenceToSpinner[sequenceNumber];
        uint256 epoch = sequenceToEpoch[sequenceNumber];

        delete sequenceToSpinner[sequenceNumber];
        delete sequenceToEpoch[sequenceNumber];

        // Validate spinner still exists
        if (spinner == address(0)) return;

        // Draw odds and calculate winnings
        uint256 oddsBps = _drawOdds(randomNumber);
        uint256 pool = IERC20(unit).balanceOf(address(this));
        uint256 winAmount = pool * oddsBps / DIVISOR;

        if (winAmount > 0) {
            IERC20(unit).safeTransfer(spinner, winAmount);
        }

        emit SpinRig__Win(spinner, epoch, oddsBps, winAmount);
    }

    /**
     * @notice Get the Entropy contract address (required by IEntropyConsumer).
     * @return Entropy contract address
     */
    function getEntropy() internal view override returns (address) {
        return entropy;
    }

    /**
     * @notice Draw a random payout percentage from the configured odds array.
     * @dev Uses modulo to select index from odds array.
     * @param randomNumber Random bytes32 to use for selection
     * @return Selected odds value in basis points
     */
    function _drawOdds(bytes32 randomNumber) internal view returns (uint256) {
        uint256 length = odds.length;
        if (length == 0) return MIN_ODDS_BPS;
        uint256 index = uint256(randomNumber) % length;
        return odds[index];
    }

    /**
     * @notice Mint accumulated emissions to the prize pool.
     * @dev Calculates time-based emissions since last mint and adds to pool.
     * @return amount Tokens minted to the prize pool
     */
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

    /**
     * @notice Calculate UPS based on time elapsed and halving schedule.
     * @dev UPS halves every halvingPeriod of wall-clock time, floored at tailUps.
     * @param time Timestamp to calculate UPS for
     * @return ups Units per second at the given time
     */
    function _getUpsFromTime(uint256 time) internal view returns (uint256 ups) {
        uint256 halvings = time <= startTime ? 0 : (time - startTime) / halvingPeriod;
        ups = initialUps >> halvings;
        if (ups < tailUps) ups = tailUps;
        return ups;
    }

    /**
     * @notice Validate and store the odds array.
     * @dev Each odds value must be between MIN_ODDS_BPS and MAX_ODDS_BPS.
     * @param _odds Array of payout percentages in basis points
     */
    function _validateAndSetOdds(uint256[] memory _odds) internal {
        uint256 length = _odds.length;
        if (length == 0) revert SpinRig__InvalidOdds();

        for (uint256 i = 0; i < length; i++) {
            if (_odds[i] < MIN_ODDS_BPS) revert SpinRig__OddsTooLow();
            if (_odds[i] > MAX_ODDS_BPS) revert SpinRig__InvalidOdds();
        }

        odds = _odds;
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Get the current VRF fee required for a spin.
     * @return Current entropy fee in wei
     */
    function getEntropyFee() external view returns (uint256) {
        return IEntropyV2(entropy).getFeeV2();
    }

    /**
     * @notice Get the current Dutch auction spin price.
     * @return Current price (linearly decays from initPrice to 0 over epochPeriod)
     */
    function getPrice() public view returns (uint256) {
        uint256 timePassed = block.timestamp - spinStartTime;
        if (timePassed > epochPeriod) return 0;
        return initPrice - initPrice * timePassed / epochPeriod;
    }

    /**
     * @notice Get the current units per second emission rate.
     * @return Current UPS after halvings
     */
    function getUps() external view returns (uint256) {
        return _getUpsFromTime(block.timestamp);
    }

    /**
     * @notice Get the current prize pool balance.
     * @return Unit token balance held by this contract
     */
    function getPrizePool() external view returns (uint256) {
        return IERC20(unit).balanceOf(address(this));
    }

    /**
     * @notice Get pending emissions that would be minted on next spin.
     * @return Amount of tokens that would be minted
     */
    function getPendingEmissions() external view returns (uint256) {
        uint256 timeElapsed = block.timestamp - lastEmissionTime;
        if (timeElapsed == 0) return 0;
        uint256 ups = _getUpsFromTime(block.timestamp);
        return timeElapsed * ups;
    }

    /**
     * @notice Get the full odds array.
     * @return Array of payout percentages in basis points
     */
    function getOdds() external view returns (uint256[] memory) {
        return odds;
    }

    /**
     * @notice Get the length of the odds array.
     * @return Number of odds options
     */
    function getOddsLength() external view returns (uint256) {
        return odds.length;
    }

}
