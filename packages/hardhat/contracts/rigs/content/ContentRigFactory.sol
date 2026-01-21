// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ContentRig} from "./ContentRig.sol";

/**
 * @title ContentRigFactory
 * @author heesho
 * @notice Factory contract for deploying new ContentRig instances.
 * @dev Called by ContentCore during the launch process to create new ContentRig contracts.
 */
contract ContentRigFactory {
    /**
     * @notice Deploy a new ContentRig contract.
     * @param _name Token name
     * @param _symbol Token symbol
     * @param _uri Metadata URI
     * @param _unit Unit token address
     * @param _quote Quote token address
     * @param _treasury Treasury address
     * @param _team Team address
     * @param _core Core contract address
     * @param _rewarderFactory RewarderFactory address
     * @param _minInitPrice Minimum starting price
     * @param _isModerated Whether content requires approval
     * @return Address of the newly deployed ContentRig
     */
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
    ) external returns (address) {
        ContentRig content = new ContentRig(
            _name,
            _symbol,
            _uri,
            _unit,
            _quote,
            _treasury,
            _team,
            _core,
            _rewarderFactory,
            _minInitPrice,
            _isModerated
        );
        content.transferOwnership(msg.sender);
        return address(content);
    }
}
