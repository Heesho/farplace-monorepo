// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IFundCore
 * @author heesho
 * @notice Interface for the FundCore launchpad contract.
 */
interface IFundCore {
    struct LaunchParams {
        address launcher;
        address quoteToken;
        address recipient;
        string tokenName;
        string tokenSymbol;
        string uri;
        uint256 usdcAmount;
        uint256 unitAmount;
        uint256 initialEmission;
        uint256 minEmission;
        uint256 halvingPeriod;
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
    function fundRigFactory() external view returns (address);
    function auctionFactory() external view returns (address);

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
    event FundCore__Launched(
        address indexed launcher,
        address indexed rig,
        address indexed unit,
        address recipient,
        address auction,
        address lpToken,
        address quoteToken,
        string tokenName,
        string tokenSymbol,
        string uri,
        uint256 usdcAmount,
        uint256 unitAmount,
        uint256 initialEmission,
        uint256 minEmission,
        uint256 halvingPeriod,
        uint256 auctionInitPrice,
        uint256 auctionEpochPeriod,
        uint256 auctionPriceMultiplier,
        uint256 auctionMinInitPrice
    );
    event FundCore__ProtocolFeeAddressSet(address protocolFeeAddress);
    event FundCore__MinUsdcForLaunchSet(uint256 minUsdcForLaunch);
}
