// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title ISpinCore
 * @author heesho
 * @notice Interface for the SpinCore launchpad contract.
 */
interface ISpinCore {
    struct LaunchParams {
        address launcher;
        address quoteToken;
        string tokenName;
        string tokenSymbol;
        string uri;
        uint256 usdcAmount;
        uint256 unitAmount;
        uint256 initialUps;
        uint256 tailUps;
        uint256 halvingPeriod;
        uint256 rigEpochPeriod;
        uint256 rigPriceMultiplier;
        uint256 rigMinInitPrice;
        uint256[] odds;
        uint256 auctionInitPrice;
        uint256 auctionEpochPeriod;
        uint256 auctionPriceMultiplier;
        uint256 auctionMinInitPrice;
    }

    // Constants
    function RIG_TYPE() external view returns (string memory);
    function DEAD_ADDRESS() external view returns (address);

    // Immutables
    function registry() external view returns (address);
    function usdcToken() external view returns (address);
    function uniswapV2Factory() external view returns (address);
    function uniswapV2Router() external view returns (address);
    function unitFactory() external view returns (address);
    function spinRigFactory() external view returns (address);
    function auctionFactory() external view returns (address);
    function entropy() external view returns (address);

    // State
    function protocolFeeAddress() external view returns (address);
    function minUsdcForLaunch() external view returns (uint256);
    function rigToIsRig(address rig) external view returns (bool);
    function rigToAuction(address rig) external view returns (address);
    function rigs(uint256 index) external view returns (address);
    function rigsLength() external view returns (uint256);
    function rigToIndex(address rig) external view returns (uint256);
    function rigToLP(address rig) external view returns (address);

    // Functions
    function launch(LaunchParams calldata params)
        external
        returns (address unit, address rig, address auction, address lpToken);

    // Restricted functions
    function setProtocolFeeAddress(address _protocolFeeAddress) external;
    function setMinUsdcForLaunch(uint256 _minUsdcForLaunch) external;

    // Events
    event SpinCore__Launched(
        address indexed launcher,
        address indexed rig,
        address indexed unit,
        address auction,
        address lpToken,
        address quoteToken,
        string tokenName,
        string tokenSymbol,
        string uri,
        uint256 usdcAmount,
        uint256 unitAmount,
        uint256 initialUps,
        uint256 tailUps,
        uint256 halvingPeriod,
        uint256 rigEpochPeriod,
        uint256 rigPriceMultiplier,
        uint256 rigMinInitPrice,
        uint256 auctionInitPrice,
        uint256 auctionEpochPeriod,
        uint256 auctionPriceMultiplier,
        uint256 auctionMinInitPrice
    );
    event SpinCore__ProtocolFeeAddressSet(address protocolFeeAddress);
    event SpinCore__MinUsdcForLaunchSet(uint256 minUsdcForLaunch);
}
