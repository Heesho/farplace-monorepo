// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title ISpinRig
 * @author heesho
 * @notice Interface for the SpinRig contract.
 */
interface ISpinRig {
    // Constants
    function TEAM_BPS() external view returns (uint256);
    function PROTOCOL_BPS() external view returns (uint256);
    function DIVISOR() external view returns (uint256);
    function PRECISION() external view returns (uint256);
    function MIN_EPOCH_PERIOD() external view returns (uint256);
    function MAX_EPOCH_PERIOD() external view returns (uint256);
    function MIN_PRICE_MULTIPLIER() external view returns (uint256);
    function MAX_PRICE_MULTIPLIER() external view returns (uint256);
    function ABS_MIN_INIT_PRICE() external view returns (uint256);
    function ABS_MAX_INIT_PRICE() external view returns (uint256);
    function MAX_INITIAL_UPS() external view returns (uint256);
    function MIN_HALVING_PERIOD() external view returns (uint256);
    function MAX_HALVING_PERIOD() external view returns (uint256);
    function MIN_ODDS_BPS() external view returns (uint256);
    function MAX_ODDS_BPS() external view returns (uint256);

    // Immutables
    function unit() external view returns (address);
    function quote() external view returns (address);
    function core() external view returns (address);
    function entropy() external view returns (address);
    function startTime() external view returns (uint256);
    function initialUps() external view returns (uint256);
    function tailUps() external view returns (uint256);
    function halvingPeriod() external view returns (uint256);
    function epochPeriod() external view returns (uint256);
    function priceMultiplier() external view returns (uint256);
    function minInitPrice() external view returns (uint256);

    // State
    function treasury() external view returns (address);
    function team() external view returns (address);
    function epochId() external view returns (uint256);
    function initPrice() external view returns (uint256);
    function spinStartTime() external view returns (uint256);
    function lastEmissionTime() external view returns (uint256);
    function odds(uint256 index) external view returns (uint256);
    function sequenceToSpinner(uint64 sequenceNumber) external view returns (address);
    function sequenceToEpoch(uint64 sequenceNumber) external view returns (uint256);
    function entropyEnabled() external view returns (bool);
    function uri() external view returns (string memory);

    // Functions
    function spin(
        address spinner,
        uint256 _epochId,
        uint256 deadline,
        uint256 maxPrice,
        string calldata _uri
    ) external payable returns (uint256 price);

    // Restricted functions
    function setTreasury(address _treasury) external;
    function setTeam(address _team) external;
    function setEntropyEnabled(bool _enabled) external;
    function setUri(string calldata _uri) external;
    function transferOwnership(address newOwner) external;

    // View functions
    function getEntropyFee() external view returns (uint256);
    function getPrice() external view returns (uint256);
    function getUps() external view returns (uint256);
    function getPrizePool() external view returns (uint256);
    function getPendingEmissions() external view returns (uint256);
    function getOdds() external view returns (uint256[] memory);
    function getOddsLength() external view returns (uint256);
}
