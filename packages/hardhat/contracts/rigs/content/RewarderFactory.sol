// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Rewarder} from "./Rewarder.sol";

/**
 * @title RewarderFactory
 * @author heesho
 * @notice Factory contract for deploying new Rewarder instances.
 * @dev Called by ContentRig during construction to create a Rewarder.
 */
contract RewarderFactory {
    /**
     * @notice Deploy a new Rewarder contract.
     * @param _content ContentRig contract address
     * @return Address of the newly deployed Rewarder
     */
    function deploy(address _content) external returns (address) {
        Rewarder rewarder = new Rewarder(_content);
        return address(rewarder);
    }
}
