// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Unit} from "./Unit.sol";

/**
 * @title UnitFactory
 * @author heesho
 * @notice Factory contract for deploying new Unit token instances.
 * @dev Called by Core during the launch process to create new Unit tokens.
 *      The caller (Core) becomes the initial rig and can mint tokens for LP seeding.
 */
contract UnitFactory {
    /**
     * @notice Deploy a new Unit token with caller as initial rig.
     * @dev The caller (Core) receives minting rights and can later transfer them
     *      to a Rig contract via setRig(), which permanently locks the rig.
     * @param _tokenName Name for the Unit token
     * @param _tokenSymbol Symbol for the Unit token
     * @return Address of the newly deployed Unit token
     */
    function deploy(string calldata _tokenName, string calldata _tokenSymbol) external returns (address) {
        Unit unit = new Unit(_tokenName, _tokenSymbol, msg.sender);
        return address(unit);
    }
}
