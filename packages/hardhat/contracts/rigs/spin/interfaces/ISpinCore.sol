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
        uint256 donutAmount;
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
    function donutToken() external view returns (address);
    function uniswapV2Factory() external view returns (address);
    function uniswapV2Router() external view returns (address);
    function unitFactory() external view returns (address);
    function spinRigFactory() external view returns (address);
    function auctionFactory() external view returns (address);
    function entropy() external view returns (address);

    // State
    function protocolFeeAddress() external view returns (address);
    function minDonutForLaunch() external view returns (uint256);
    function deployedRigs(uint256 index) external view returns (address);
    function isDeployedRig(address rig) external view returns (bool);
    function rigToLauncher(address rig) external view returns (address);
    function rigToUnit(address rig) external view returns (address);
    function rigToAuction(address rig) external view returns (address);
    function rigToLP(address rig) external view returns (address);
    function rigToQuote(address rig) external view returns (address);

    // Functions
    function launch(LaunchParams calldata params)
        external
        returns (address unit, address rig, address auction, address lpToken);

    // Restricted functions
    function setProtocolFeeAddress(address _protocolFeeAddress) external;
    function setMinDonutForLaunch(uint256 _minDonutForLaunch) external;

    // View functions
    function deployedRigsLength() external view returns (uint256);

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
        uint256 donutAmount,
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
    event SpinCore__MinDonutForLaunchSet(uint256 minDonutForLaunch);
}
