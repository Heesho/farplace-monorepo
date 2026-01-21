// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title Rewarder
 * @author heesho
 * @notice Distributes rewards proportionally to stakers based on their balances.
 *         Only the ContentRig contract can deposit/withdraw stake. Anyone can claim rewards.
 * @dev Rewards are distributed over a 7-day period. Multiple reward tokens are supported.
 */
contract Rewarder is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /*----------  CONSTANTS  --------------------------------------------*/

    uint256 public constant DURATION = 7 days;
    uint256 public constant PRECISION = 1e18;

    /*----------  IMMUTABLES  -------------------------------------------*/

    address public immutable content;

    /*----------  STATE  ------------------------------------------------*/

    address[] public rewardTokens;
    mapping(address => Reward) public tokenToRewardData;
    mapping(address => bool) public tokenToIsReward;

    mapping(address => mapping(address => uint256)) public accountTokenToLastRewardPerToken;
    mapping(address => mapping(address => uint256)) public accountTokenToReward;

    uint256 public totalSupply;
    mapping(address => uint256) public accountToBalance;

    /*----------  STRUCTS  ----------------------------------------------*/

    struct Reward {
        uint256 periodFinish;
        uint256 rewardRate;
        uint256 lastUpdateTime;
        uint256 rewardPerTokenStored;
    }

    /*----------  ERRORS  -----------------------------------------------*/

    error Rewarder__NotContent();
    error Rewarder__AmountSmallerThanLeft();
    error Rewarder__AmountSmallerThanDuration();
    error Rewarder__NotRewardToken();
    error Rewarder__RewardTokenAlreadyAdded();
    error Rewarder__ZeroAmount();

    /*----------  EVENTS  -----------------------------------------------*/

    event Rewarder__RewardAdded(address indexed rewardToken);
    event Rewarder__RewardNotified(address indexed rewardToken, uint256 reward);
    event Rewarder__Deposited(address indexed user, uint256 amount);
    event Rewarder__Withdrawn(address indexed user, uint256 amount);
    event Rewarder__RewardPaid(address indexed user, address indexed rewardsToken, uint256 reward);

    /*----------  MODIFIERS  --------------------------------------------*/

    modifier updateReward(address account) {
        for (uint256 i; i < rewardTokens.length; i++) {
            address token = rewardTokens[i];
            tokenToRewardData[token].rewardPerTokenStored = rewardPerToken(token);
            tokenToRewardData[token].lastUpdateTime = lastTimeRewardApplicable(token);
            if (account != address(0)) {
                accountTokenToReward[account][token] = earned(account, token);
                accountTokenToLastRewardPerToken[account][token] = tokenToRewardData[token].rewardPerTokenStored;
            }
        }
        _;
    }

    modifier onlyContent() {
        if (msg.sender != content) revert Rewarder__NotContent();
        _;
    }

    modifier nonZeroInput(uint256 amount) {
        if (amount == 0) revert Rewarder__ZeroAmount();
        _;
    }

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    /**
     * @notice Deploy a new Rewarder contract.
     * @param _content ContentRig contract address that controls deposits/withdrawals
     */
    constructor(address _content) {
        content = _content;
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Claim all pending rewards for the caller.
     * @param account Address to claim rewards for
     */
    function getReward(address account) external nonReentrant updateReward(account) {
        for (uint256 i = 0; i < rewardTokens.length; i++) {
            address token = rewardTokens[i];
            uint256 amount = accountTokenToReward[account][token];
            if (amount > 0) {
                accountTokenToReward[account][token] = 0;
                emit Rewarder__RewardPaid(account, token, amount);
                IERC20(token).safeTransfer(account, amount);
            }
        }
    }

    /**
     * @notice Notify the contract of new rewards to distribute.
     * @dev Rewards must be transferred before calling. Amount must exceed leftover rewards.
     * @param token Reward token address
     * @param amount Amount of rewards to distribute
     */
    function notifyRewardAmount(address token, uint256 amount)
        external
        nonReentrant
        updateReward(address(0))
    {
        if (!tokenToIsReward[token]) revert Rewarder__NotRewardToken();
        if (amount < DURATION) revert Rewarder__AmountSmallerThanDuration();
        uint256 leftover = left(token);
        if (amount < leftover) revert Rewarder__AmountSmallerThanLeft();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        if (block.timestamp >= tokenToRewardData[token].periodFinish) {
            tokenToRewardData[token].rewardRate = amount * PRECISION / DURATION;
        } else {
            uint256 totalReward = amount + leftover;
            tokenToRewardData[token].rewardRate = totalReward * PRECISION / DURATION;
        }

        tokenToRewardData[token].lastUpdateTime = block.timestamp;
        tokenToRewardData[token].periodFinish = block.timestamp + DURATION;
        emit Rewarder__RewardNotified(token, amount);
    }

    /**
     * @notice Deposit stake for an account. Only callable by ContentRig contract.
     * @param account Account to deposit for
     * @param amount Amount to deposit
     */
    function deposit(address account, uint256 amount)
        external
        onlyContent
        nonZeroInput(amount)
        updateReward(account)
    {
        totalSupply = totalSupply + amount;
        accountToBalance[account] = accountToBalance[account] + amount;
        emit Rewarder__Deposited(account, amount);
    }

    /**
     * @notice Withdraw stake from an account. Only callable by ContentRig contract.
     * @param account Account to withdraw from
     * @param amount Amount to withdraw
     */
    function withdraw(address account, uint256 amount)
        external
        onlyContent
        nonZeroInput(amount)
        updateReward(account)
    {
        totalSupply = totalSupply - amount;
        accountToBalance[account] = accountToBalance[account] - amount;
        emit Rewarder__Withdrawn(account, amount);
    }

    /**
     * @notice Add a new reward token. Only callable by ContentRig contract.
     * @param token Reward token address to add
     */
    function addReward(address token) external onlyContent {
        if (tokenToIsReward[token]) revert Rewarder__RewardTokenAlreadyAdded();
        tokenToIsReward[token] = true;
        rewardTokens.push(token);
        emit Rewarder__RewardAdded(token);
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Get remaining rewards to distribute for a token.
     * @param token Reward token address
     * @return leftover Remaining reward amount
     */
    function left(address token) public view returns (uint256 leftover) {
        if (block.timestamp >= tokenToRewardData[token].periodFinish) return 0;
        uint256 remaining = tokenToRewardData[token].periodFinish - block.timestamp;
        return remaining * tokenToRewardData[token].rewardRate / PRECISION;
    }

    /**
     * @notice Get the last applicable reward time for a token.
     * @param token Reward token address
     * @return Minimum of current time or period finish
     */
    function lastTimeRewardApplicable(address token) public view returns (uint256) {
        return Math.min(block.timestamp, tokenToRewardData[token].periodFinish);
    }

    /**
     * @notice Get accumulated reward per token staked.
     * @param token Reward token address
     * @return Reward per token with precision
     */
    function rewardPerToken(address token) public view returns (uint256) {
        if (totalSupply == 0) {
            return tokenToRewardData[token].rewardPerTokenStored;
        }
        return tokenToRewardData[token].rewardPerTokenStored
            + (
                (lastTimeRewardApplicable(token) - tokenToRewardData[token].lastUpdateTime)
                    * tokenToRewardData[token].rewardRate
            ) / totalSupply;
    }

    /**
     * @notice Get pending rewards for an account.
     * @param account Account address
     * @param token Reward token address
     * @return Pending reward amount
     */
    function earned(address account, address token) public view returns (uint256) {
        return (
            (accountToBalance[account] * (rewardPerToken(token) - accountTokenToLastRewardPerToken[account][token]))
                / PRECISION
        ) + accountTokenToReward[account][token];
    }

    /**
     * @notice Get the number of reward tokens.
     * @return Number of reward tokens
     */
    function rewardTokensLength() external view returns (uint256) {
        return rewardTokens.length;
    }

    /**
     * @notice Get the total rewards to distribute over the DURATION period.
     * @param token Reward token address
     * @return Total reward for duration
     */
    function getRewardForDuration(address token) external view returns (uint256) {
        return tokenToRewardData[token].rewardRate * DURATION / PRECISION;
    }
}
