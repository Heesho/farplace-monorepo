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

    function mine(
        address miner,
        uint256 index,
        uint256 epochId,
        uint256 deadline,
        uint256 maxPrice,
        string calldata _uri
    ) external payable returns (uint256 price);

    function claim(address account) external;

    function transferOwnership(address newOwner) external;

    // Owner functions
    function setTreasury(address _treasury) external;
    function setTeam(address _team) external;
    function setCapacity(uint256 _capacity) external;
    function setUpsMultipliers(uint256[] calldata _upsMultipliers) external;
    function setRandomnessEnabled(bool _enabled) external;
    function setUpsMultiplierDuration(uint256 _duration) external;
    function setUri(string calldata _uri) external;

    // View functions
    function unit() external view returns (address);
    function quote() external view returns (address);
    function entropy() external view returns (address);
    function protocol() external view returns (address);
    function treasury() external view returns (address);
    function team() external view returns (address);
    function capacity() external view returns (uint256);
    function totalMinted() external view returns (uint256);
    function randomnessEnabled() external view returns (bool);
    function uri() external view returns (string memory);

    function getPrice(uint256 index) external view returns (uint256);
    function getUps() external view returns (uint256);
    function getSlot(uint256 index) external view returns (Slot memory);
    function getEntropyFee() external view returns (uint256);
    function getUpsMultipliers() external view returns (uint256[] memory);
    function getUpsMultipliersLength() external view returns (uint256);
    function isRandomnessEnabled() external view returns (bool);
    function upsMultiplierDuration() external view returns (uint256);
    function accountToClaimable(address account) external view returns (uint256);
}
