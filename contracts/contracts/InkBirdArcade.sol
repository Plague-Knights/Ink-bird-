// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title InkBirdArcade
/// @notice Weekly paid-entry leaderboard for the Ink Bird game on Ink Chain.
///         Each 0.001 ETH entry grants 100 play credits (tracked off-chain by
///         the backend). 90% of the entry fee accrues to the week's prize
///         pool; 10% is forwarded to the treasury. At week end, the operator
///         submits a Merkle root of the top-100 payout distribution; winners
///         claim their share with a proof. Unclaimed funds roll forward.
///
/// @dev    UNAUDITED. Deployed to Ink mainnet by operator's explicit choice.
///         Safety rails: pause, per-week cap, claim timelock with owner veto,
///         unclaimed sweep, two-step ownership transfer.
contract InkBirdArcade {
    // ---------- Constants ----------
    uint256 public constant ENTRY_FEE = 0.001 ether;
    uint256 public constant CREDITS_PER_ENTRY = 100;
    uint256 public constant TREASURY_BPS = 1000; // 10.00%
    uint256 public constant BPS_DENOM = 10000;
    uint256 public constant WEEK = 7 days;
    uint256 public constant CLAIM_TIMELOCK = 24 hours;
    uint256 public constant UNCLAIMED_SWEEP_DELAY = 4 weeks;

    // ---------- Config ----------
    address public immutable treasury;
    address public operator;
    address public owner;
    address public pendingOwner;
    bool public paused;
    uint256 public perWeekCap;

    // ---------- Week state ----------
    uint256 public immutable genesisTime;
    mapping(uint256 => uint256) public weekPool;          // weekId => pool ETH
    mapping(uint256 => bytes32) public weekRoot;          // weekId => merkle root
    mapping(uint256 => uint256) public weekSettledAt;     // weekId => block.timestamp of settle
    mapping(uint256 => uint256) public weekTotalPayout;   // weekId => sum of all leaves
    mapping(uint256 => bool)    public weekVetoed;        // weekId => owner vetoed
    mapping(uint256 => mapping(address => bool)) public claimed;

    // ---------- Events ----------
    event EntryPurchased(address indexed player, uint256 indexed weekId, uint256 credits, uint256 poolAmount, uint256 treasuryAmount);
    event WeekSettled(uint256 indexed weekId, bytes32 root, uint256 totalPayout, uint256 unlockAt);
    event WeekVetoed(uint256 indexed weekId);
    event Claimed(uint256 indexed weekId, address indexed player, uint256 amount);
    event UnclaimedSwept(uint256 indexed weekId, uint256 amount);
    event PausedSet(bool paused);
    event OperatorRotated(address indexed newOperator);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferAccepted(address indexed from, address indexed to);
    event PerWeekCapSet(uint256 cap);

    // ---------- Modifiers ----------
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier onlyOperator() { require(msg.sender == operator, "not operator"); _; }
    modifier whenNotPaused() { require(!paused, "paused"); _; }

    // ---------- Constructor ----------
    constructor(address _treasury, address _operator) {
        require(_treasury != address(0), "zero treasury");
        require(_operator != address(0), "zero operator");
        treasury = _treasury;
        operator = _operator;
        owner = msg.sender;
        genesisTime = block.timestamp;
    }

    // ---------- Views ----------
    function currentWeekId() public view returns (uint256) {
        return (block.timestamp - genesisTime) / WEEK;
    }

    function weekStartTime(uint256 weekId) public view returns (uint256) {
        return genesisTime + weekId * WEEK;
    }

    function claimUnlockAt(uint256 weekId) public view returns (uint256) {
        uint256 s = weekSettledAt[weekId];
        return s == 0 ? 0 : s + CLAIM_TIMELOCK;
    }

    // ---------- Entry ----------
    function enter() external payable whenNotPaused {
        require(msg.value == ENTRY_FEE, "wrong fee");
        uint256 wk = currentWeekId();

        uint256 treasuryAmount = (msg.value * TREASURY_BPS) / BPS_DENOM;
        uint256 poolAmount = msg.value - treasuryAmount;

        if (perWeekCap > 0) {
            require(weekPool[wk] + poolAmount <= perWeekCap, "week cap reached");
        }
        weekPool[wk] += poolAmount;

        // Checks-effects-interactions: state updated above before external call.
        (bool ok, ) = treasury.call{value: treasuryAmount}("");
        require(ok, "treasury xfer failed");

        emit EntryPurchased(msg.sender, wk, CREDITS_PER_ENTRY, poolAmount, treasuryAmount);
    }

    // ---------- Settlement ----------
    /// @notice Operator submits the top-100 Merkle root for a finished week.
    ///         Claims unlock after CLAIM_TIMELOCK unless owner vetoes.
    function settleWeek(uint256 weekId, bytes32 root, uint256 totalPayout) external onlyOperator {
        require(weekId < currentWeekId(), "week not over");
        require(weekSettledAt[weekId] == 0, "already settled");
        require(!weekVetoed[weekId], "vetoed");
        require(totalPayout <= weekPool[weekId], "exceeds pool");
        require(root != bytes32(0), "empty root");

        weekRoot[weekId] = root;
        weekTotalPayout[weekId] = totalPayout;
        weekSettledAt[weekId] = block.timestamp;

        emit WeekSettled(weekId, root, totalPayout, block.timestamp + CLAIM_TIMELOCK);
    }

    /// @notice Owner may veto a settlement during the timelock if the operator
    ///         key is compromised or the root is wrong. Vetoed weeks roll
    ///         their full pool into the current week.
    function vetoSettlement(uint256 weekId) external onlyOwner {
        require(weekSettledAt[weekId] != 0, "not settled");
        require(block.timestamp < weekSettledAt[weekId] + CLAIM_TIMELOCK, "timelock passed");
        weekVetoed[weekId] = true;
        uint256 rolled = weekPool[weekId];
        weekPool[weekId] = 0;
        weekPool[currentWeekId()] += rolled;
        // Wipe settlement data so the week cannot be claimed.
        weekRoot[weekId] = bytes32(0);
        weekTotalPayout[weekId] = 0;
        emit WeekVetoed(weekId);
    }

    // ---------- Claim ----------
    function claim(uint256 weekId, uint256 amount, bytes32[] calldata proof) external {
        require(weekSettledAt[weekId] != 0, "not settled");
        require(!weekVetoed[weekId], "vetoed");
        require(block.timestamp >= weekSettledAt[weekId] + CLAIM_TIMELOCK, "timelocked");
        require(!claimed[weekId][msg.sender], "already claimed");
        require(amount > 0, "zero amount");

        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, amount));
        require(_verify(proof, weekRoot[weekId], leaf), "bad proof");
        require(weekPool[weekId] >= amount, "insufficient pool");

        claimed[weekId][msg.sender] = true;
        weekPool[weekId] -= amount;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "xfer failed");

        emit Claimed(weekId, msg.sender, amount);
    }

    /// @notice After UNCLAIMED_SWEEP_DELAY past settlement, owner may sweep
    ///         any unclaimed balance back into the current week's pool.
    function sweepUnclaimed(uint256 weekId) external onlyOwner {
        require(weekSettledAt[weekId] != 0, "not settled");
        require(!weekVetoed[weekId], "vetoed");
        require(block.timestamp >= weekSettledAt[weekId] + UNCLAIMED_SWEEP_DELAY, "too early");
        uint256 remaining = weekPool[weekId];
        require(remaining > 0, "nothing");
        weekPool[weekId] = 0;
        weekPool[currentWeekId()] += remaining;
        emit UnclaimedSwept(weekId, remaining);
    }

    // ---------- Admin ----------
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    function rotateOperator(address _operator) external onlyOwner {
        require(_operator != address(0), "zero");
        operator = _operator;
        emit OperatorRotated(_operator);
    }

    function setPerWeekCap(uint256 cap) external onlyOwner {
        perWeekCap = cap;
        emit PerWeekCapSet(cap);
    }

    function transferOwnership(address _newOwner) external onlyOwner {
        pendingOwner = _newOwner;
        emit OwnershipTransferStarted(owner, _newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending");
        address prev = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferAccepted(prev, owner);
    }

    // ---------- Internal ----------
    function _verify(bytes32[] calldata proof, bytes32 root, bytes32 leaf) internal pure returns (bool) {
        bytes32 h = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 p = proof[i];
            h = h < p ? keccak256(abi.encodePacked(h, p)) : keccak256(abi.encodePacked(p, h));
        }
        return h == root;
    }
}
