// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title ISpinRigFactory
 * @author heesho
 * @notice Interface for the SpinRigFactory contract.
 */
interface ISpinRigFactory {
    function deploy(
        address _unit,
        address _quote,
        address _entropy,
        address _core,
        address _treasury,
        uint256 _epochPeriod,
        uint256 _priceMultiplier,
        uint256 _minInitPrice,
        uint256 _initialUps,
        uint256 _halvingPeriod,
        uint256 _tailUps,
        uint256[] calldata _odds
    ) external returns (address);
}
