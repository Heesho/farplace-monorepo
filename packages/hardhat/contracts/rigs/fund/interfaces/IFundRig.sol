// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IFundRig
 * @author heesho
 * @notice Interface for the FundRig contract.
 */
interface IFundRig {
    // Constants
    function MIN_EPOCH_DURATION() external view returns (uint256);
    function MAX_EPOCH_DURATION() external view returns (uint256);
    function MIN_HALVING_PERIOD() external view returns (uint256);
    function MAX_HALVING_PERIOD() external view returns (uint256);
    function MIN_INITIAL_EMISSION() external view returns (uint256);
    function MAX_INITIAL_EMISSION() external view returns (uint256);
    function RECIPIENT_BPS() external view returns (uint256);
    function TEAM_BPS() external view returns (uint256);
    function PROTOCOL_BPS() external view returns (uint256);
    function DIVISOR() external view returns (uint256);
    function MIN_DONATION() external view returns (uint256);

    // Immutables
    function unit() external view returns (address);
    function quote() external view returns (address);
    function core() external view returns (address);
    function startTime() external view returns (uint256);
    function initialEmission() external view returns (uint256);
    function minEmission() external view returns (uint256);
    function halvingPeriod() external view returns (uint256);
    function epochDuration() external view returns (uint256);

    // State
    function recipient() external view returns (address);
    function treasury() external view returns (address);
    function team() external view returns (address);
    function epochToTotalDonated(uint256 epoch) external view returns (uint256);
    function epochAccountToDonation(uint256 epoch, address account) external view returns (uint256);
    function epochAccountToHasClaimed(uint256 epoch, address account) external view returns (bool);
    function uri() external view returns (string memory);

    // External functions
    function fund(address account, uint256 amount, string calldata _uri) external;
    function claim(address account, uint256 epoch) external;

    // Restricted functions
    function setRecipient(address _recipient) external;
    function setTreasury(address _treasury) external;
    function setTeam(address _team) external;
    function setUri(string calldata _uri) external;
    function transferOwnership(address newOwner) external;

    // View functions
    function currentEpoch() external view returns (uint256);
    function getEpochEmission(uint256 epoch) external view returns (uint256);
    function getPendingReward(uint256 epoch, address account) external view returns (uint256);
}
