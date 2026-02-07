// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IFundRigFactory
 * @author heesho
 * @notice Interface for the FundRigFactory contract.
 */
interface IFundRigFactory {
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
    ) external returns (address);
}
