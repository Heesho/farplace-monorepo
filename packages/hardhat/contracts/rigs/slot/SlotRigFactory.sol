// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {SlotRig} from "./SlotRig.sol";

/**
 * @title SlotRigFactory
 * @author heesho
 * @notice Factory contract for deploying new SlotRig instances.
 * @dev Called by SlotCore during the launch process to create new SlotRig contracts.
 */
contract SlotRigFactory {
    /**
     * @notice Deploy a new SlotRig contract.
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
     * @return Address of the newly deployed SlotRig
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
        uint256 _tailUps
    ) external returns (address) {
        SlotRig.Config memory config = SlotRig.Config({
            epochPeriod: _epochPeriod,
            priceMultiplier: _priceMultiplier,
            minInitPrice: _minInitPrice,
            initialUps: _initialUps,
            halvingPeriod: _halvingPeriod,
            tailUps: _tailUps
        });

        SlotRig rig = new SlotRig(
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
