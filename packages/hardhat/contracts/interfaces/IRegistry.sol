// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IRegistry
 * @author heesho
 * @notice Interface for the central Registry contract that tracks all deployed rigs.
 */
interface IRegistry {
    /**
     * @notice Register a new rig in the central registry.
     * @param rig Address of the deployed rig contract
     * @param rigType Type identifier (e.g., "mine", "spin", "fund")
     * @param unit Address of the rig's Unit token
     * @param launcher Address that launched the rig
     */
    function register(
        address rig,
        string calldata rigType,
        address unit,
        address launcher
    ) external;

    /**
     * @notice Check if an address is an approved factory.
     * @param factory Address to check
     * @return True if the factory is approved to register rigs
     */
    function approvedFactories(address factory) external view returns (bool);

    /**
     * @notice Check if a rig is registered.
     * @param rig Address to check
     * @return True if the rig is registered
     */
    function isRegistered(address rig) external view returns (bool);
}
