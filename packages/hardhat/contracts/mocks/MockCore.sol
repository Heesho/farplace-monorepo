// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title MockCore
 * @notice Mock core contract for testing that provides protocolFeeAddress
 */
contract MockCore {
    address public protocolFeeAddress;

    constructor(address _protocolFeeAddress) {
        protocolFeeAddress = _protocolFeeAddress;
    }

    function setProtocolFeeAddress(address _protocolFeeAddress) external {
        protocolFeeAddress = _protocolFeeAddress;
    }
}
