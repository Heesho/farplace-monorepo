// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IUnit
 * @author heesho
 * @notice Interface for the Unit token contract.
 */
interface IUnit {
    function rig() external view returns (address);
    function rigLocked() external view returns (bool);
    function mint(address to, uint256 amount) external;
    function burn(uint256 amount) external;
    function setRig(address _rig) external;
}
