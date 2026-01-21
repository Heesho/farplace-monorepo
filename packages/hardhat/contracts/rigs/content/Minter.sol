// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUnit} from "../../interfaces/IUnit.sol";
import {IRewarder} from "./interfaces/IRewarder.sol";

/**
 * @title Minter
 * @author heesho
 * @notice Mints Unit tokens weekly and distributes them to the Rewarder.
 *         Uses a Bitcoin-style halving emission schedule.
 * @dev Anyone can call updatePeriod() once per week to trigger minting.
 *      All tokens go directly to the Rewarder for distribution to stakers.
 */
contract Minter {
    using SafeERC20 for IERC20;

    /*----------  CONSTANTS  --------------------------------------------*/

    uint256 public constant WEEK = 7 days;
    uint256 public constant MIN_HALVING_PERIOD = 7 days;
    uint256 public constant MAX_INITIAL_UPS = 1e24;

    /*----------  IMMUTABLES  -------------------------------------------*/

    address public immutable unit;
    address public immutable rewarder;
    uint256 public immutable initialUps;
    uint256 public immutable tailUps;
    uint256 public immutable halvingPeriod;
    uint256 public immutable startTime;

    /*----------  STATE  ------------------------------------------------*/

    uint256 public activePeriod;

    /*----------  ERRORS  -----------------------------------------------*/

    error Minter__InvalidUnit();
    error Minter__InvalidRewarder();
    error Minter__InvalidInitialUps();
    error Minter__InitialUpsExceedsMax();
    error Minter__InvalidTailUps();
    error Minter__InvalidHalvingPeriod();
    error Minter__HalvingPeriodBelowMin();

    /*----------  EVENTS  -----------------------------------------------*/

    event Minter__Minted(address indexed sender, uint256 weekly);

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    /**
     * @notice Deploy a new Minter contract.
     * @param _unit Unit token address
     * @param _rewarder Rewarder contract address
     * @param _initialUps Starting units per second
     * @param _tailUps Minimum units per second after halvings
     * @param _halvingPeriod Time between halvings (minimum 7 days)
     */
    constructor(
        address _unit,
        address _rewarder,
        uint256 _initialUps,
        uint256 _tailUps,
        uint256 _halvingPeriod
    ) {
        if (_unit == address(0)) revert Minter__InvalidUnit();
        if (_rewarder == address(0)) revert Minter__InvalidRewarder();
        if (_initialUps == 0) revert Minter__InvalidInitialUps();
        if (_initialUps > MAX_INITIAL_UPS) revert Minter__InitialUpsExceedsMax();
        if (_tailUps == 0 || _tailUps > _initialUps) revert Minter__InvalidTailUps();
        if (_halvingPeriod == 0) revert Minter__InvalidHalvingPeriod();
        if (_halvingPeriod < MIN_HALVING_PERIOD) revert Minter__HalvingPeriodBelowMin();

        unit = _unit;
        rewarder = _rewarder;
        initialUps = _initialUps;
        tailUps = _tailUps;
        halvingPeriod = _halvingPeriod;
        startTime = block.timestamp;

        // Set active period to the start of the current week
        activePeriod = (block.timestamp / WEEK) * WEEK;
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Update the period and mint new tokens if a week has passed.
     * @dev Can be called by anyone. Only mints once per week.
     * @return period The current active period
     */
    function updatePeriod() external returns (uint256 period) {
        period = activePeriod;
        if (block.timestamp >= period + WEEK) {
            period = (block.timestamp / WEEK) * WEEK;
            activePeriod = period;

            uint256 weekly = weeklyEmission();

            if (weekly > 0) {
                // Mint directly to this contract
                IUnit(unit).mint(address(this), weekly);

                // Approve and notify rewarder
                IERC20(unit).safeApprove(rewarder, 0);
                IERC20(unit).safeApprove(rewarder, weekly);
                IRewarder(rewarder).notifyRewardAmount(unit, weekly);

                emit Minter__Minted(msg.sender, weekly);
            }
        }
        return period;
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Get the current weekly emission amount.
     * @return Weekly emission based on halving schedule
     */
    function weeklyEmission() public view returns (uint256) {
        return getUps() * WEEK;
    }

    /**
     * @notice Get the current units per second emission rate.
     * @return Current UPS after applying halvings
     */
    function getUps() public view returns (uint256) {
        return _getUpsFromTime(block.timestamp);
    }

    /**
     * @dev Calculate UPS at a given timestamp based on halving schedule.
     * @param time Timestamp to calculate UPS for
     * @return ups Units per second at the given time
     */
    function _getUpsFromTime(uint256 time) internal view returns (uint256 ups) {
        uint256 halvings = time <= startTime ? 0 : (time - startTime) / halvingPeriod;
        ups = initialUps >> halvings;
        if (ups < tailUps) ups = tailUps;
        return ups;
    }
}
