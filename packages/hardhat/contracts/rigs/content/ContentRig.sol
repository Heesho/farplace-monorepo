// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ERC721, ERC721Enumerable, IERC721} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRewarderFactory} from "./interfaces/IRewarderFactory.sol";
import {IRewarder} from "./interfaces/IRewarder.sol";
import {IContentCore} from "./interfaces/IContentCore.sol";

/**
 * @title ContentRig
 * @author heesho
 * @notice NFT collection where collectors can "steal" content by paying a dutch auction price.
 *         The purchase price determines the owner's stake in the Rewarder, earning them Unit rewards.
 * @dev Each content has a dutch auction that resets after collection with a 2x price multiplier.
 *      Fees: 80% to previous owner, 15% to treasury, 3% to creator, 1% to team, 1% to protocol.
 */
contract ContentRig is ERC721, ERC721Enumerable, ERC721URIStorage, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    /*----------  CONSTANTS  --------------------------------------------*/

    uint256 public constant PREVIOUS_OWNER_BPS = 8_000; // 80% to previous owner
    uint256 public constant CREATOR_BPS = 300; // 3% to creator
    uint256 public constant TEAM_BPS = 400; // 4% to team
    uint256 public constant PROTOCOL_BPS = 100; // 1% to protocol
    uint256 public constant DIVISOR = 10_000;
    uint256 public constant PRECISION = 1e18;
    uint256 public constant EPOCH_PERIOD = 1 days;
    uint256 public constant PRICE_MULTIPLIER = 2e18;
    uint256 public constant ABS_MAX_INIT_PRICE = type(uint192).max;

    /*----------  IMMUTABLES  -------------------------------------------*/

    address public immutable rewarder;
    address public immutable unit;
    address public immutable quote;
    address public immutable core;
    uint256 public immutable minInitPrice;

    /*----------  STATE  ------------------------------------------------*/

    string public uri;
    address public treasury;
    address public team;

    bool public isModerated;
    mapping(address => bool) public accountToIsModerator;

    uint256 public nextTokenId;

    mapping(uint256 => bool) public tokenIdToApproved;
    mapping(uint256 => address) public tokenIdToCreator;
    mapping(uint256 => uint256) public tokenIdToEpochId;
    mapping(uint256 => uint256) public tokenIdToInitPrice;
    mapping(uint256 => uint256) public tokenIdToStartTime;
    mapping(uint256 => uint256) public tokenIdToStake;

    // Pull pattern for fee claims (prevents blacklist DoS)
    mapping(address => uint256) public accountToClaimable;

    /*----------  ERRORS  -----------------------------------------------*/

    error ContentRig__ZeroTo();
    error ContentRig__ZeroLengthUri();
    error ContentRig__ZeroMinPrice();
    error ContentRig__Expired();
    error ContentRig__EpochIdMismatch();
    error ContentRig__MaxPriceExceeded();
    error ContentRig__TransferDisabled();
    error ContentRig__NotApproved();
    error ContentRig__AlreadyApproved();
    error ContentRig__NotModerator();
    error ContentRig__InvalidTreasury();
    error ContentRig__InvalidCore();
    error ContentRig__InvalidUnit();
    error ContentRig__InvalidQuote();
    error ContentRig__NothingToClaim();

    /*----------  EVENTS  -----------------------------------------------*/

    event ContentRig__Created(address indexed who, address indexed to, uint256 indexed tokenId, string uri);
    event ContentRig__Collected(
        address indexed who,
        address indexed to,
        uint256 indexed tokenId,
        uint256 epochId,
        uint256 price
    );
    event ContentRig__UriSet(string uri);
    event ContentRig__TreasurySet(address indexed treasury);
    event ContentRig__TeamSet(address indexed team);
    event ContentRig__IsModeratedSet(bool isModerated);
    event ContentRig__ModeratorsSet(address indexed account, bool isModerator);
    event ContentRig__Approved(address indexed moderator, uint256 indexed tokenId);
    event ContentRig__RewardAdded(address indexed rewardToken);
    event ContentRig__Claimed(address indexed account, uint256 amount);

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    /**
     * @notice Deploy a new ContentRig NFT collection.
     * @param _name Token name
     * @param _symbol Token symbol
     * @param _uri Metadata URI
     * @param _unit Unit token address
     * @param _quote Quote token (WETH) address
     * @param _treasury Treasury (Auction) address for fee collection
     * @param _team Team address for fee collection
     * @param _core Core contract address
     * @param _rewarderFactory RewarderFactory address
     * @param _minInitPrice Minimum starting auction price
     * @param _isModerated Whether content requires moderator approval
     */
    constructor(
        string memory _name,
        string memory _symbol,
        string memory _uri,
        address _unit,
        address _quote,
        address _treasury,
        address _team,
        address _core,
        address _rewarderFactory,
        uint256 _minInitPrice,
        bool _isModerated
    ) ERC721(_name, _symbol) {
        if (_minInitPrice == 0) revert ContentRig__ZeroMinPrice();
        if (bytes(_uri).length == 0) revert ContentRig__ZeroLengthUri();
        if (_unit == address(0)) revert ContentRig__InvalidUnit();
        if (_quote == address(0)) revert ContentRig__InvalidQuote();
        if (_treasury == address(0)) revert ContentRig__InvalidTreasury();
        if (_core == address(0)) revert ContentRig__InvalidCore();

        uri = _uri;
        unit = _unit;
        quote = _quote;
        treasury = _treasury;
        team = _team;
        core = _core;
        minInitPrice = _minInitPrice;
        isModerated = _isModerated;

        rewarder = IRewarderFactory(_rewarderFactory).deploy(address(this));
        IRewarder(rewarder).addReward(_unit);
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Create new content NFT.
     * @param to Recipient address (becomes creator)
     * @param tokenUri Metadata URI for the content
     * @return tokenId The ID of the created token
     */
    function create(address to, string memory tokenUri) external nonReentrant returns (uint256 tokenId) {
        if (to == address(0)) revert ContentRig__ZeroTo();
        if (bytes(tokenUri).length == 0) revert ContentRig__ZeroLengthUri();

        tokenId = ++nextTokenId;
        tokenIdToCreator[tokenId] = to;
        if (!isModerated) tokenIdToApproved[tokenId] = true;

        tokenIdToInitPrice[tokenId] = minInitPrice;
        tokenIdToStartTime[tokenId] = block.timestamp;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenUri);

        emit ContentRig__Created(msg.sender, to, tokenId, tokenUri);
    }

    /**
     * @notice Collect (steal) content by paying the dutch auction price.
     * @param to Address to receive the content
     * @param tokenId Token ID to collect
     * @param epochId Expected epoch ID (frontrun protection)
     * @param deadline Transaction deadline
     * @param maxPrice Maximum price willing to pay (slippage protection)
     * @return price Actual price paid
     */
    function collect(
        address to,
        uint256 tokenId,
        uint256 epochId,
        uint256 deadline,
        uint256 maxPrice
    ) external nonReentrant returns (uint256 price) {
        if (to == address(0)) revert ContentRig__ZeroTo();
        if (!tokenIdToApproved[tokenId]) revert ContentRig__NotApproved();
        if (block.timestamp > deadline) revert ContentRig__Expired();
        if (epochId != tokenIdToEpochId[tokenId]) revert ContentRig__EpochIdMismatch();

        price = getPrice(tokenId);
        if (price > maxPrice) revert ContentRig__MaxPriceExceeded();

        address creator = tokenIdToCreator[tokenId];
        address prevOwner = ownerOf(tokenId);
        uint256 prevStake = tokenIdToStake[tokenId];

        // Calculate next epoch's starting price
        uint256 newInitPrice = price * PRICE_MULTIPLIER / PRECISION;
        if (newInitPrice > ABS_MAX_INIT_PRICE) {
            newInitPrice = ABS_MAX_INIT_PRICE;
        } else if (newInitPrice < minInitPrice) {
            newInitPrice = minInitPrice;
        }

        // Update auction state
        unchecked {
            tokenIdToEpochId[tokenId]++;
        }
        tokenIdToInitPrice[tokenId] = newInitPrice;
        tokenIdToStartTime[tokenId] = block.timestamp;
        tokenIdToStake[tokenId] = price;

        // Transfer NFT
        _transfer(prevOwner, to, tokenId);

        // Handle payments
        if (price > 0) {
            IERC20(quote).safeTransferFrom(msg.sender, address(this), price);

            // Calculate fees
            address protocol = IContentCore(core).protocolFeeAddress();
            uint256 prevOwnerAmount = price * PREVIOUS_OWNER_BPS / DIVISOR;
            uint256 creatorAmount = price * CREATOR_BPS / DIVISOR;
            uint256 teamAmount = team != address(0) ? price * TEAM_BPS / DIVISOR : 0;
            uint256 protocolAmount = protocol != address(0) ? price * PROTOCOL_BPS / DIVISOR : 0;
            uint256 treasuryAmount = price - prevOwnerAmount - creatorAmount - teamAmount - protocolAmount; // remainder collects dust

            // Distribute fees - use pull pattern for prevOwner and creator (prevents blacklist DoS)
            accountToClaimable[prevOwner] += prevOwnerAmount;
            accountToClaimable[creator] += creatorAmount;

            // Direct transfers for trusted addresses
            IERC20(quote).safeTransfer(treasury, treasuryAmount);

            if (teamAmount > 0) {
                IERC20(quote).safeTransfer(team, teamAmount);
            }
            if (protocolAmount > 0) {
                IERC20(quote).safeTransfer(protocol, protocolAmount);
            }

            // Update stake in rewarder
            IRewarder(rewarder).deposit(to, price);
        }

        // Withdraw previous owner's stake
        if (prevStake > 0) {
            IRewarder(rewarder).withdraw(prevOwner, prevStake);
        }

        emit ContentRig__Collected(msg.sender, to, tokenId, epochId, price);

        return price;
    }

    /**
     * @notice Claim accumulated fees (previous owner + creator fees).
     * @dev Uses pull pattern to prevent blacklisted addresses from blocking collections.
     *      Anyone can trigger a claim for any account. Funds go to the account, not caller.
     * @param account The account to claim for
     */
    function claim(address account) external nonReentrant {
        uint256 amount = accountToClaimable[account];
        if (amount == 0) revert ContentRig__NothingToClaim();
        accountToClaimable[account] = 0;
        IERC20(quote).safeTransfer(account, amount);
        emit ContentRig__Claimed(account, amount);
    }

    /*----------  DISABLED TRANSFERS  -----------------------------------*/

    function approve(address, uint256) public virtual override(ERC721, IERC721) {
        revert ContentRig__TransferDisabled();
    }

    function setApprovalForAll(address, bool) public virtual override(ERC721, IERC721) {
        revert ContentRig__TransferDisabled();
    }

    function transferFrom(address, address, uint256) public virtual override(ERC721, IERC721) {
        revert ContentRig__TransferDisabled();
    }

    function safeTransferFrom(address, address, uint256) public virtual override(ERC721, IERC721) {
        revert ContentRig__TransferDisabled();
    }

    function safeTransferFrom(address, address, uint256, bytes memory) public virtual override(ERC721, IERC721) {
        revert ContentRig__TransferDisabled();
    }

    /*----------  RESTRICTED FUNCTIONS  ---------------------------------*/

    /**
     * @notice Update the metadata URI.
     * @param _uri New metadata URI
     */
    function setUri(string memory _uri) external onlyOwner {
        uri = _uri;
        emit ContentRig__UriSet(_uri);
    }

    /**
     * @notice Update the treasury address.
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ContentRig__InvalidTreasury();
        treasury = _treasury;
        emit ContentRig__TreasurySet(_treasury);
    }

    /**
     * @notice Update the team address. Set to address(0) to disable team fee.
     * @param _team New team address
     */
    function setTeam(address _team) external onlyOwner {
        team = _team;
        emit ContentRig__TeamSet(_team);
    }

    /**
     * @notice Toggle moderation mode.
     * @param _isModerated Whether to enable moderation
     */
    function setIsModerated(bool _isModerated) external onlyOwner {
        isModerated = _isModerated;
        emit ContentRig__IsModeratedSet(_isModerated);
    }

    /**
     * @notice Set moderator status for accounts.
     * @param accounts Array of accounts to update
     * @param isModerator Whether to grant moderator status
     */
    function setModerators(address[] calldata accounts, bool isModerator) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            accountToIsModerator[accounts[i]] = isModerator;
            emit ContentRig__ModeratorsSet(accounts[i], isModerator);
        }
    }

    /**
     * @notice Approve content for collection (moderators only).
     * @param tokenIds Array of token IDs to approve
     */
    function approveContents(uint256[] calldata tokenIds) external {
        if (msg.sender != owner() && !accountToIsModerator[msg.sender]) revert ContentRig__NotModerator();
        for (uint256 i = 0; i < tokenIds.length; i++) {
            if (tokenIdToApproved[tokenIds[i]]) revert ContentRig__AlreadyApproved();
            ownerOf(tokenIds[i]); // Reverts if token doesn't exist
            tokenIdToApproved[tokenIds[i]] = true;
            emit ContentRig__Approved(msg.sender, tokenIds[i]);
        }
    }

    /**
     * @notice Add a new reward token to the rewarder.
     * @param rewardToken Reward token address
     */
    function addReward(address rewardToken) external onlyOwner {
        IRewarder(rewarder).addReward(rewardToken);
        emit ContentRig__RewardAdded(rewardToken);
    }

    /*----------  INTERNAL OVERRIDES  -----------------------------------*/

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 firstTokenId,
        uint256 batchSize
    ) internal override(ERC721, ERC721Enumerable) {
        super._beforeTokenTransfer(from, to, firstTokenId, batchSize);
    }

    function _burn(uint256 tokenId) internal override(ERC721, ERC721URIStorage) {
        super._burn(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Get the current price for a token.
     * @param tokenId Token ID
     * @return Current dutch auction price
     */
    function getPrice(uint256 tokenId) public view returns (uint256) {
        uint256 timePassed = block.timestamp - tokenIdToStartTime[tokenId];
        if (timePassed > EPOCH_PERIOD) return 0;
        uint256 initPrice = tokenIdToInitPrice[tokenId];
        return initPrice - initPrice * timePassed / EPOCH_PERIOD;
    }
}
