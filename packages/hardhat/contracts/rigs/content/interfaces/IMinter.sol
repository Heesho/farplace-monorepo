// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IMinter
 * @author heesho
 * @notice Interface for the Minter contract.
 */
interface IMinter {
    function updatePeriod() external returns (uint256 period);

    function unit() external view returns (address);
    function rewarder() external view returns (address);
    function initialUps() external view returns (uint256);
    function tailUps() external view returns (uint256);
    function halvingPeriod() external view returns (uint256);
    function startTime() external view returns (uint256);
    function activePeriod() external view returns (uint256);
    function weeklyEmission() external view returns (uint256);
    function getUps() external view returns (uint256);
}
