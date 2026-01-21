// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IContentRigFactory
 * @author heesho
 * @notice Interface for the ContentRigFactory contract.
 */
interface IContentRigFactory {
    function deploy(
        string memory _name,
        string memory _symbol,
        string memory _uri,
        address _unit,
        address _quote,
        address _treasury,
        address _team,
        address _core,
        address _rewarderFactory,
        uint256 _minInitPrice,
        bool _isModerated
    ) external returns (address);
}
