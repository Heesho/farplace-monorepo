// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {SpinRig} from "./SpinRig.sol";

/**
 * @title SpinRigFactory
 * @author heesho
 * @notice Factory contract for deploying new SpinRig instances.
 * @dev Called by SpinCore during the launch process to create new SpinRig contracts.
 */
contract SpinRigFactory {
    /**
     * @notice Deploy a new SpinRig contract.
     * @param _unit Unit token address (deployed separately by Core)
     * @param _quote Payment token address (e.g., USDC)
     * @param _entropy Pyth Entropy contract address
     * @param _treasury Treasury address for fee collection
     * @param _epochPeriod Duration of each Dutch auction epoch
     * @param _priceMultiplier Price multiplier for next epoch
     * @param _minInitPrice Minimum starting price
     * @param _initialUps Starting units per second
     * @param _halvingPeriod Time between halvings
     * @param _tailUps Minimum units per second
     * @return Address of the newly deployed SpinRig
     */
    function deploy(
        address _unit,
        address _quote,
        address _entropy,
        address _treasury,
        uint256 _epochPeriod,
        uint256 _priceMultiplier,
        uint256 _minInitPrice,
        uint256 _initialUps,
        uint256 _halvingPeriod,
        uint256 _tailUps,
        uint256[] calldata _odds
    ) external returns (address) {
        SpinRig.Config memory config = SpinRig.Config({
            epochPeriod: _epochPeriod,
            priceMultiplier: _priceMultiplier,
            minInitPrice: _minInitPrice,
            initialUps: _initialUps,
            halvingPeriod: _halvingPeriod,
            tailUps: _tailUps,
            odds: _odds
        });

        SpinRig rig = new SpinRig(
            _unit,
            _quote,
            _entropy,
            _treasury,
            msg.sender, // core
            config
        );
        rig.transferOwnership(msg.sender);
        return address(rig);
    }
}
