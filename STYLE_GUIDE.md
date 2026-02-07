# Solidity Style Guide

Guidelines for clean, professional, consistent smart contracts.

## Constructor Parameter Ordering

Separate **WHO** from **HOW**:

1. **Addresses first** (standalone params) — ordered by importance/commonality
2. **Type-specific addresses** next — params unique to this contract variant
3. **Config struct or numeric params last** — all numbers, durations, arrays

```solidity
// Good: addresses first, then numerics
constructor(
    address _token,
    address _treasury,
    address _team,
    Config memory _config
)

// Bad: mixed addresses and numbers
constructor(
    address _token,
    uint256 _duration,
    address _treasury,
    uint256 _multiplier,
    address _team
)
```

When multiple contracts share a pattern, shared params should appear in the same order across all of them. Type-specific params slot in at a consistent position.

## Config Structs

When a constructor takes 4+ numeric/array params, group them into a struct:

```solidity
// Good
struct Config {
    uint256 epochPeriod;
    uint256 priceMultiplier;
    uint256 minPrice;
    uint256[] weights;
}

// Bad: many flat uint256 params that are hard to read and easy to misorder
constructor(..., uint256 _epochPeriod, uint256 _priceMultiplier, uint256 _minPrice, ...)
```

Addresses stay as standalone params because they represent actors/dependencies (WHO), while the struct captures configuration (HOW).

## Naming Consistency

Use identical names for the same concept across all contracts:

- If one contract calls it `quote`, every related contract calls it `quote` — not `paymentToken` in one and `quote` in another
- Constructor params, storage variables, interface getters, factory deploy params, and multicall helpers should all use the same name for the same thing
- When renaming, propagate through the entire chain (contract, interface, factory, callers, tests)

## Redundant Getters

Solidity auto-generates getters for `public` state variables. Don't write manual wrappers that return the same thing:

```solidity
// Bad: redundant — `public entropyEnabled` already generates this getter
function isEntropyEnabled() external view returns (bool) {
    return entropyEnabled;
}

// Bad: redundant — `public epochId` already generates this getter
function getEpochId() external view returns (uint256) {
    return epochId;
}
```

**Exception — arrays:** Public arrays auto-generate an index-based getter `arr(uint256 index)`. You must write an explicit getter to return the full array:

```solidity
// Necessary: public arrays only expose arr(index), not the full array
function getOdds() external view returns (uint256[] memory) {
    return odds;
}

function getOddsLength() external view returns (uint256) {
    return odds.length;
}
```

**Exception — mappings:** Public mappings auto-generate key-based getters, but you may need custom view functions for complex lookups or computed values.

## Interfaces

### Keep interfaces minimal and correct
- Include all `public` immutable and state variable getters
- Include all external functions and their structs
- Organize into clear sections: Constants, Immutables, State, External Functions, Restricted Functions, View Functions

### No events in interfaces
Events belong in the implementation contract only. Interfaces define the callable surface. Consumers that need event types reference the implementation ABI directly.

### No redundant getters in interfaces
If the implementation doesn't have a manual getter (because the public variable already provides one), the interface should reference the auto-getter signature — not a removed wrapper.

## Error Naming

Use the pattern `ContractName__ErrorName`:

```solidity
// Good
error MyContract__ZeroAddress();
error MyContract__InvalidEpoch();

// Bad: no contract prefix
error ZeroAddress();

// Bad: generic or inconsistent prefix
error Core__ZeroAddress(); // ambiguous if multiple cores exist
```

## Events

### Include all meaningful params
Emit all configuration values that indexers or off-chain consumers need. Don't force them to read storage separately:

```solidity
// Good: includes everything an indexer needs
event Launched(
    address indexed launcher,
    address indexed deployed,
    uint256 amount,
    uint256 duration,
    uint256[] weights // don't forget arrays and new params
);
```

### Consistent ordering across similar contracts
If multiple contracts emit analogous events, shared fields should appear in the same order. Type-specific fields go after shared ones.

### Use `indexed` for filterable fields
The first 1-3 most important fields (addresses, IDs) should be `indexed` for log filtering. Use the same indexed fields across similar events.

## NatSpec

### Don't hardcode configurable values
```solidity
// Bad: hardcodes a default that's actually configurable
/// @param _halvingPeriod Number of days between halvings (every 30 days)

// Good: documents the actual constraints
/// @param _halvingPeriod Number of days between halvings (7-365)
```

### Include all @param entries
Every constructor and function parameter should have a `@param` tag. Don't skip any.

## Assignment and Validation Ordering

Inside constructors and functions, validate and assign in the same order params appear:

```solidity
constructor(address _unit, address _quote, address _core) {
    // Validate in param order
    if (_unit == address(0)) revert ZeroAddress();
    if (_quote == address(0)) revert ZeroAddress();
    if (_core == address(0)) revert ZeroAddress();

    // Assign in param order
    unit = _unit;
    quote = _quote;
    core = _core;
}
```

## Propagation Chain

When changing a contract's constructor, interface, or public API, update the entire chain:

1. **Contract** — constructor, storage, functions
2. **Interface** — function signatures, structs
3. **Factory** — `deploy()` params and internal constructor call
4. **Factory interface** — `deploy()` signature
5. **Core/entry point** — any function that calls the factory
6. **Helper contracts** (multicalls, routers) — view functions and wrappers
7. **Tests** — all deploy calls, getter references, assertions
8. **Off-chain** (subgraphs, ABIs, frontends) — sync updated artifacts

Never change just one layer. If you rename a param or reorder a constructor, propagate through the full chain before considering it done.

## Cross-Contract Consistency

When multiple contracts follow the same pattern (e.g., different "rig types", different "vault strategies"):

- Same constructor param ordering for shared params
- Same error naming convention
- Same event field ordering for analogous events
- Same section organization (constants, immutables, state, errors, events, constructor, external, restricted, internal, view)
- Same getter patterns — if one uses auto-getters, all of them do

## General Principles

- **Consistency over cleverness** — if three contracts do something similar, they should look similar
- **Don't over-abstract** — three similar lines of code is better than a premature abstraction
- **Fail fast** — validate all inputs at the top of functions before any state changes
- **Pull over push** — for token transfers to untrusted addresses, use claim patterns to prevent griefing
- **No dead code** — if something is unused, delete it entirely. No `// removed` comments, no `_unused` variables, no backwards-compat shims
- **No duplicate validation** — if a child contract validates a param in its constructor, the parent/factory doesn't need to validate it again
