"use client";

import { useState, useEffect } from "react";
import { X, Plus, Minus, AlertCircle, AlertTriangle } from "lucide-react";
import { NavBar } from "@/components/nav-bar";

type RigType = "mine" | "spin" | "fund";

type AdminModalProps = {
  isOpen: boolean;
  onClose: () => void;
  rigType: RigType;
  tokenSymbol?: string;
  tokenName?: string;
  currentConfig: {
    // Common
    treasury: string;
    team: string | null;
    uri: string;
    // Mine specific
    capacity?: number;
    randomnessEnabled?: boolean;
    upsMultipliers?: number[];
    upsMultiplierDuration?: number;
    // Spin specific
    odds?: number[];
    // Fund specific
    recipient?: string | null;
  };
};

function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// Max capacity for now
const MAX_CAPACITY = 25;

export function AdminModal({
  isOpen,
  onClose,
  rigType,
  tokenSymbol = "TOKEN",
  tokenName = "Token",
  currentConfig,
}: AdminModalProps) {
  // Common state
  const [treasury, setTreasury] = useState(currentConfig.treasury);
  const [team, setTeam] = useState(currentConfig.team || "");
  const [uri, setUri] = useState(currentConfig.uri || "");

  // Mine specific state
  const [capacity, setCapacity] = useState(currentConfig.capacity || 1);
  const [randomnessEnabled, setRandomnessEnabled] = useState(currentConfig.randomnessEnabled ?? false);
  const [upsMultipliers, setUpsMultipliers] = useState<number[]>(currentConfig.upsMultipliers || [1]);
  const [upsMultiplierDuration, setUpsMultiplierDuration] = useState(currentConfig.upsMultiplierDuration || 86400);

  // Spin specific state
  const [odds, setOdds] = useState<number[]>(currentConfig.odds || [100]);

  // Fund specific state
  const [recipient, setRecipient] = useState(currentConfig.recipient || "");

  // Transaction state
  const [isSaving, setIsSaving] = useState(false);
  const [pendingField, setPendingField] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setTreasury(currentConfig.treasury);
      setTeam(currentConfig.team || "");
      setUri(currentConfig.uri || "");
      setCapacity(currentConfig.capacity || 1);
      setRandomnessEnabled(currentConfig.randomnessEnabled ?? false);
      setUpsMultipliers(currentConfig.upsMultipliers || [1]);
      setUpsMultiplierDuration(currentConfig.upsMultiplierDuration || 86400);
      setOdds(currentConfig.odds || [100]);
      setRecipient(currentConfig.recipient || "");
    }
  }, [isOpen, currentConfig]);

  // Validation helpers
  const isTreasuryValid = isValidAddress(treasury);
  const isTeamValid = team === "" || isValidAddress(team);
  const isRecipientValid = rigType !== "fund" || isValidAddress(recipient);

  // Check if randomness toggle changed
  const randomnessChanged = randomnessEnabled !== (currentConfig.randomnessEnabled ?? false);

  // Duration options for multiplier duration
  const durationOptions = [
    { value: 3600, label: "1h" },
    { value: 7200, label: "2h" },
    { value: 14400, label: "4h" },
    { value: 28800, label: "8h" },
    { value: 43200, label: "12h" },
    { value: 86400, label: "24h" },
    { value: 172800, label: "2d" },
    { value: 259200, label: "3d" },
    { value: 604800, label: "7d" },
  ];

  // Handle individual field save (mock)
  const handleSave = async (field: string) => {
    setPendingField(field);
    setIsSaving(true);
    // Mock save - in real implementation, call contract
    await new Promise(resolve => setTimeout(resolve, 1500));
    setIsSaving(false);
    setPendingField(null);
  };

  // Capacity controls
  const minCapacity = currentConfig.capacity || 1;
  const canDecreaseCapacity = false; // Never can decrease
  const canIncreaseCapacity = capacity < MAX_CAPACITY;

  const increaseCapacity = () => {
    if (capacity < MAX_CAPACITY) {
      setCapacity(capacity + 1);
    }
  };

  const decreaseCapacity = () => {
    // Can only decrease back to current (not below)
    if (capacity > minCapacity) {
      setCapacity(capacity - 1);
    }
  };

  // Multiplier presets
  const multiplierPresets = [1, 2, 3, 5, 10];

  // Count occurrences of each multiplier
  const getMultiplierCount = (value: number) => upsMultipliers.filter(m => m === value).length;

  // Add multiplier value to pool
  const addMultiplier = (value: number) => {
    if (upsMultipliers.length < 20) {
      setUpsMultipliers([...upsMultipliers, value].sort((a, b) => a - b));
    }
  };

  // Remove one instance of multiplier value from pool
  const removeMultiplier = (value: number) => {
    const idx = upsMultipliers.indexOf(value);
    if (idx !== -1 && upsMultipliers.length > 1) {
      const newMultipliers = [...upsMultipliers];
      newMultipliers.splice(idx, 1);
      setUpsMultipliers(newMultipliers);
    }
  };

  // Odds presets in basis points (100 bp = 1%)
  const oddsPresets = [
    { value: 10, label: "0.1%" },
    { value: 50, label: "0.5%" },
    { value: 100, label: "1%" },
    { value: 200, label: "2%" },
    { value: 500, label: "5%" },
    { value: 1000, label: "10%" },
    { value: 2500, label: "25%" },
    { value: 5000, label: "50%" },
  ];

  // Count occurrences of each odds value
  const getOddsCount = (value: number) => odds.filter(o => o === value).length;

  // Add odds value to pool
  const addOdds = (value: number) => {
    if (odds.length < 20) {
      setOdds([...odds, value].sort((a, b) => a - b));
    }
  };

  // Remove one instance of odds value from pool
  const removeOdds = (value: number) => {
    const idx = odds.indexOf(value);
    if (idx !== -1 && odds.length > 1) {
      const newOdds = [...odds];
      newOdds.splice(idx, 1);
      setOdds(newOdds);
    }
  };

  if (!isOpen) return null;

  const rigTypeLabel = rigType === "mine" ? "Mine" : rigType === "spin" ? "Spin" : "Fund";

  return (
    <div className="fixed inset-0 z-[100] flex h-screen w-screen justify-center bg-zinc-800">
      <div
        className="relative flex h-full w-full max-w-[520px] flex-col bg-background"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 70px)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-2">
          <button
            onClick={onClose}
            className="p-2 -ml-2 rounded-xl hover:bg-secondary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <span className="text-base font-semibold">Admin</span>
          <div className="w-9" />
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4">
          {/* Info Banner */}
          <div className="flex items-start gap-2 p-3 rounded-xl bg-zinc-800/50 mb-6">
            <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-[12px] text-muted-foreground">
              You are the owner of this {rigTypeLabel} Rig. Changes made here will be submitted as on-chain transactions.
            </p>
          </div>

          {/* Fund-specific: Recipient */}
          {rigType === "fund" && (
            <div className="mb-6">
              <div className="font-semibold text-[18px] mb-3">Recipient</div>
              <div className="space-y-3">
                <div>
                  <label className="text-muted-foreground text-[12px] mb-1 block">
                    Recipient Address (receives 50% of funds)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder="0x..."
                      className="flex-1 bg-zinc-800 rounded-xl px-4 py-2.5 text-[14px] font-mono outline-none placeholder:text-zinc-600"
                    />
                    <button
                      onClick={() => handleSave("recipient")}
                      disabled={isSaving || !isRecipientValid || recipient === currentConfig.recipient}
                      className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                        isSaving && pendingField === "recipient"
                          ? "bg-zinc-700 text-zinc-400"
                          : isRecipientValid && recipient !== currentConfig.recipient
                          ? "bg-white text-black hover:bg-zinc-200"
                          : "bg-zinc-700 text-zinc-500"
                      }`}
                    >
                      {isSaving && pendingField === "recipient" ? "..." : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Common: Addresses */}
          <div className="mb-6">
            <div className="font-semibold text-[18px] mb-3">Addresses</div>
            <div className="space-y-3">
              <div>
                <label className="text-muted-foreground text-[12px] mb-1 block">
                  Treasury Address (receives treasury fees)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={treasury}
                    onChange={(e) => setTreasury(e.target.value)}
                    placeholder="0x..."
                    className="flex-1 bg-zinc-800 rounded-xl px-4 py-2.5 text-[14px] font-mono outline-none placeholder:text-zinc-600"
                  />
                  <button
                    onClick={() => handleSave("treasury")}
                    disabled={isSaving || !isTreasuryValid || treasury === currentConfig.treasury}
                    className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                      isSaving && pendingField === "treasury"
                        ? "bg-zinc-700 text-zinc-400"
                        : isTreasuryValid && treasury !== currentConfig.treasury
                        ? "bg-white text-black hover:bg-zinc-200"
                        : "bg-zinc-700 text-zinc-500"
                    }`}
                  >
                    {isSaving && pendingField === "treasury" ? "..." : "Save"}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-muted-foreground text-[12px] mb-1 block">
                  Team Address (receives 4% fee, leave empty to disable)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={team}
                    onChange={(e) => setTeam(e.target.value)}
                    placeholder="0x... (optional)"
                    className="flex-1 bg-zinc-800 rounded-xl px-4 py-2.5 text-[14px] font-mono outline-none placeholder:text-zinc-600"
                  />
                  <button
                    onClick={() => handleSave("team")}
                    disabled={isSaving || !isTeamValid || team === (currentConfig.team || "")}
                    className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                      isSaving && pendingField === "team"
                        ? "bg-zinc-700 text-zinc-400"
                        : isTeamValid && team !== (currentConfig.team || "")
                        ? "bg-white text-black hover:bg-zinc-200"
                        : "bg-zinc-700 text-zinc-500"
                    }`}
                  >
                    {isSaving && pendingField === "team" ? "..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Mine-specific: Capacity */}
          {rigType === "mine" && (
            <div className="mb-6">
              <div className="font-semibold text-[18px] mb-3">Capacity</div>

              {/* Warning */}
              <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 mb-3">
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-[12px] text-amber-200">
                  Increasing capacity cannot be undone. Once you add slots, they are permanent.
                </p>
              </div>

              <div>
                <label className="text-muted-foreground text-[12px] mb-2 block">
                  Mining Slots (max {MAX_CAPACITY})
                </label>

                {/* +/- Controls */}
                <div className="flex items-center gap-3 mb-3">
                  <button
                    onClick={decreaseCapacity}
                    disabled={capacity <= minCapacity}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                      capacity <= minCapacity
                        ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                        : "bg-zinc-700 text-white hover:bg-zinc-600"
                    }`}
                  >
                    <Minus className="w-5 h-5" />
                  </button>

                  <div className="flex-1 text-center">
                    <div className="text-3xl font-bold tabular-nums">{capacity}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {capacity === minCapacity ? "current" : `+${capacity - minCapacity} from current`}
                    </div>
                  </div>

                  <button
                    onClick={increaseCapacity}
                    disabled={capacity >= MAX_CAPACITY}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                      capacity >= MAX_CAPACITY
                        ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                        : "bg-zinc-700 text-white hover:bg-zinc-600"
                    }`}
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>

                {/* Quick add buttons */}
                <div className="flex gap-2 mb-3">
                  {[1, 2, 5, 10].map((add) => {
                    const newValue = minCapacity + add;
                    const isDisabled = newValue > MAX_CAPACITY;
                    const isSelected = capacity === newValue;
                    return (
                      <button
                        key={add}
                        onClick={() => !isDisabled && setCapacity(newValue)}
                        disabled={isDisabled}
                        className={`flex-1 py-2 rounded-lg text-[12px] font-medium transition-all ${
                          isDisabled
                            ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                            : isSelected
                            ? "bg-white text-black"
                            : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                        }`}
                      >
                        +{add}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={() => handleSave("capacity")}
                  disabled={isSaving || capacity <= minCapacity}
                  className={`w-full py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                    isSaving && pendingField === "capacity"
                      ? "bg-zinc-700 text-zinc-400"
                      : capacity > minCapacity
                      ? "bg-white text-black hover:bg-zinc-200"
                      : "bg-zinc-700 text-zinc-500"
                  }`}
                >
                  {isSaving && pendingField === "capacity"
                    ? "Saving..."
                    : capacity > minCapacity
                    ? `Add ${capacity - minCapacity} Slot${capacity - minCapacity > 1 ? 's' : ''}`
                    : "No Changes"}
                </button>
              </div>
            </div>
          )}

          {/* Mine-specific: Randomness */}
          {rigType === "mine" && (
            <div className="mb-6">
              <div className="font-semibold text-[18px] mb-3">Randomness</div>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-800/50">
                  <div>
                    <div className="text-[14px] font-medium">Enable Multipliers</div>
                    <div className="text-muted-foreground text-[12px]">Use VRF for random UPS multipliers</div>
                  </div>
                  <button
                    onClick={() => setRandomnessEnabled(!randomnessEnabled)}
                    disabled={isSaving}
                    className={`w-12 h-7 rounded-full transition-all relative ${
                      randomnessEnabled ? "bg-white" : "bg-zinc-700"
                    }`}
                  >
                    <div
                      className={`absolute w-5 h-5 rounded-full top-1 transition-all ${
                        randomnessEnabled ? "right-1 bg-black" : "left-1 bg-zinc-500"
                      }`}
                    />
                  </button>
                </div>

                {/* Save button for toggle change */}
                {randomnessChanged && (
                  <button
                    onClick={() => handleSave("randomness")}
                    disabled={isSaving}
                    className={`w-full py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                      isSaving && pendingField === "randomness"
                        ? "bg-zinc-700 text-zinc-400"
                        : "bg-white text-black hover:bg-zinc-200"
                    }`}
                  >
                    {isSaving && pendingField === "randomness"
                      ? "Saving..."
                      : randomnessEnabled
                      ? "Enable Multipliers"
                      : "Disable Multipliers"}
                  </button>
                )}

                {randomnessEnabled && (
                  <>
                    <div>
                      <label className="text-muted-foreground text-[12px] mb-2 block">
                        Multiplier Duration
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {durationOptions.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => setUpsMultiplierDuration(opt.value)}
                            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                              upsMultiplierDuration === opt.value
                                ? "bg-white text-black"
                                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => handleSave("multiplierDuration")}
                        disabled={isSaving || upsMultiplierDuration === currentConfig.upsMultiplierDuration}
                        className={`mt-2 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all ${
                          isSaving && pendingField === "multiplierDuration"
                            ? "bg-zinc-700 text-zinc-400"
                            : upsMultiplierDuration !== currentConfig.upsMultiplierDuration
                            ? "bg-white text-black hover:bg-zinc-200"
                            : "bg-zinc-700 text-zinc-500"
                        }`}
                      >
                        {isSaving && pendingField === "multiplierDuration" ? "Saving..." : "Save Duration"}
                      </button>
                    </div>

                    <div>
                      <label className="text-muted-foreground text-[12px] mb-2 block">
                        Multiplier Pool ({upsMultipliers.length}/20)
                      </label>
                      <p className="text-muted-foreground text-[11px] mb-3">
                        Tap + to add, - to remove. One is randomly selected when mining.
                      </p>
                      <div className="grid grid-cols-5 gap-2 mb-3">
                        {multiplierPresets.map((mult) => {
                          const count = getMultiplierCount(mult);
                          const canAdd = upsMultipliers.length < 20;
                          const canRemove = count > 0 && upsMultipliers.length > 1;
                          const probability = upsMultipliers.length > 0
                            ? Math.round((count / upsMultipliers.length) * 100)
                            : 0;
                          return (
                            <div key={mult} className="flex flex-col items-center gap-1">
                              <div className="text-[14px] font-semibold">{mult}x</div>
                              <div className="flex items-center gap-0.5">
                                <button
                                  onClick={() => removeMultiplier(mult)}
                                  disabled={!canRemove}
                                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                                    canRemove
                                      ? "bg-zinc-700 text-white hover:bg-zinc-600"
                                      : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                                  }`}
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                                <div className="w-8 text-center text-[14px] font-bold tabular-nums">
                                  {count}
                                </div>
                                <button
                                  onClick={() => addMultiplier(mult)}
                                  disabled={!canAdd}
                                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                                    canAdd
                                      ? "bg-zinc-700 text-white hover:bg-zinc-600"
                                      : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                                  }`}
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <div className="text-[11px] text-muted-foreground tabular-nums">
                                {probability}%
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {/* Visual summary of pool */}
                      <div className="p-3 rounded-xl bg-zinc-800/50 mb-3">
                        <div className="text-[11px] text-muted-foreground mb-1">Current pool:</div>
                        <div className="flex flex-wrap gap-1">
                          {upsMultipliers.map((mult, i) => (
                            <span key={i} className="px-2 py-0.5 rounded bg-zinc-700 text-[12px] font-medium">
                              {mult}x
                            </span>
                          ))}
                        </div>
                      </div>
                      <button
                        onClick={() => handleSave("multipliers")}
                        disabled={isSaving || JSON.stringify(upsMultipliers) === JSON.stringify(currentConfig.upsMultipliers)}
                        className={`w-full py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                          isSaving && pendingField === "multipliers"
                            ? "bg-zinc-700 text-zinc-400"
                            : JSON.stringify(upsMultipliers) !== JSON.stringify(currentConfig.upsMultipliers)
                            ? "bg-white text-black hover:bg-zinc-200"
                            : "bg-zinc-700 text-zinc-500"
                        }`}
                      >
                        {isSaving && pendingField === "multipliers" ? "Saving..." : "Save Multipliers"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Spin-specific: Odds */}
          {rigType === "spin" && (
            <div className="mb-6">
              <div className="font-semibold text-[18px] mb-3">Spin Odds</div>
              <div>
                <label className="text-muted-foreground text-[12px] mb-2 block">
                  Payout Pool ({odds.length}/20)
                </label>
                <p className="text-muted-foreground text-[11px] mb-3">
                  Tap + to add, - to remove. One is randomly selected per spin.
                </p>
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {oddsPresets.map((preset) => {
                    const count = getOddsCount(preset.value);
                    const canAdd = odds.length < 20;
                    const canRemove = count > 0 && odds.length > 1;
                    const probability = odds.length > 0
                      ? Math.round((count / odds.length) * 100)
                      : 0;
                    return (
                      <div key={preset.value} className="flex flex-col items-center gap-1 p-2 rounded-xl bg-zinc-800/30">
                        <div className="text-[13px] font-semibold">{preset.label}</div>
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => removeOdds(preset.value)}
                            disabled={!canRemove}
                            className={`w-6 h-6 rounded-md flex items-center justify-center transition-all ${
                              canRemove
                                ? "bg-zinc-700 text-white hover:bg-zinc-600"
                                : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                            }`}
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <div className="w-6 text-center text-[13px] font-bold tabular-nums">
                            {count}
                          </div>
                          <button
                            onClick={() => addOdds(preset.value)}
                            disabled={!canAdd}
                            className={`w-6 h-6 rounded-md flex items-center justify-center transition-all ${
                              canAdd
                                ? "bg-zinc-700 text-white hover:bg-zinc-600"
                                : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                            }`}
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="text-[10px] text-muted-foreground tabular-nums">
                          {probability}%
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Visual summary of pool */}
                <div className="p-3 rounded-xl bg-zinc-800/50 mb-3">
                  <div className="text-[11px] text-muted-foreground mb-1">Current pool:</div>
                  <div className="flex flex-wrap gap-1">
                    {odds.map((o, i) => {
                      const preset = oddsPresets.find(p => p.value === o);
                      return (
                        <span key={i} className="px-2 py-0.5 rounded bg-zinc-700 text-[12px] font-medium">
                          {preset ? preset.label : `${(o / 100).toFixed(1)}%`}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <button
                  onClick={() => handleSave("odds")}
                  disabled={isSaving || JSON.stringify(odds) === JSON.stringify(currentConfig.odds)}
                  className={`w-full py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                    isSaving && pendingField === "odds"
                      ? "bg-zinc-700 text-zinc-400"
                      : JSON.stringify(odds) !== JSON.stringify(currentConfig.odds)
                      ? "bg-white text-black hover:bg-zinc-200"
                      : "bg-zinc-700 text-zinc-500"
                  }`}
                >
                  {isSaving && pendingField === "odds" ? "Saving..." : "Save Odds"}
                </button>
              </div>
            </div>
          )}

          {/* Common: Metadata URI */}
          <div className="mb-6">
            <div className="font-semibold text-[18px] mb-3">Metadata</div>
            <div>
              <label className="text-muted-foreground text-[12px] mb-1 block">
                URI (for logo, branding, etc.)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={uri}
                  onChange={(e) => setUri(e.target.value)}
                  placeholder="https://..."
                  className="flex-1 bg-zinc-800 rounded-xl px-4 py-2.5 text-[14px] outline-none placeholder:text-zinc-600"
                />
                <button
                  onClick={() => handleSave("uri")}
                  disabled={isSaving || uri === (currentConfig.uri || "")}
                  className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
                    isSaving && pendingField === "uri"
                      ? "bg-zinc-700 text-zinc-400"
                      : uri !== (currentConfig.uri || "")
                      ? "bg-white text-black hover:bg-zinc-200"
                      : "bg-zinc-700 text-zinc-500"
                  }`}
                >
                  {isSaving && pendingField === "uri" ? "..." : "Save"}
                </button>
              </div>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="mb-6 pb-6">
            <div className="font-semibold text-[18px] mb-3 text-red-500">Danger Zone</div>
            <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/5">
              <div className="text-[14px] font-medium mb-1">Transfer Ownership</div>
              <p className="text-muted-foreground text-[12px] mb-3">
                Transfer control of this rig to another address. This action is irreversible.
              </p>
              <button
                className="px-4 py-2 rounded-xl text-[13px] font-semibold bg-red-500/20 text-red-500 hover:bg-red-500/30 transition-colors"
              >
                Transfer Ownership
              </button>
            </div>
          </div>
        </div>
      </div>
      <NavBar />
    </div>
  );
}
