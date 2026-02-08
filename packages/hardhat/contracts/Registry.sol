// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Registry
 * @author heesho
 * @notice Central registry for all rig types in the Farplace ecosystem.
 *         Each rig type (mine, spin, fund) has its own Core/Factory
 *         that registers deployed rigs here. This provides a single source of truth
 *         for discovering all rigs across the platform.
 *
 * @dev Design principles:
 *      - Registry is intentionally minimal
 *      - It doesn't validate what a "rig" is - that's the factory's job
 *      - Only approved factories can register rigs (spam prevention)
 *      - Adding new rig types only requires approving a new factory
 *      - All rig metadata is emitted via events and indexed by the subgraph
 */
contract Registry is Ownable {
    /*----------  STATE  ------------------------------------------------*/

    /// @notice Factory address => is approved to register
    mapping(address => bool) public factoryToIsApproved;

    /// @notice Rig address => is registered
    mapping(address => bool) public rigToIsRegistered;

    /*----------  ERRORS  -----------------------------------------------*/

    error Registry__NotApprovedFactory();
    error Registry__AlreadyRegistered();
    error Registry__ZeroAddress();

    /*----------  EVENTS  -----------------------------------------------*/

    event Registry__RigRegistered(
        address indexed rig,
        address indexed unit,
        address indexed launcher,
        address factory
    );

    event Registry__FactoryApproved(address indexed factory, bool approved);

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Register a newly deployed rig.
     * @dev Only callable by approved factories.
     * @param rig Address of the deployed rig contract
     * @param unit Address of the rig's token
     * @param launcher Address that initiated the launch
     */
    function register(
        address rig,
        address unit,
        address launcher
    ) external {
        if (!factoryToIsApproved[msg.sender]) revert Registry__NotApprovedFactory();
        if (rig == address(0)) revert Registry__ZeroAddress();
        if (rigToIsRegistered[rig]) revert Registry__AlreadyRegistered();

        rigToIsRegistered[rig] = true;

        emit Registry__RigRegistered(rig, unit, launcher, msg.sender);
    }

    /*----------  RESTRICTED FUNCTIONS  ---------------------------------*/

    /**
     * @notice Approve or revoke a factory's permission to register rigs.
     * @param factory Address of the factory contract
     * @param approved Whether the factory is approved
     */
    function setFactoryApproval(address factory, bool approved) external onlyOwner {
        if (factory == address(0)) revert Registry__ZeroAddress();
        factoryToIsApproved[factory] = approved;
        emit Registry__FactoryApproved(factory, approved);
    }
}
