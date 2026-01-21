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
        string tokenName;
        string tokenSymbol;
        uint256 donutAmount;
        uint256 unitAmount;
        uint256 initialEmission;
        uint256 minEmission;
        uint256 minDonation;
        uint256 auctionInitPrice;
        uint256 auctionEpochPeriod;
        uint256 auctionPriceMultiplier;
        uint256 auctionMinInitPrice;
    }

    // Constants
    function RIG_TYPE() external view returns (string memory);
    function DEAD_ADDRESS() external view returns (address);
    function MIN_INITIAL_EMISSION() external view returns (uint256);
    function MAX_INITIAL_EMISSION() external view returns (uint256);
    function AUCTION_MIN_EPOCH_PERIOD() external view returns (uint256);
    function AUCTION_MAX_EPOCH_PERIOD() external view returns (uint256);
    function AUCTION_MIN_PRICE_MULTIPLIER() external view returns (uint256);
    function AUCTION_MAX_PRICE_MULTIPLIER() external view returns (uint256);
    function AUCTION_ABS_MIN_INIT_PRICE() external view returns (uint256);
    function AUCTION_ABS_MAX_INIT_PRICE() external view returns (uint256);

    // Immutables
    function registry() external view returns (address);
    function donutToken() external view returns (address);
    function uniswapV2Factory() external view returns (address);
    function uniswapV2Router() external view returns (address);
    function unitFactory() external view returns (address);
    function fundRigFactory() external view returns (address);
    function auctionFactory() external view returns (address);

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
    event FundCore__Launched(
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
        uint256 initialEmission,
        uint256 minEmission,
        uint256 minDonation,
        uint256 auctionInitPrice,
        uint256 auctionEpochPeriod,
        uint256 auctionPriceMultiplier,
        uint256 auctionMinInitPrice
    );
    event FundCore__ProtocolFeeAddressSet(address protocolFeeAddress);
    event FundCore__MinDonutForLaunchSet(uint256 minDonutForLaunch);
}
