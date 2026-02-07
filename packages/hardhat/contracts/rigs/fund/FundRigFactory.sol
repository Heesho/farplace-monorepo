// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {FundRig} from "./FundRig.sol";

/**
 * @title FundRigFactory
 * @author heesho
 * @notice Factory contract for deploying new FundRig instances.
 * @dev Called by FundCore during the launch process to create new FundRig contracts.
 */
contract FundRigFactory {
    /**
     * @notice Deploy a new FundRig contract.
     * @param _unit Unit token address (deployed separately by Core)
     * @param _quote Payment token address (e.g., USDC)
     * @param _core Core contract address
     * @param _treasury Treasury address for fee collection
     * @param _team Team address for fee collection
     * @param _recipient Address to receive 50% of donations (required)
     * @param _initialEmission Initial Unit emission per day
     * @param _minEmission Minimum Unit emission per day (floor)
     * @param _halvingPeriod Number of days between emission halvings
     * @return Address of the newly deployed FundRig
     */
    function deploy(
        address _unit,
        address _quote,
        address _core,
        address _treasury,
        address _team,
        address _recipient,
        uint256 _initialEmission,
        uint256 _minEmission,
        uint256 _halvingPeriod
    ) external returns (address) {
        FundRig.Config memory config = FundRig.Config({
            initialEmission: _initialEmission,
            minEmission: _minEmission,
            halvingPeriod: _halvingPeriod
        });

        FundRig rig = new FundRig(
            _unit,
            _quote,
            _core,
            _treasury,
            _team,
            _recipient,
            config
        );
        rig.transferOwnership(msg.sender);
        return address(rig);
    }
}
