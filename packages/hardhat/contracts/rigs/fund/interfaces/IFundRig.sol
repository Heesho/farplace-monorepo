// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IFundRig
 * @author heesho
 * @notice Interface for the FundRig contract.
 */
interface IFundRig {
    // Constants
    function HALVING_PERIOD() external view returns (uint256);
    function DAY_DURATION() external view returns (uint256);
    function RECIPIENT_BPS() external view returns (uint256);
    function TEAM_BPS() external view returns (uint256);
    function PROTOCOL_BPS() external view returns (uint256);
    function DIVISOR() external view returns (uint256);

    // Immutables
    function paymentToken() external view returns (address);
    function unit() external view returns (address);
    function core() external view returns (address);
    function startTime() external view returns (uint256);
    function initialEmission() external view returns (uint256);
    function minEmission() external view returns (uint256);
    function minDonation() external view returns (uint256);

    // State
    function accountToIsRecipient(address recipient) external view returns (bool);
    function treasury() external view returns (address);
    function team() external view returns (address);
    function dayToTotalDonated(uint256 day) external view returns (uint256);
    function dayAccountToDonation(uint256 day, address account) external view returns (uint256);
    function dayAccountToHasClaimed(uint256 day, address account) external view returns (bool);

    // External functions
    function donate(address account, address recipient, uint256 amount) external;
    function claim(address account, uint256 day) external;

    // Restricted functions
    function addRecipient(address _recipient) external;
    function removeRecipient(address _recipient) external;
    function setTreasury(address _treasury) external;
    function setTeam(address _team) external;
    function transferOwnership(address newOwner) external;

    // View functions
    function currentDay() external view returns (uint256);
    function getDayEmission(uint256 day) external view returns (uint256);
    function getPendingReward(uint256 day, address account) external view returns (uint256);
    function getUserDonation(uint256 day, address account) external view returns (uint256);
    function getDayTotal(uint256 day) external view returns (uint256);

    // Events
    event FundRig__Donated(address indexed account, address indexed recipient, uint256 amount, uint256 day);
    event FundRig__Claimed(address indexed account, uint256 amount, uint256 day);
    event FundRig__RecipientAdded(address indexed recipient);
    event FundRig__RecipientRemoved(address indexed recipient);
    event FundRig__TreasurySet(address indexed treasury);
    event FundRig__TeamSet(address indexed team);
    event FundRig__ProtocolFee(address indexed protocol, uint256 amount, uint256 day);
}
