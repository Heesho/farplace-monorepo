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
     * @notice Deploy a new MineRig contract.
     * @param _unit Unit token address (deployed separately by Core)
     * @param _quote Payment token address (e.g., USDC)
     * @param _core Core contract address (source of protocol fee recipient)
     * @param _treasury Treasury address for fee collection
     * @param _team Team address (also initial miner for slot 0)
     * @param _entropy Pyth Entropy contract address
     * @param _epochPeriod Duration of each Dutch auction epoch
     * @param _priceMultiplier Price multiplier for next epoch
     * @param _minInitPrice Minimum starting price
     * @param _initialUps Starting units per second
     * @param _halvingAmount Token supply threshold for halving
     * @param _tailUps Minimum units per second
     * @param _upsMultipliers Array of possible UPS multiplier values (drawn randomly via VRF)
     * @param _upsMultiplierDuration How long a UPS multiplier lasts before resetting to 1x
     * @return Address of the newly deployed MineRig
     */
    function deploy(
        address _unit,
        address _quote,
        address _core,
        address _treasury,
        address _team,
        address _entropy,
        uint256 _epochPeriod,
        uint256 _priceMultiplier,
        uint256 _minInitPrice,
        uint256 _initialUps,
        uint256 _halvingAmount,
        uint256 _tailUps,
        uint256[] calldata _upsMultipliers,
        uint256 _upsMultiplierDuration
    ) external returns (address) {
        MineRig.Config memory config = MineRig.Config({
            epochPeriod: _epochPeriod,
            priceMultiplier: _priceMultiplier,
            minInitPrice: _minInitPrice,
            initialUps: _initialUps,
            halvingAmount: _halvingAmount,
            tailUps: _tailUps,
            upsMultipliers: _upsMultipliers,
            upsMultiplierDuration: _upsMultiplierDuration
        });

        MineRig rig = new MineRig(
            _unit,
            _quote,
            _core,
            _treasury,
            _team,
            _entropy,
            config
        );
        rig.transferOwnership(msg.sender);
        return address(rig);
    }
}
