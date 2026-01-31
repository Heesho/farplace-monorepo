// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Registry
 * @author heesho
 * @notice Central registry for all rig types in the Farplace ecosystem.
 *         Each rig type (mine, slot, fund, etc.) has its own Core/Factory
 *         that registers deployed rigs here. This provides a single source of truth
 *         for discovering all rigs across the platform.
 *
 * @dev Design principles:
 *      - Registry is intentionally minimal and generic
 *      - It doesn't validate what a "rig" is - that's the factory's job
 *      - Only approved factories can register rigs (spam prevention)
 *      - Adding new rig types only requires approving a new factory
 */
contract Registry is Ownable {
    /*----------  STRUCTS  ----------------------------------------------*/

    struct RigInfo {
        string rigType;      // e.g., "seat", "content", "charity", "spin"
        address unit;        // The token associated with this rig
        address launcher;    // Address that launched the rig
        address factory;     // Factory that deployed the rig
        uint256 createdAt;   // Block timestamp of registration
    }

    /*----------  STATE  ------------------------------------------------*/

    /// @notice Rig address => RigInfo
    mapping(address => RigInfo) public rigs;

    /// @notice Factory address => is approved to register
    mapping(address => bool) public approvedFactories;

    /// @notice All registered rig addresses (for enumeration)
    address[] public allRigs;

    /// @notice Rig type => array of rigs of that type
    mapping(string => address[]) public rigsByType;

    /*----------  ERRORS  -----------------------------------------------*/

    error Registry__NotApprovedFactory();
    error Registry__AlreadyRegistered();
    error Registry__ZeroAddress();
    error Registry__EmptyRigType();

    /*----------  EVENTS  -----------------------------------------------*/

    event Registry__RigRegistered(
        address indexed rig,
        string indexed rigType,
        address indexed unit,
        address launcher,
        address factory
    );

    event Registry__FactoryApproved(address indexed factory, bool approved);

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Register a newly deployed rig.
     * @dev Only callable by approved factories.
     * @param rig Address of the deployed rig contract
     * @param rigType Type identifier (e.g., "seat", "content")
     * @param unit Address of the rig's token
     * @param launcher Address that initiated the launch
     */
    function register(
        address rig,
        string calldata rigType,
        address unit,
        address launcher
    ) external {
        if (!approvedFactories[msg.sender]) revert Registry__NotApprovedFactory();
        if (rig == address(0)) revert Registry__ZeroAddress();
        if (rigs[rig].createdAt != 0) revert Registry__AlreadyRegistered();
        if (bytes(rigType).length == 0) revert Registry__EmptyRigType();

        rigs[rig] = RigInfo({
            rigType: rigType,
            unit: unit,
            launcher: launcher,
            factory: msg.sender,
            createdAt: block.timestamp
        });

        allRigs.push(rig);
        rigsByType[rigType].push(rig);

        emit Registry__RigRegistered(rig, rigType, unit, launcher, msg.sender);
    }

    /*----------  OWNER FUNCTIONS  --------------------------------------*/

    /**
     * @notice Approve or revoke a factory's permission to register rigs.
     * @param factory Address of the factory contract
     * @param approved Whether the factory is approved
     */
    function setFactoryApproval(address factory, bool approved) external onlyOwner {
        if (factory == address(0)) revert Registry__ZeroAddress();
        approvedFactories[factory] = approved;
        emit Registry__FactoryApproved(factory, approved);
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Get total number of registered rigs across all types.
     */
    function totalRigs() external view returns (uint256) {
        return allRigs.length;
    }

    /**
     * @notice Get number of rigs of a specific type.
     * @param rigType Type identifier (e.g., "seat")
     */
    function totalRigsByType(string calldata rigType) external view returns (uint256) {
        return rigsByType[rigType].length;
    }

    /**
     * @notice Check if an address is a registered rig.
     * @param rig Address to check
     */
    function isRegistered(address rig) external view returns (bool) {
        return rigs[rig].createdAt != 0;
    }

    /**
     * @notice Get rig info for a given address.
     * @param rig Address of the rig
     */
    function getRigInfo(address rig) external view returns (RigInfo memory) {
        return rigs[rig];
    }

    /**
     * @notice Get paginated list of all rigs.
     * @param offset Starting index
     * @param limit Maximum number to return
     */
    function getRigs(uint256 offset, uint256 limit) external view returns (address[] memory) {
        uint256 total = allRigs.length;
        if (offset >= total) return new address[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 count = end - offset;

        address[] memory result = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = allRigs[offset + i];
        }
        return result;
    }

    /**
     * @notice Get paginated list of rigs by type.
     * @param rigType Type identifier
     * @param offset Starting index
     * @param limit Maximum number to return
     */
    function getRigsByType(
        string calldata rigType,
        uint256 offset,
        uint256 limit
    ) external view returns (address[] memory) {
        address[] storage typeRigs = rigsByType[rigType];
        uint256 total = typeRigs.length;
        if (offset >= total) return new address[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 count = end - offset;

        address[] memory result = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = typeRigs[offset + i];
        }
        return result;
    }
}
