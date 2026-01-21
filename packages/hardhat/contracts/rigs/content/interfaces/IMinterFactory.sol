// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IMinterFactory
 * @author heesho
 * @notice Interface for the MinterFactory contract.
 */
interface IMinterFactory {
    function deploy(
        address _unit,
        address _rewarder,
        uint256 _initialUps,
        uint256 _tailUps,
        uint256 _halvingPeriod
    ) external returns (address);
}
