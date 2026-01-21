// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IContentRig
 * @author heesho
 * @notice Interface for the ContentRig NFT contract.
 */
interface IContentRig {
    function create(address to, string memory tokenUri) external returns (uint256 tokenId);
    function collect(
        address to,
        uint256 tokenId,
        uint256 epochId,
        uint256 deadline,
        uint256 maxPrice
    ) external returns (uint256 price);
    function setUri(string memory _uri) external;
    function setTreasury(address _treasury) external;
    function setTeam(address _team) external;
    function setIsModerated(bool _isModerated) external;
    function setModerators(address[] calldata accounts, bool isModerator) external;
    function approveContents(uint256[] calldata tokenIds) external;
    function addReward(address rewardToken) external;
    function claim(address account) external;
    function transferOwnership(address newOwner) external;

    function rewarder() external view returns (address);
    function unit() external view returns (address);
    function quote() external view returns (address);
    function core() external view returns (address);
    function treasury() external view returns (address);
    function team() external view returns (address);
    function minInitPrice() external view returns (uint256);
    function uri() external view returns (string memory);
    function isModerated() external view returns (bool);
    function nextTokenId() external view returns (uint256);
    function tokenIdToStake(uint256 tokenId) external view returns (uint256);
    function tokenIdToCreator(uint256 tokenId) external view returns (address);
    function tokenIdToApproved(uint256 tokenId) external view returns (bool);
    function tokenIdToEpochId(uint256 tokenId) external view returns (uint256);
    function tokenIdToInitPrice(uint256 tokenId) external view returns (uint256);
    function tokenIdToStartTime(uint256 tokenId) external view returns (uint256);
    function getPrice(uint256 tokenId) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
    function tokenURI(uint256 tokenId) external view returns (string memory);
    function totalSupply() external view returns (uint256);
    function balanceOf(address owner) external view returns (uint256);
    function accountToIsModerator(address account) external view returns (bool);
    function accountToClaimable(address account) external view returns (uint256);
    function owner() external view returns (address);
}
