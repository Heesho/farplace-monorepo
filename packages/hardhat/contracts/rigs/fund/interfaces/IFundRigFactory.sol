// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IFundRigFactory
 * @author heesho
 * @notice Interface for the FundRigFactory contract.
 */
interface IFundRigFactory {
    function deploy(
        address _paymentToken,
        address _unit,
        address _recipient,
        address _treasury,
        address _team,
        address _core,
        uint256 _initialEmission,
        uint256 _minEmission,
        uint256 _halvingPeriod
    ) external returns (address);
}
