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
     * @param _paymentToken The ERC-20 token accepted for donations
     * @param _unit Unit token address (deployed separately by Core)
     * @param _treasury Treasury address for fee collection
     * @param _team Team address for fee collection
     * @param _core Core contract address
     * @param _initialEmission Initial Unit emission per day
     * @param _minEmission Minimum Unit emission per day (floor)
     * @param _minDonation Minimum donation amount (must be >= 100 to ensure non-zero fee splits)
     * @return Address of the newly deployed FundRig
     */
    function deploy(
        address _paymentToken,
        address _unit,
        address _treasury,
        address _team,
        address _core,
        uint256 _initialEmission,
        uint256 _minEmission,
        uint256 _minDonation
    ) external returns (address) {
        FundRig rig = new FundRig(
            _paymentToken,
            _unit,
            _treasury,
            _team,
            _core,
            _initialEmission,
            _minEmission,
            _minDonation
        );
        rig.transferOwnership(msg.sender);
        return address(rig);
    }
}
