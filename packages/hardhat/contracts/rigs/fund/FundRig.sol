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
 *      - Halving: Every 30 days
 *      - Floor: configurable minimum emission per day
 *
 *      Fund Split:
 *      - 50% to Recipient (user-selected from whitelist)
 *      - 45% to Treasury (remainder)
 *      - 4% to Team
 *      - 1% to Protocol
 */
contract FundRig is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    /*----------  CONSTANTS  --------------------------------------------*/

    uint256 public constant HALVING_PERIOD = 30 days;
    uint256 public constant DAY_DURATION = 1 days;

    uint256 public constant RECIPIENT_BPS = 5_000; // 50%
    uint256 public constant TEAM_BPS = 400; // 4%
    uint256 public constant PROTOCOL_BPS = 100; // 1%
    // Treasury receives remainder (45%)
    uint256 public constant DIVISOR = 10_000;

    /*----------  IMMUTABLES  -------------------------------------------*/

    address public immutable paymentToken;
    address public immutable unit;
    address public immutable core;
    uint256 public immutable startTime;
    uint256 public immutable initialEmission;
    uint256 public immutable minEmission;
    uint256 public immutable minDonation;

    /*----------  STATE  ------------------------------------------------*/

    mapping(address => bool) public accountToIsRecipient;

    address public treasury;
    address public team;

    mapping(uint256 => uint256) public dayToTotalDonated;
    mapping(uint256 => mapping(address => uint256)) public dayAccountToDonation;
    mapping(uint256 => mapping(address => bool)) public dayAccountToHasClaimed;

    // Metadata URI for the rig
    string public uri;

    /*----------  ERRORS  -----------------------------------------------*/

    error FundRig__ZeroAmount();
    error FundRig__DayNotEnded();
    error FundRig__AlreadyClaimed();
    error FundRig__NoDonation();
    error FundRig__InvalidAddress();
    error FundRig__NotRecipient();
    error FundRig__InvalidEmission();
    error FundRig__BelowMinDonation();
    error FundRig__InvalidMinDonation();

    /*----------  EVENTS  -----------------------------------------------*/

    event FundRig__Funded(address indexed account, address indexed recipient, uint256 amount, uint256 day);
    event FundRig__Claimed(address indexed account, uint256 amount, uint256 day);
    event FundRig__RecipientAdded(address indexed recipient);
    event FundRig__RecipientRemoved(address indexed recipient);
    event FundRig__TreasurySet(address indexed treasury);
    event FundRig__TeamSet(address indexed team);
    event FundRig__ProtocolFee(address indexed protocol, uint256 amount, uint256 day);
    event FundRig__UriSet(string uri);

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    /**
     * @notice Deploy a new FundRig contract.
     * @param _paymentToken The ERC-20 token accepted for donations
     * @param _unit The Unit token that will be minted to donors
     * @param _treasury Address to receive treasury portion of donations
     * @param _team Address to receive team portion of donations
     * @param _core Core contract address
     * @param _initialEmission Initial Unit emission per day
     * @param _minEmission Minimum Unit emission per day (floor)
     * @param _minDonation Minimum donation amount (must be >= 100 to ensure non-zero fee splits)
     */
    constructor(
        address _paymentToken,
        address _unit,
        address _treasury,
        address _team,
        address _core,
        uint256 _initialEmission,
        uint256 _minEmission,
        uint256 _minDonation
    ) {
        if (_paymentToken == address(0)) revert FundRig__InvalidAddress();
        if (_unit == address(0)) revert FundRig__InvalidAddress();
        if (_treasury == address(0)) revert FundRig__InvalidAddress();
        if (_core == address(0)) revert FundRig__InvalidAddress();
        if (_initialEmission == 0) revert FundRig__InvalidEmission();
        if (_minEmission == 0 || _minEmission > _initialEmission) revert FundRig__InvalidEmission();
        if (_minDonation < DIVISOR / PROTOCOL_BPS) revert FundRig__InvalidMinDonation();

        paymentToken = _paymentToken;
        unit = _unit;
        treasury = _treasury;
        team = _team;
        core = _core;
        initialEmission = _initialEmission;
        minEmission = _minEmission;
        minDonation = _minDonation;
        startTime = block.timestamp;
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Fund the daily pool on behalf of an account.
     * @dev Requires msg.sender to have approved this contract for `amount`.
     *      Transfers `amount` from msg.sender, splits it, and credits `account`.
     * @param account The account to credit for this funding (receives Unit on claim)
     * @param recipient The whitelisted recipient address to receive 50% of funding
     * @param amount The amount of payment tokens to fund
     */
    function fund(address account, address recipient, uint256 amount) external nonReentrant {
        if (account == address(0)) revert FundRig__InvalidAddress();
        if (amount < minDonation) revert FundRig__BelowMinDonation();
        if (!accountToIsRecipient[recipient]) revert FundRig__NotRecipient();

        uint256 day = currentDay();

        // Transfer tokens from msg.sender (payer)
        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), amount);

        // Calculate splits
        address protocol = IFundCore(core).protocolFeeAddress();
        uint256 recipientAmount = amount * RECIPIENT_BPS / DIVISOR;
        uint256 teamAmount = team != address(0) ? amount * TEAM_BPS / DIVISOR : 0;
        uint256 protocolAmount = protocol != address(0) ? amount * PROTOCOL_BPS / DIVISOR : 0;
        uint256 treasuryAmount = amount - recipientAmount - teamAmount - protocolAmount;

        // Distribute funds
        IERC20(paymentToken).safeTransfer(recipient, recipientAmount);
        IERC20(paymentToken).safeTransfer(treasury, treasuryAmount);
        if (teamAmount > 0) {
            IERC20(paymentToken).safeTransfer(team, teamAmount);
        }
        if (protocolAmount > 0) {
            IERC20(paymentToken).safeTransfer(protocol, protocolAmount);
            emit FundRig__ProtocolFee(protocol, protocolAmount, day);
        }

        // Update state - credit the account, not msg.sender
        dayToTotalDonated[day] += amount;
        dayAccountToDonation[day][account] += amount;

        emit FundRig__Funded(account, recipient, amount, day);
    }

    /**
     * @notice Claim Unit tokens for a completed day on behalf of an account.
     * @dev Can only be called after the specified day has ended.
     *      Mints Unit proportional to account's share of that day's donations.
     * @param account The account to claim for (must have donated, receives Unit)
     * @param day The day number to claim for
     */
    function claim(address account, uint256 day) external nonReentrant {
        if (account == address(0)) revert FundRig__InvalidAddress();
        if (day >= currentDay()) revert FundRig__DayNotEnded();
        if (dayAccountToHasClaimed[day][account]) revert FundRig__AlreadyClaimed();

        uint256 userDonation = dayAccountToDonation[day][account];
        if (userDonation == 0) revert FundRig__NoDonation();

        uint256 dayTotal = dayToTotalDonated[day];
        uint256 dayEmission = getDayEmission(day);

        // Calculate user's share: (userDonation / dayTotal) * dayEmission
        uint256 userReward = (userDonation * dayEmission) / dayTotal;

        // Mark as claimed before minting (CEI pattern)
        dayAccountToHasClaimed[day][account] = true;

        // Mint Unit to the account
        IUnit(unit).mint(account, userReward);

        emit FundRig__Claimed(account, userReward, day);
    }

    /*----------  RESTRICTED FUNCTIONS  ---------------------------------*/

    /**
     * @notice Add an address to the recipient whitelist.
     * @param _recipient Address to whitelist
     */
    function addRecipient(address _recipient) external onlyOwner {
        if (_recipient == address(0)) revert FundRig__InvalidAddress();
        accountToIsRecipient[_recipient] = true;
        emit FundRig__RecipientAdded(_recipient);
    }

    /**
     * @notice Remove an address from the recipient whitelist.
     * @param _recipient Address to remove from whitelist
     */
    function removeRecipient(address _recipient) external onlyOwner {
        accountToIsRecipient[_recipient] = false;
        emit FundRig__RecipientRemoved(_recipient);
    }

    /**
     * @notice Update the treasury address.
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert FundRig__InvalidAddress();
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
     * @notice Get the current day number since contract deployment.
     * @return The current day (0-indexed)
     */
    function currentDay() public view returns (uint256) {
        return (block.timestamp - startTime) / DAY_DURATION;
    }

    /**
     * @notice Get the Unit emission for a specific day.
     * @dev Emission halves every 30 days with a floor of minEmission.
     * @param day The day number to query
     * @return The Unit emission for that day
     */
    function getDayEmission(uint256 day) public view returns (uint256) {
        uint256 halvings = day / 30; // Number of 30-day periods
        uint256 emission = initialEmission >> halvings; // Right shift = divide by 2^halvings

        if (emission < minEmission) {
            return minEmission;
        }
        return emission;
    }

    /**
     * @notice Get pending Unit reward for a user on a specific day.
     * @dev Returns 0 if day hasn't ended, already claimed, or no donation.
     * @param day The day number to query
     * @param account The user address to query
     * @return The pending Unit reward
     */
    function getPendingReward(uint256 day, address account) external view returns (uint256) {
        if (day >= currentDay()) return 0;
        if (dayAccountToHasClaimed[day][account]) return 0;

        uint256 userDonation = dayAccountToDonation[day][account];
        if (userDonation == 0) return 0;

        uint256 dayTotal = dayToTotalDonated[day];
        uint256 dayEmission = getDayEmission(day);

        return (userDonation * dayEmission) / dayTotal;
    }

    /**
     * @notice Get user's donation amount for a specific day.
     * @param day The day number to query
     * @param account The user address to query
     * @return The donation amount
     */
    function getUserDonation(uint256 day, address account) external view returns (uint256) {
        return dayAccountToDonation[day][account];
    }

    /**
     * @notice Get total donations for a specific day.
     * @param day The day number to query
     * @return The total donation amount
     */
    function getDayTotal(uint256 day) external view returns (uint256) {
        return dayToTotalDonated[day];
    }
}
