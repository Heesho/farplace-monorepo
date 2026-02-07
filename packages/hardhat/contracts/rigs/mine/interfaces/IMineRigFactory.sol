// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IMineRigFactory
 * @author heesho
 * @notice Interface for the MineRigFactory contract.
 */
interface IMineRigFactory {
    function deploy(
        address _unit,
        address _quote,
        address _core,
        address _treasury,
        address _team,
        address _entropy,
        uint256 _epochPeriod,
        uint256 _priceMultiplier,
        uint256 _minInitPrice,
        uint256 _initialUps,
        uint256 _halvingAmount,
        uint256 _tailUps,
        uint256[] calldata _upsMultipliers,
        uint256 _upsMultiplierDuration
    ) external returns (address);
}
