// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IRewarderFactory
 * @author heesho
 * @notice Interface for the RewarderFactory contract.
 */
interface IRewarderFactory {
    function deploy(address _content) external returns (address);
}
