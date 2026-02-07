// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IAuction
 * @author heesho
 * @notice Interface for the Auction contract.
 */
interface IAuction {
    // Immutables
    function paymentToken() external view returns (address);
    function paymentReceiver() external view returns (address);
    function epochPeriod() external view returns (uint256);
    function priceMultiplier() external view returns (uint256);
    function minInitPrice() external view returns (uint256);

    // State
    function epochId() external view returns (uint256);
    function initPrice() external view returns (uint256);
    function startTime() external view returns (uint256);

    // External functions
    function buy(
        address[] calldata assets,
        address assetsReceiver,
        uint256 epochId,
        uint256 deadline,
        uint256 maxPaymentTokenAmount
    ) external returns (uint256);

    // View functions
    function getPrice() external view returns (uint256);
}
