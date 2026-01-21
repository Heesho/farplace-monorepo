// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title MockEntropy
 * @notice Mock implementation of Pyth Entropy for testing
 * @dev Only implements the methods used by Rig contract
 */
contract MockEntropy {
    uint64 private _sequenceNumber;
    uint128 private _fee = 0.001 ether;

    mapping(uint64 => address) private _consumers;
    mapping(uint64 => bool) private _fulfilled;

    struct ProviderInfo {
        uint128 feeInWei;
        uint128 accruedFeesInWei;
        bytes32 originalCommitment;
        uint64 originalCommitmentSequenceNumber;
        bytes commitmentMetadata;
        bytes uri;
        uint64 endSequenceNumber;
        uint64 sequenceNumber;
        bytes32 currentCommitment;
        uint64 currentCommitmentSequenceNumber;
        uint256 feeManager;
        uint256 maxNumHashes;
    }

    struct Request {
        address provider;
        uint64 sequenceNumber;
        uint32 numHashes;
        bytes32 commitment;
        uint64 blockNumber;
        address requester;
        bool useBlockHash;
        bool isRequestWithCallback;
        bytes32 callbackGasLimit;
    }

    function getFeeV2() external view returns (uint128) {
        return _fee;
    }

    function getFeeV2(uint128) external view returns (uint128) {
        return _fee;
    }

    function getFeeV2(address) external view returns (uint128) {
        return _fee;
    }

    function requestV2() external payable returns (uint64 sequenceNumber) {
        require(msg.value >= _fee, "MockEntropy: insufficient fee");
        sequenceNumber = _sequenceNumber++;
        _consumers[sequenceNumber] = msg.sender;
        return sequenceNumber;
    }

    function requestV2(uint128) external payable returns (uint64 sequenceNumber) {
        require(msg.value >= _fee, "MockEntropy: insufficient fee");
        sequenceNumber = _sequenceNumber++;
        _consumers[sequenceNumber] = msg.sender;
        return sequenceNumber;
    }

    function requestV2(address, uint128) external payable returns (uint64 sequenceNumber) {
        require(msg.value >= _fee, "MockEntropy: insufficient fee");
        sequenceNumber = _sequenceNumber++;
        _consumers[sequenceNumber] = msg.sender;
        return sequenceNumber;
    }

    function getProviderInfoV2(address) external pure returns (ProviderInfo memory info) {
        return info;
    }

    function getRequestV2(address, uint64) external pure returns (Request memory request) {
        return request;
    }

    function getDefaultProvider() external pure returns (address) {
        return address(0);
    }

    // Test helper: fulfill entropy request with a specific random number
    function fulfillEntropy(uint64 sequenceNumber, bytes32 randomNumber) external {
        require(!_fulfilled[sequenceNumber], "MockEntropy: already fulfilled");
        address consumer = _consumers[sequenceNumber];
        require(consumer != address(0), "MockEntropy: unknown sequence");

        _fulfilled[sequenceNumber] = true;

        // Call the _entropyCallback on the consumer (external wrapper that calls internal entropyCallback)
        (bool success,) = consumer.call(
            abi.encodeWithSignature(
                "_entropyCallback(uint64,address,bytes32)",
                sequenceNumber,
                address(this),
                randomNumber
            )
        );
        require(success, "MockEntropy: callback failed");
    }

    // Test helper: set fee
    function setFee(uint128 fee) external {
        _fee = fee;
    }
}
