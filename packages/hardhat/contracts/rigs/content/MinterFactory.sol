// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Minter} from "./Minter.sol";

/**
 * @title MinterFactory
 * @author heesho
 * @notice Factory contract for deploying new Minter instances.
 * @dev Called by ContentCore during the launch process to create a Minter.
 */
contract MinterFactory {
    /**
     * @notice Deploy a new Minter contract.
     * @param _unit Unit token address
     * @param _rewarder Rewarder contract address
     * @param _initialUps Starting units per second
     * @param _tailUps Minimum units per second after halvings
     * @param _halvingPeriod Time between halvings
     * @return Address of the newly deployed Minter
     */
    function deploy(
        address _unit,
        address _rewarder,
        uint256 _initialUps,
        uint256 _tailUps,
        uint256 _halvingPeriod
    ) external returns (address) {
        Minter minter = new Minter(
            _unit,
            _rewarder,
            _initialUps,
            _tailUps,
            _halvingPeriod
        );
        return address(minter);
    }
}
