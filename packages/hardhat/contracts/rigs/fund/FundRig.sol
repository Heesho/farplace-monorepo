// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IUnit} from "../../interfaces/IUnit.sol";
import {IFundCore} from "./interfaces/IFundCore.sol";

/**
 * @title FundRig
 * @author heesho
 * @notice Core engine for donation-based token distribution. Accepts ERC-20 donations,
 *         splits funds between recipient/treasury/team, and mints Unit tokens to donors.
 * @dev Users donate payment tokens to a daily pool. After the day ends, users can claim
 *      their proportional share of that day's Unit emission based on their contribution.
 *
 *      Emission Schedule:
 *      - Initial: configurable initial emission per day
 *      - Halving: Every `halvingPeriod` days (configurable, 7-365)
 *      - Floor: configurable minimum emission per day
 *
 *      Fund Split:
 *      - 50% to Recipient (single address set by owner)
 *      - 45% to Treasury (remainder)
 *      - 4% to Team
 *      - 1% to Protocol
 */
contract FundRig is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    /*----------  CONSTANTS  --------------------------------------------*/

    uint256 public constant MIN_EPOCH_DURATION = 1 hours;
    uint256 public constant MAX_EPOCH_DURATION = 7 days;
    uint256 public constant MIN_HALVING_PERIOD = 7; // minimum 7 epochs
    uint256 public constant MAX_HALVING_PERIOD = 365; // maximum 365 epochs

    // Emission bounds (defense in depth - matches FundCore)
    uint256 public constant MIN_INITIAL_EMISSION = 1e18; // minimum 1 Unit per day
    uint256 public constant MAX_INITIAL_EMISSION = 1e30; // maximum emission per day

    uint256 public constant RECIPIENT_BPS = 5_000; // 50%
    uint256 public constant TEAM_BPS = 400; // 4%
    uint256 public constant PROTOCOL_BPS = 100; // 1%
    // Treasury receives remainder (45%)
    uint256 public constant DIVISOR = 10_000;

    // Minimum donation amount (ensures non-zero fee splits)
    // For USDC (6 decimals): 10,000 = $0.01
    uint256 public constant MIN_DONATION = 10_000;

    /*----------  IMMUTABLES  -------------------------------------------*/

    address public immutable unit;
    address public immutable quote;
    address public immutable core;
    uint256 public immutable startTime;
    uint256 public immutable initialEmission;
    uint256 public immutable minEmission;
    uint256 public immutable halvingPeriod; // in epochs
    uint256 public immutable epochDuration; // in seconds

    /*----------  STATE  ------------------------------------------------*/

    address public recipient;
    address public treasury;
    address public team;

    mapping(uint256 => uint256) public epochToTotalDonated;
    mapping(uint256 => mapping(address => uint256)) public epochAccountToDonation;
    mapping(uint256 => mapping(address => bool)) public epochAccountToHasClaimed;

    // Metadata URI for the rig
    string public uri;

    /*----------  STRUCTS  ----------------------------------------------*/

    struct Config {
        uint256 initialEmission;
        uint256 minEmission;
        uint256 halvingPeriod;
        uint256 epochDuration;
    }

    /*----------  ERRORS  -----------------------------------------------*/

    error FundRig__ZeroAddress();
    error FundRig__EpochNotEnded();
    error FundRig__AlreadyClaimed();
    error FundRig__NoDonation();
    error FundRig__RecipientNotSet();
    error FundRig__EmissionOutOfRange();
    error FundRig__BelowMinDonation();
    error FundRig__HalvingPeriodOutOfRange();
    error FundRig__EpochDurationOutOfRange();

    /*----------  EVENTS  -----------------------------------------------*/

    event FundRig__Funded(address sender, address indexed funder, uint256 amount, uint256 epoch, string uri);
    event FundRig__Claimed(address indexed account, uint256 amount, uint256 epoch);
    event FundRig__RecipientSet(address indexed recipient);
    event FundRig__TreasurySet(address indexed treasury);
    event FundRig__TeamSet(address indexed team);
    event FundRig__TreasuryFee(address indexed treasury, uint256 indexed epoch, uint256 amount);
    event FundRig__TeamFee(address indexed team, uint256 indexed epoch, uint256 amount);
    event FundRig__ProtocolFee(address indexed protocol, uint256 indexed epoch, uint256 amount);
    event FundRig__UriSet(string uri);

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    /**
     * @notice Deploy a new FundRig contract.
     * @param _unit Unit token address
     * @param _quote Payment token address (e.g., USDC)
     * @param _core Core contract address
     * @param _treasury Treasury address for fee collection
     * @param _team Team address for fee collection
     * @param _recipient Address to receive 50% of donations (required)
     * @param _config Configuration struct with emission parameters
     */
    constructor(
        address _unit,
        address _quote,
        address _core,
        address _treasury,
        address _team,
        address _recipient,
        Config memory _config,
        string memory _uri
    ) {
        if (_unit == address(0)) revert FundRig__ZeroAddress();
        if (_quote == address(0)) revert FundRig__ZeroAddress();
        if (_core == address(0)) revert FundRig__ZeroAddress();
        if (_treasury == address(0)) revert FundRig__ZeroAddress();
        if (_recipient == address(0)) revert FundRig__ZeroAddress();
        if (_config.initialEmission < MIN_INITIAL_EMISSION || _config.initialEmission > MAX_INITIAL_EMISSION) {
            revert FundRig__EmissionOutOfRange();
        }
        if (_config.minEmission == 0 || _config.minEmission > _config.initialEmission) revert FundRig__EmissionOutOfRange();
        if (_config.halvingPeriod < MIN_HALVING_PERIOD || _config.halvingPeriod > MAX_HALVING_PERIOD) {
            revert FundRig__HalvingPeriodOutOfRange();
        }
        if (_config.epochDuration < MIN_EPOCH_DURATION || _config.epochDuration > MAX_EPOCH_DURATION) {
            revert FundRig__EpochDurationOutOfRange();
        }

        unit = _unit;
        quote = _quote;
        core = _core;
        treasury = _treasury;
        team = _team;
        recipient = _recipient;
        initialEmission = _config.initialEmission;
        minEmission = _config.minEmission;
        halvingPeriod = _config.halvingPeriod;
        epochDuration = _config.epochDuration;
        startTime = block.timestamp;

        // Set URI
        uri = _uri;
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Fund the daily pool on behalf of an account.
     * @dev Requires msg.sender to have approved this contract for `amount`.
     *      Transfers `amount` from msg.sender, splits it, and credits `account`.
     * @param account The account to credit for this funding (receives Unit on claim)
     * @param amount The amount of payment tokens to fund
     */
    function fund(address account, uint256 amount, string calldata _uri) external nonReentrant {
        if (account == address(0)) revert FundRig__ZeroAddress();
        if (amount < MIN_DONATION) revert FundRig__BelowMinDonation();
        if (recipient == address(0)) revert FundRig__RecipientNotSet();

        uint256 epoch = currentEpoch();

        // Transfer tokens from msg.sender (payer)
        IERC20(quote).safeTransferFrom(msg.sender, address(this), amount);

        // Calculate splits
        address protocol = IFundCore(core).protocolFeeAddress();
        uint256 recipientAmount = amount * RECIPIENT_BPS / DIVISOR;
        uint256 teamFee = team != address(0) ? amount * TEAM_BPS / DIVISOR : 0;
        uint256 protocolFee = protocol != address(0) ? amount * PROTOCOL_BPS / DIVISOR : 0;
        uint256 treasuryFee = amount - recipientAmount - teamFee - protocolFee;

        // Transfer recipient share
        IERC20(quote).safeTransfer(recipient, recipientAmount);
        IERC20(quote).safeTransfer(treasury, treasuryFee);
        emit FundRig__TreasuryFee(treasury, epoch, treasuryFee);
        if (teamFee > 0) {
            IERC20(quote).safeTransfer(team, teamFee);
            emit FundRig__TeamFee(team, epoch, teamFee);
        }
        if (protocolFee > 0) {
            IERC20(quote).safeTransfer(protocol, protocolFee);
            emit FundRig__ProtocolFee(protocol, epoch, protocolFee);
        }

        // Update state - credit the account, not msg.sender
        epochToTotalDonated[epoch] += amount;
        epochAccountToDonation[epoch][account] += amount;

        emit FundRig__Funded(msg.sender, account, amount, epoch, _uri);
    }

    /**
     * @notice Claim Unit tokens for a completed epoch on behalf of an account.
     * @dev Can only be called after the specified epoch has ended.
     *      Mints Unit proportional to account's share of that epoch's donations.
     * @param account The account to claim for (must have donated, receives Unit)
     * @param epoch The epoch number to claim for
     */
    function claim(address account, uint256 epoch) external nonReentrant {
        if (account == address(0)) revert FundRig__ZeroAddress();
        if (epoch >= currentEpoch()) revert FundRig__EpochNotEnded();
        if (epochAccountToHasClaimed[epoch][account]) revert FundRig__AlreadyClaimed();

        uint256 userDonation = epochAccountToDonation[epoch][account];
        if (userDonation == 0) revert FundRig__NoDonation();

        uint256 epochTotal = epochToTotalDonated[epoch];
        uint256 epochEmission = getEpochEmission(epoch);

        // Calculate user's share: (userDonation / epochTotal) * epochEmission
        uint256 userReward = (userDonation * epochEmission) / epochTotal;

        // Mark as claimed before minting (CEI pattern)
        epochAccountToHasClaimed[epoch][account] = true;

        // Mint Unit to the account
        IUnit(unit).mint(account, userReward);

        emit FundRig__Claimed(account, userReward, epoch);
    }

    /*----------  RESTRICTED FUNCTIONS  ---------------------------------*/

    /**
     * @notice Set the recipient address that receives 50% of donations.
     * @param _recipient Address to receive donations
     */
    function setRecipient(address _recipient) external onlyOwner {
        if (_recipient == address(0)) revert FundRig__ZeroAddress();
        recipient = _recipient;
        emit FundRig__RecipientSet(_recipient);
    }

    /**
     * @notice Update the treasury address.
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert FundRig__ZeroAddress();
        treasury = _treasury;
        emit FundRig__TreasurySet(_treasury);
    }

    /**
     * @notice Update the team address.
     * @dev Can be set to address(0) to redirect team fees to treasury.
     * @param _team New team address (or address(0) to disable)
     */
    function setTeam(address _team) external onlyOwner {
        team = _team;
        emit FundRig__TeamSet(_team);
    }

    /**
     * @notice Update the metadata URI for the rig.
     * @param _uri New metadata URI (e.g., for logo, branding)
     */
    function setUri(string calldata _uri) external onlyOwner {
        uri = _uri;
        emit FundRig__UriSet(_uri);
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Get the current epoch number since contract deployment.
     * @return The current epoch (0-indexed)
     */
    function currentEpoch() public view returns (uint256) {
        return (block.timestamp - startTime) / epochDuration;
    }

    /**
     * @notice Get the Unit emission for a specific epoch.
     * @dev Emission halves every halvingPeriod epochs with a floor of minEmission.
     * @param epoch The epoch number to query
     * @return The Unit emission for that epoch
     */
    function getEpochEmission(uint256 epoch) public view returns (uint256) {
        uint256 halvings = epoch / halvingPeriod; // Number of halving periods
        uint256 emission = initialEmission >> halvings; // Right shift = divide by 2^halvings

        if (emission < minEmission) {
            return minEmission;
        }
        return emission;
    }

    /**
     * @notice Get pending Unit reward for a user on a specific epoch.
     * @dev Returns 0 if epoch hasn't ended, already claimed, or no donation.
     * @param epoch The epoch number to query
     * @param account The user address to query
     * @return The pending Unit reward
     */
    function getPendingReward(uint256 epoch, address account) external view returns (uint256) {
        if (epoch >= currentEpoch()) return 0;
        if (epochAccountToHasClaimed[epoch][account]) return 0;

        uint256 userDonation = epochAccountToDonation[epoch][account];
        if (userDonation == 0) return 0;

        uint256 epochTotal = epochToTotalDonated[epoch];
        uint256 epochEmission = getEpochEmission(epoch);

        return (userDonation * epochEmission) / epochTotal;
    }

}
