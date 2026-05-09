"use client";

import { ChangeEvent, ReactNode, useMemo, useState } from "react";
import { BarChart3, FileUp, Loader2, Play, Plus, Trash2 } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Allocation = {
  asset: string;
  weight: number;
};

type Strategy = {
  monthlyContribution: number;
  annualContributionIncreasePct: number;
  dcaDay: number;
  reinvestDividends: boolean;
  startDate: string;
  endDate: string;
};

type SimulationResult = {
  metrics: Record<string, number>;
  charts: {
    growth: Array<Record<string, number | string>>;
    drawdown: Array<Record<string, number | string>>;
    contribution: Array<Record<string, number | string>>;
  };
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const palette = ["#0f766e", "#e85d4f", "#2563eb", "#c8902f", "#7c3aed", "#0f172a"];

const metricLabels: Record<string, string> = {
  finalPortfolioValue: "Final Portfolio Value",
  totalInvested: "Total Invested",
  profit: "Profit",
  totalReturnPct: "Total Return %",
  cagr: "CAGR",
  maxDrawdown: "Max Drawdown",
  sharpeRatio: "Sharpe Ratio",
  sortinoRatio: "Sortino Ratio",
};

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([
    { asset: "VOO", weight: 50 },
    { asset: "QQQ", weight: 30 },
    { asset: "TQQQ", weight: 20 },
  ]);
  const [strategy, setStrategy] = useState<Strategy>({
    monthlyContribution: 350,
    annualContributionIncreasePct: 5,
    dcaDay: 25,
    reinvestDividends: true,
    startDate: "2021-01-01",
    endDate: "2026-01-01",
  });
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  const weightTotal = allocations.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  const uploadedAssets = useMemo(
    () => files.map((file) => file.name.split(".")[0].toUpperCase()),
    [files],
  );
  const missingUploads = allocations
    .map((item) => item.asset.toUpperCase())
    .filter((asset) => !uploadedAssets.includes(asset));
  const canRun = files.length > 0 && Math.abs(weightTotal - 100) < 0.01 && missingUploads.length === 0;

  function onFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    setFiles(selected);
    if (selected.length > 0) {
      setAllocations((current) => {
        const inferred = selected.map((file) => file.name.split(".")[0].toUpperCase());
        if (current.some((item) => inferred.includes(item.asset.toUpperCase()))) {
          return current;
        }
        const equalWeight = Number((100 / inferred.length).toFixed(2));
        return inferred.map((asset, index) => ({
          asset,
          weight: index === inferred.length - 1 ? Number((100 - equalWeight * (inferred.length - 1)).toFixed(2)) : equalWeight,
        }));
      });
    }
  }

  function updateAllocation(index: number, patch: Partial<Allocation>) {
    setAllocations((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  }

  async function runSimulation() {
    setError("");
    setIsRunning(true);
    setResult(null);

    const formData = new FormData();
    formData.append("config", JSON.stringify({ allocations, ...strategy }));
    files.forEach((file) => formData.append("files", file));

    try {
      const response = await fetch(`${API_URL}/simulate`, {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail ?? "Simulation failed.");
      }
      setResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Simulation failed.");
    } finally {
      setIsRunning(false);
    }
  }

  const growthKeys = result ? Object.keys(result.charts.growth[0] ?? {}).filter((key) => key !== "date") : [];
  const drawdownKeys = result ? Object.keys(result.charts.drawdown[0] ?? {}).filter((key) => key !== "date") : [];

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-reef">Portfolio DCA Backtester</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-ink sm:text-4xl">
              Upload, simulate, and inspect portfolio risk.
            </h1>
          </div>
          <button
            onClick={runSimulation}
            disabled={!canRun || isRunning}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-reef px-4 font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            title="Run simulation"
          >
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run Simulation
          </button>
        </header>

        <section className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="flex flex-col gap-5">
            <Panel title="Upload Files" icon={<FileUp className="h-5 w-5" />}>
              <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-white px-4 py-6 text-center transition hover:border-reef">
                <FileUp className="mb-3 h-8 w-8 text-reef" />
                <span className="font-medium text-ink">Select CSV or XLSX files</span>
                <span className="mt-1 text-sm text-slate-500">Filename should match the asset symbol.</span>
                <input className="sr-only" type="file" accept=".csv,.xlsx" multiple onChange={onFilesSelected} />
              </label>
              {files.length > 0 && (
                <div className="mt-3 space-y-2">
                  {files.map((file) => (
                    <div key={file.name} className="flex items-center justify-between rounded-md bg-mist px-3 py-2 text-sm">
                      <span className="font-medium">{file.name}</span>
                      <span className="text-slate-500">{Math.round(file.size / 1024)} KB</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Portfolio" icon={<BarChart3 className="h-5 w-5" />}>
              <div className="space-y-3">
                {allocations.map((item, index) => (
                  <div key={`${item.asset}-${index}`} className="grid grid-cols-[1fr_92px_36px] gap-2">
                    <input
                      value={item.asset}
                      onChange={(event) => updateAllocation(index, { asset: event.target.value.toUpperCase() })}
                      className="h-10 rounded-md border border-slate-300 px-3 outline-none focus:border-reef"
                      aria-label="Asset symbol"
                    />
                    <input
                      value={item.weight}
                      type="number"
                      onChange={(event) => updateAllocation(index, { weight: Number(event.target.value) })}
                      className="h-10 rounded-md border border-slate-300 px-3 outline-none focus:border-reef"
                      aria-label="Asset weight"
                    />
                    <button
                      onClick={() => setAllocations((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      className="flex h-10 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100"
                      title="Remove asset"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setAllocations((current) => [...current, { asset: "", weight: 0 }])}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 px-3 font-medium text-reef hover:bg-white"
                >
                  <Plus className="h-4 w-4" />
                  Add Asset
                </button>
                <div className={weightTotal === 100 ? "text-sm text-reef" : "text-sm text-coral"}>
                  Weight total: {weightTotal.toFixed(2)}%
                </div>
                {missingUploads.length > 0 && (
                  <div className="text-sm text-coral">Missing files: {missingUploads.join(", ")}</div>
                )}
              </div>
            </Panel>

            <Panel title="Strategy" icon={<Play className="h-5 w-5" />}>
              <div className="grid gap-3">
                <NumberField label="Monthly Contribution" value={strategy.monthlyContribution} onChange={(value) => setStrategy({ ...strategy, monthlyContribution: value })} />
                <NumberField label="Annual Increase %" value={strategy.annualContributionIncreasePct} onChange={(value) => setStrategy({ ...strategy, annualContributionIncreasePct: value })} />
                <NumberField label="DCA Day" value={strategy.dcaDay} onChange={(value) => setStrategy({ ...strategy, dcaDay: value })} />
                <DateField label="Start Date" value={strategy.startDate} onChange={(value) => setStrategy({ ...strategy, startDate: value })} />
                <DateField label="End Date" value={strategy.endDate} onChange={(value) => setStrategy({ ...strategy, endDate: value })} />
                <label className="flex items-center justify-between rounded-md bg-mist px-3 py-2">
                  <span className="font-medium">Reinvest Dividends</span>
                  <input
                    type="checkbox"
                    checked={strategy.reinvestDividends}
                    onChange={(event) => setStrategy({ ...strategy, reinvestDividends: event.target.checked })}
                    className="h-5 w-5 accent-reef"
                  />
                </label>
              </div>
            </Panel>
          </div>

          <section className="flex flex-col gap-5">
            {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
            <Metrics result={result} />
            <ChartPanel title="Portfolio Growth">
              <ResponsiveContainer width="100%" height={330}>
                <LineChart data={result?.charts.growth ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d9e1e5" />
                  <XAxis dataKey="date" minTickGap={28} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {growthKeys.map((key, index) => (
                    <Line key={key} dataKey={key} type="monotone" stroke={palette[index % palette.length]} dot={false} strokeWidth={key === "portfolioValue" ? 3 : 2} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </ChartPanel>
            <ChartPanel title="Drawdown">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={result?.charts.drawdown ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d9e1e5" />
                  <XAxis dataKey="date" minTickGap={28} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {drawdownKeys.map((key, index) => (
                    <Line key={key} dataKey={key} type="monotone" stroke={palette[index % palette.length]} dot={false} strokeWidth={2} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </ChartPanel>
            <ChartPanel title="Contribution vs Growth">
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={result?.charts.contribution ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d9e1e5" />
                  <XAxis dataKey="date" minTickGap={28} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Area dataKey="investedCapital" stackId="1" stroke="#0f766e" fill="#0f766e" fillOpacity={0.72} />
                  <Area dataKey="unrealizedGains" stackId="1" stroke="#c8902f" fill="#c8902f" fillOpacity={0.72} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartPanel>
          </section>
        </section>
      </div>
    </main>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2 text-lg font-semibold text-ink">
        <span className="text-reef">{icon}</span>
        {title}
      </div>
      {children}
    </section>
  );
}

function ChartPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-10 rounded-md border border-slate-300 px-3 outline-none focus:border-reef"
      />
    </label>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-md border border-slate-300 px-3 outline-none focus:border-reef"
      />
    </label>
  );
}

function Metrics({ result }: { result: SimulationResult | null }) {
  const metrics = result?.metrics ?? {};
  const entries = Object.entries(metricLabels);

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {entries.map(([key, label]) => (
        <div key={key} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-medium text-slate-500">{label}</div>
          <div className="mt-2 text-2xl font-semibold text-ink">{formatMetric(key, metrics[key])}</div>
        </div>
      ))}
    </section>
  );
}

function formatMetric(key: string, value?: number) {
  if (value === undefined) {
    return "-";
  }
  if (["finalPortfolioValue", "totalInvested", "profit"].includes(key)) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
  }
  if (["totalReturnPct", "cagr", "maxDrawdown"].includes(key)) {
    return `${value.toFixed(2)}%`;
  }
  return value.toFixed(2);
}
