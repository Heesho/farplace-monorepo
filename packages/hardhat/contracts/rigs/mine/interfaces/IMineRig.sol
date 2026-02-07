// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IMineRig
 * @author heesho
 * @notice Interface for the MineRig contract.
 */
interface IMineRig {
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

    // Constants
    function TOTAL_BPS() external view returns (uint256);
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
    function MIN_HALVING_AMOUNT() external view returns (uint256);
    function DEFAULT_UPS_MULTIPLIER() external view returns (uint256);
    function MIN_UPS_MULTIPLIER() external view returns (uint256);
    function MAX_UPS_MULTIPLIER() external view returns (uint256);
    function MIN_UPS_MULTIPLIER_DURATION() external view returns (uint256);
    function MAX_UPS_MULTIPLIER_DURATION() external view returns (uint256);
    function MAX_CAPACITY() external view returns (uint256);

    // Immutables
    function unit() external view returns (address);
    function quote() external view returns (address);
    function entropy() external view returns (address);
    function core() external view returns (address);
    function startTime() external view returns (uint256);
    function epochPeriod() external view returns (uint256);
    function priceMultiplier() external view returns (uint256);
    function minInitPrice() external view returns (uint256);
    function initialUps() external view returns (uint256);
    function halvingAmount() external view returns (uint256);
    function tailUps() external view returns (uint256);
    function upsMultiplierDuration() external view returns (uint256);

    // State
    function treasury() external view returns (address);
    function team() external view returns (address);
    function capacity() external view returns (uint256);
    function totalMinted() external view returns (uint256);
    function entropyEnabled() external view returns (bool);
    function uri() external view returns (string memory);
    function accountToClaimable(address account) external view returns (uint256);

    // External functions
    function mine(
        address miner,
        uint256 index,
        uint256 epochId,
        uint256 deadline,
        uint256 maxPrice,
        string calldata _uri
    ) external payable returns (uint256 price);

    function claim(address account) external;

    // Restricted functions
    function setTreasury(address _treasury) external;
    function setTeam(address _team) external;
    function setCapacity(uint256 _capacity) external;
    function setEntropyEnabled(bool _enabled) external;
    function setUri(string calldata _uri) external;
    function transferOwnership(address newOwner) external;

    // View functions
    function getPrice(uint256 index) external view returns (uint256);
    function getUps() external view returns (uint256);
    function getSlot(uint256 index) external view returns (Slot memory);
    function getEntropyFee() external view returns (uint256);
    function getUpsMultipliers() external view returns (uint256[] memory);
    function getUpsMultipliersLength() external view returns (uint256);
}
