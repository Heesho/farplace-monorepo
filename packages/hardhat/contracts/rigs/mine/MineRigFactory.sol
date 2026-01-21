// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {MineRig} from "./MineRig.sol";

/**
 * @title MineRigFactory
 * @author heesho
 * @notice Factory contract for deploying new MineRig instances.
 * @dev Called by MineCore during the launch process to create new MineRig contracts.
 */
contract MineRigFactory {
    /**
     * @notice Deploy a new Rig contract.
     * @param _unit Unit token address (deployed separately by Core)
     * @param _quote Payment token address (e.g., USDC)
     * @param _entropy Pyth Entropy contract address
     * @param _protocol Protocol fee recipient address
     * @param _treasury Treasury address for fee collection
     * @param _epochPeriod Duration of each Dutch auction epoch
     * @param _priceMultiplier Price multiplier for next epoch
     * @param _minInitPrice Minimum starting price
     * @param _initialUps Starting units per second
     * @param _halvingAmount Token supply threshold for halving
     * @param _tailUps Minimum units per second
     * @return Address of the newly deployed Rig
     */
    function deploy(
        address _unit,
        address _quote,
        address _entropy,
        address _protocol,
        address _treasury,
        uint256 _epochPeriod,
        uint256 _priceMultiplier,
        uint256 _minInitPrice,
        uint256 _initialUps,
        uint256 _halvingAmount,
        uint256 _tailUps
    ) external returns (address) {
        MineRig.Config memory config = MineRig.Config({
            epochPeriod: _epochPeriod,
            priceMultiplier: _priceMultiplier,
            minInitPrice: _minInitPrice,
            initialUps: _initialUps,
            halvingAmount: _halvingAmount,
            tailUps: _tailUps
        });

        MineRig rig = new MineRig(
            _unit,
            _quote,
            _entropy,
            _protocol,
            _treasury,
            config
        );
        rig.transferOwnership(msg.sender);
        return address(rig);
    }
}
