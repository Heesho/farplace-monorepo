// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IRegistry {
    struct RigInfo {
        string rigType;
        address unit;
        address launcher;
        address factory;
        uint256 createdAt;
    }

    function register(
        address rig,
        string calldata rigType,
        address unit,
        address launcher
    ) external;

    function rigs(address rig) external view returns (
        string memory rigType,
        address unit,
        address launcher,
        address factory,
        uint256 createdAt
    );

    function approvedFactories(address factory) external view returns (bool);
    function allRigs(uint256 index) external view returns (address);
    function totalRigs() external view returns (uint256);
    function totalRigsByType(string calldata rigType) external view returns (uint256);
    function isRegistered(address rig) external view returns (bool);
    function getRigInfo(address rig) external view returns (RigInfo memory);
    function getRigs(uint256 offset, uint256 limit) external view returns (address[] memory);
    function getRigsByType(string calldata rigType, uint256 offset, uint256 limit) external view returns (address[] memory);
}
