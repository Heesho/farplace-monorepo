"use client";

import { useState } from "react";
import { Upload, ChevronDown, ChevronUp } from "lucide-react";
import { NavBar } from "@/components/nav-bar";

// Default values based on contract constraints
// Contract bounds:
// - rigEpochPeriod: 10 min (600s) to 365 days (31536000s)
// - rigPriceMultiplier: 1.1x to 3x
// - rigMinInitPrice: 1e6 minimum (= $1 for USDC with 6 decimals)
// - initialUps: > 0, max 1e24 (values in 18 decimals, so 1 = 1e18)
// - tailUps: > 0, <= initialUps
// - halvingAmount: min 1000 tokens (1000e18)
const DEFAULTS = {
  // Liquidity
  donutAmount: 1000, // 1000 DONUT
  unitAmount: 1000000, // 1M tokens for LP

  // Mining (Rig)
  initialUps: 10, // 10 tokens/second starting emission
  tailUps: 0.1, // 0.1 token/second floor emission
  halvingAmount: 1000000, // 1M tokens before halving
  rigEpochPeriod: 3600, // 1 hour epochs
  rigPriceMultiplier: 2, // 2x price multiplier
  rigMinInitPrice: 1, // $1 min init price (contract minimum for USDC)
};

// Slider component
function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  formatValue,
  description,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  formatValue?: (value: number) => string;
  description?: string;
}) {
  const displayValue = formatValue ? formatValue(value) : value.toString();

  return (
    <div className="py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        <span className="text-[13px] font-medium tabular-nums">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-white"
      />
      {description && (
        <p className="text-[11px] text-muted-foreground mt-1">{description}</p>
      )}
    </div>
  );
}

export default function LaunchPage() {
  // Basic info
  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [tokenDescription, setTokenDescription] = useState("");
  const [miningMessage, setMiningMessage] = useState("");
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  // Advanced settings
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Liquidity
  const [donutAmount, setDonutAmount] = useState(DEFAULTS.donutAmount);
  const [unitAmount, setUnitAmount] = useState(DEFAULTS.unitAmount);

  // Mining (Rig)
  const [initialUps, setInitialUps] = useState(DEFAULTS.initialUps);
  const [tailUps, setTailUps] = useState(DEFAULTS.tailUps);
  const [halvingAmount, setHalvingAmount] = useState(DEFAULTS.halvingAmount);
  const [rigEpochPeriod, setRigEpochPeriod] = useState(DEFAULTS.rigEpochPeriod);
  const [rigPriceMultiplier, setRigPriceMultiplier] = useState(DEFAULTS.rigPriceMultiplier);
  const [rigMinInitPrice, setRigMinInitPrice] = useState(DEFAULTS.rigMinInitPrice);


  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const isFormValid = tokenName.length > 0 && tokenSymbol.length > 0;

  // Format helpers
  const formatDuration = (seconds: number) => {
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 86400)}d`;
  };

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  const formatMultiplier = (n: number) => `${n.toFixed(1)}x`;

  const formatPrice = (n: number) => `$${n.toFixed(2)}`;

  const formatRate = (n: number) => `${n}/s`;

  return (
    <main className="flex h-screen w-screen justify-center bg-zinc-800">
      <div
        className="relative flex h-full w-full max-w-[520px] flex-col bg-background"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 130px)",
        }}
      >
        {/* Header */}
        <div className="px-4 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight">Launch</h1>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto scrollbar-hide px-4 pt-2">
          <div className="space-y-4">
            {/* Logo + Name + Symbol Row */}
            <div className="flex items-start gap-4">
              {/* Logo Upload */}
              <label className="cursor-pointer flex-shrink-0">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoChange}
                  className="hidden"
                />
                <div className="w-[88px] h-[88px] rounded-xl ring-1 ring-zinc-700 flex items-center justify-center overflow-hidden hover:ring-zinc-500 transition-colors">
                  {logoPreview ? (
                    <img
                      src={logoPreview}
                      alt="Token logo"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Upload className="w-6 h-6 text-zinc-500" />
                  )}
                </div>
              </label>

              {/* Name + Symbol */}
              <div className="flex-1 min-w-0 space-y-2">
                <input
                  type="text"
                  placeholder="Token name"
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-transparent ring-1 ring-zinc-700 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-zinc-500"
                />
                <input
                  type="text"
                  placeholder="SYMBOL"
                  value={tokenSymbol}
                  onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                  maxLength={10}
                  className="w-full h-10 px-3 rounded-lg bg-transparent ring-1 ring-zinc-700 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-zinc-500"
                />
              </div>
            </div>

            {/* Description */}
            <textarea
              placeholder="Description (optional)"
              value={tokenDescription}
              onChange={(e) => setTokenDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-lg bg-transparent ring-1 ring-zinc-700 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-zinc-500 resize-none text-sm"
            />

            {/* Mining Message */}
            <input
              type="text"
              placeholder="Mining message (optional)"
              value={miningMessage}
              onChange={(e) => setMiningMessage(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-transparent ring-1 ring-zinc-700 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-zinc-500 text-sm"
            />

            {/* Advanced Settings Toggle */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between py-3 text-sm text-zinc-400 hover:text-zinc-300 transition-colors"
            >
              <span>Advanced Settings</span>
              {showAdvanced ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>

            {/* Advanced Settings */}
            {showAdvanced && (
              <div className="space-y-6 pb-4">
                {/* Liquidity Section */}
                <div>
                  <h3 className="text-[13px] font-semibold text-foreground mb-1">Liquidity</h3>
                  <Slider
                    label="DONUT for LP"
                    value={donutAmount}
                    onChange={setDonutAmount}
                    min={1000}
                    max={100000}
                    step={1000}
                    formatValue={formatNumber}
                    description="DONUT provided for initial liquidity"
                  />
                  <Slider
                    label="Initial Token Supply"
                    value={unitAmount}
                    onChange={setUnitAmount}
                    min={100000}
                    max={100000000}
                    step={100000}
                    formatValue={formatNumber}
                    description="Tokens minted for initial LP"
                  />
                </div>

                {/* Emission Section */}
                <div>
                  <h3 className="text-[13px] font-semibold text-foreground mb-1">Emission</h3>
                  <Slider
                    label="Starting Emission"
                    value={initialUps}
                    onChange={(v) => {
                      setInitialUps(v);
                      if (tailUps > v) setTailUps(v);
                    }}
                    min={1}
                    max={100}
                    formatValue={formatRate}
                    description="Tokens minted per second at launch"
                  />
                  <Slider
                    label="Floor Emission"
                    value={tailUps}
                    onChange={setTailUps}
                    min={0.01}
                    max={initialUps}
                    step={0.01}
                    formatValue={formatRate}
                    description="Minimum emission rate after halvings"
                  />
                  <Slider
                    label="Halving Threshold"
                    value={halvingAmount}
                    onChange={setHalvingAmount}
                    min={1000}
                    max={100000000}
                    step={1000}
                    formatValue={formatNumber}
                    description="Tokens minted before emission halves"
                  />
                </div>

                {/* Mining Section */}
                <div>
                  <h3 className="text-[13px] font-semibold text-foreground mb-1">Mining</h3>
                  <Slider
                    label="Epoch Duration"
                    value={rigEpochPeriod}
                    onChange={setRigEpochPeriod}
                    min={600}
                    max={86400}
                    step={600}
                    formatValue={formatDuration}
                    description="Price resets after each epoch"
                  />
                  <Slider
                    label="Price Multiplier"
                    value={rigPriceMultiplier}
                    onChange={setRigPriceMultiplier}
                    min={1.1}
                    max={3}
                    step={0.1}
                    formatValue={formatMultiplier}
                    description="Price multiplier when someone mines"
                  />
                  <Slider
                    label="Min Start Price"
                    value={rigMinInitPrice}
                    onChange={setRigMinInitPrice}
                    min={1}
                    max={100}
                    step={0.1}
                    formatValue={formatPrice}
                    description="Minimum price at epoch start"
                  />
                </div>

              </div>
            )}
          </div>
        </div>

        {/* Bottom Action Bar */}
        <div
          className="fixed bottom-0 left-0 right-0 z-50 bg-background flex justify-center"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 60px)" }}
        >
          <div className="flex items-center justify-between w-full max-w-[520px] px-4 py-3">
            <div>
              <div className="text-zinc-500 text-[12px]">Launch Fee</div>
              <div className="font-semibold text-[17px] tabular-nums">
                {formatNumber(donutAmount)} DONUT
              </div>
            </div>
            <button
              disabled={!isFormValid}
              className={`w-32 h-10 text-[14px] font-semibold rounded-xl transition-all ${
                isFormValid
                  ? "bg-white text-black hover:bg-zinc-200"
                  : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
              }`}
            >
              Launch
            </button>
          </div>
        </div>
      </div>
      <NavBar />
    </main>
  );
}
