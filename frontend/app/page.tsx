"use client";

import { ChangeEvent, ReactNode, useMemo, useState } from "react";
import { BarChart3, Copy, FileUp, Loader2, Play, Plus, Trash2 } from "lucide-react";
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

type UploadedAsset = {
  id: string;
  file: File;
  label: string;
};

type Allocation = {
  asset: string;
  weight: number;
};

type Scenario = {
  id: string;
  name: string;
  allocations: Allocation[];
};

type Strategy = {
  monthlyContribution: number;
  annualContributionIncreasePct: number;
  dcaDay: number;
  reinvestDividends: boolean;
  startDate: string;
  endDate: string;
};

type ScenarioResult = {
  name: string;
  metrics: Record<string, number>;
};

type SimulationResult = {
  scenarios: ScenarioResult[];
  charts: {
    growth: Array<Record<string, number | string | null>>;
    drawdown: Array<Record<string, number | string | null>>;
    contribution: Record<string, Array<Record<string, number | string>>>;
  };
};

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1"
    ? "https://portfolio-dca-backtester.onrender.com"
    : "http://localhost:8000");
const palette = ["#0f766e", "#e85d4f", "#2563eb", "#c8902f", "#7c3aed", "#0f172a", "#0891b2", "#be123c"];

const metricColumns = [
  ["finalPortfolioValue", "Final Value"],
  ["totalInvested", "Invested"],
  ["profit", "Profit"],
  ["totalReturnPct", "Return"],
  ["cagr", "CAGR"],
  ["maxDrawdown", "Max DD"],
  ["sharpeRatio", "Sharpe"],
  ["sortinoRatio", "Sortino"],
] as const;

const yahooPriceScript = `let rows = document.querySelectorAll('table tbody tr');

let data = [];

rows.forEach(row => {

    let cols = row.querySelectorAll('td');

    // historical rows usually have 7 columns
    if (cols.length >= 6) {

        let rawDate = cols[0].innerText;

        let cleanDate =
            new Date(rawDate)
                .toISOString()
                .split('T')[0];

        // Close price column
        let close = cols[4].innerText.replace(/,/g, '');

        // skip dividend rows
        if (close.includes('Dividend')) return;

        data.push({
            date: cleanDate,
            close: close
        });
    }
});

let csv = "Date,Close\\n";

data.forEach(r => {
    csv += \`\${r.date},\${r.close}\\n\`;
});

// auto download
const blob = new Blob([csv], {
    type: 'text/csv'
});

const a = document.createElement('a');

a.href = URL.createObjectURL(blob);

a.download = 'prices.csv';

a.click();

console.log("Price CSV downloaded");`;

const yahooDividendScript = `let rows = document.querySelectorAll('table tbody tr');

let data = [];

rows.forEach(row => {

    let cols = row.querySelectorAll('td');

    if (cols.length >= 2) {

        let rawDate = cols[0].innerText;

        // convert to ISO format
        let cleanDate =
            new Date(rawDate)
                .toISOString()
                .split('T')[0];

        let rawDividend = cols[1].innerText;

        // remove " Dividend"
        let cleanDividend =
            rawDividend.replace(' Dividend', '');

        // skip invalid rows
        if (cleanDividend.includes('Stock Split')) return;

        data.push({
            date: cleanDate,
            dividend: cleanDividend
        });
    }
});

let csv = "Date,Dividends\\n";

data.forEach(r => {
    csv += \`\${r.date},\${r.dividend}\\n\`;
});

// auto download
const blob = new Blob([csv], {
    type: 'text/csv'
});

const a = document.createElement('a');

a.href = URL.createObjectURL(blob);

a.download = 'dividends.csv';

a.click();

console.log("Dividend CSV downloaded");`;

export default function Home() {
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [strategy, setStrategy] = useState<Strategy>({
    monthlyContribution: 350,
    annualContributionIncreasePct: 5,
    dcaDay: 25,
    reinvestDividends: true,
    startDate: "2021-01-01",
    endDate: "2026-01-01",
  });
  const [selectedContributionScenario, setSelectedContributionScenario] = useState("");
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  const assetLabels = assets.map((asset) => asset.label.trim().toUpperCase()).filter(Boolean);
  const duplicateAssetLabels = sortedDuplicates(assetLabels);
  const invalidScenarioMessages = useMemo(() => validateScenarios(scenarios, assetLabels), [scenarios, assetLabels]);
  const dateIsInvalid = strategy.startDate >= strategy.endDate;
  const canRun =
    assets.length > 0 &&
    scenarios.length > 0 &&
    duplicateAssetLabels.length === 0 &&
    invalidScenarioMessages.length === 0 &&
    !dateIsInvalid;

  const chartKeys = result?.scenarios.map((scenario) => scenario.name) ?? [];
  const contributionScenario =
    selectedContributionScenario || result?.scenarios[0]?.name || "";
  const contributionData = contributionScenario ? result?.charts.contribution[contributionScenario] ?? [] : [];

  function onFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    const mergedAssets = [...assets];
    selected.forEach((file) => {
      const existingIndex = mergedAssets.findIndex((asset) => asset.file.name === file.name);
      if (existingIndex >= 0) {
        mergedAssets[existingIndex] = {
          ...mergedAssets[existingIndex],
          file,
        };
        return;
      }
      mergedAssets.push({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        label: inferUniqueLabel(inferLabel(file.name), mergedAssets.map((asset) => asset.label)),
      });
    });

    setAssets(mergedAssets);
    setResult(null);
    setError("");
    event.target.value = "";

    if (selected.length > 0) {
      setScenarios((current) => {
        if (current.length > 0) {
          return current;
        }
        const first = mergedAssets[0]?.label ?? "";
        const second = mergedAssets[1]?.label;
        const defaults: Scenario[] = [
          {
            id: crypto.randomUUID(),
            name: `${first} 100`,
            allocations: [{ asset: first, weight: 100 }],
          },
        ];
        if (second) {
          defaults.push({
            id: crypto.randomUUID(),
            name: `${second} 100`,
            allocations: [{ asset: second, weight: 100 }],
          });
          defaults.push({
            id: crypto.randomUUID(),
            name: `${first} 60 / ${second} 40`,
            allocations: [
              { asset: first, weight: 60 },
              { asset: second, weight: 40 },
            ],
          });
        }
        return defaults;
      });
    }
  }

  function updateAssetLabel(id: string, label: string) {
    const normalized = label.toUpperCase();
    const previousLabel = assets.find((asset) => asset.id === id)?.label;
    setAssets((current) =>
      current.map((asset) => (asset.id === id ? { ...asset, label: normalized } : asset)),
    );
    if (!previousLabel) {
      return;
    }
    setScenarios((current) =>
      current.map((scenario) => ({
        ...scenario,
        allocations: scenario.allocations.map((allocation) =>
          allocation.asset === previousLabel ? { ...allocation, asset: normalized } : allocation,
        ),
      })),
    );
  }

  function removeAsset(id: string) {
    setAssets((current) => current.filter((asset) => asset.id !== id));
    setResult(null);
    setError("");
  }

  function addScenario() {
    const firstAsset = assetLabels[0] ?? "";
    setScenarios((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: firstAsset ? `${firstAsset} 100` : "New Scenario",
        allocations: [{ asset: firstAsset, weight: 100 }],
      },
    ]);
  }

  function cloneScenario(scenario: Scenario) {
    setScenarios((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: `${scenario.name} Copy`,
        allocations: scenario.allocations.map((allocation) => ({ ...allocation })),
      },
    ]);
  }

  function updateScenario(id: string, patch: Partial<Scenario>) {
    setScenarios((current) =>
      current.map((scenario) => (scenario.id === id ? { ...scenario, ...patch } : scenario)),
    );
  }

  function updateAllocation(scenarioId: string, index: number, patch: Partial<Allocation>) {
    setScenarios((current) =>
      current.map((scenario) =>
        scenario.id === scenarioId
          ? {
              ...scenario,
              allocations: scenario.allocations.map((allocation, allocationIndex) =>
                allocationIndex === index ? { ...allocation, ...patch } : allocation,
              ),
            }
          : scenario,
      ),
    );
  }

  async function runSimulation() {
    setError("");
    setIsRunning(true);
    setResult(null);

    const formData = new FormData();
    formData.append(
      "config",
      JSON.stringify({
        assets: assets.map((asset) => ({
          fileName: asset.file.name,
          label: asset.label.trim().toUpperCase(),
        })),
        scenarios: scenarios.map((scenario) => ({
          name: scenario.name.trim(),
          allocations: scenario.allocations.map((allocation) => ({
            asset: allocation.asset.trim().toUpperCase(),
            weight: allocation.weight,
          })),
        })),
        strategy,
      }),
    );
    assets.forEach((asset) => formData.append("files", asset.file));

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
      setSelectedContributionScenario(payload.scenarios[0]?.name ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Simulation failed.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-reef">Portfolio DCA Backtester</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-ink sm:text-4xl">
              Compare portfolio scenarios under one DCA strategy.
            </h1>
          </div>
          <button
            onClick={runSimulation}
            disabled={!canRun || isRunning}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-reef px-4 font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            title="Run scenario comparison"
          >
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run Comparison
          </button>
        </header>

        <section className="grid gap-5 lg:grid-cols-[430px_minmax(0,1fr)]">
          <div className="flex flex-col gap-5">
            <Panel title="Upload & Label Assets" icon={<FileUp className="h-5 w-5" />}>
              <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-white px-4 py-6 text-center transition hover:border-reef">
                <FileUp className="mb-3 h-8 w-8 text-reef" />
                <span className="font-medium text-ink">Select CSV or XLSX files</span>
                <span className="mt-1 text-sm text-slate-500">One file per asset. Labels can be edited after upload.</span>
                <input className="sr-only" type="file" accept=".csv,.xlsx" multiple onChange={onFilesSelected} />
              </label>
              {assets.length > 0 && (
                <div className="mt-3 space-y-2">
                  {assets.map((asset) => (
                    <div key={asset.id} className="grid grid-cols-[1fr_120px_36px] gap-2 rounded-md bg-mist px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{asset.file.name}</div>
                        <div className="text-slate-500">{Math.round(asset.file.size / 1024)} KB</div>
                      </div>
                      <input
                        value={asset.label}
                        onChange={(event) => updateAssetLabel(asset.id, event.target.value)}
                        className="h-10 rounded-md border border-slate-300 px-3 font-semibold outline-none focus:border-reef"
                        aria-label={`Label for ${asset.file.name}`}
                      />
                      <button
                        onClick={() => removeAsset(asset.id)}
                        className="flex h-10 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100"
                        title="Remove uploaded asset"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <ValidationMessage messages={[
                duplicateAssetLabels.length ? `Duplicate labels: ${duplicateAssetLabels.join(", ")}` : "",
              ]} />
            </Panel>

            <DataGuide />

            <Panel title="Portfolio Scenarios" icon={<BarChart3 className="h-5 w-5" />}>
              <div className="space-y-4">
                {scenarios.map((scenario) => {
                  const total = scenario.allocations.reduce((sum, item) => sum + Number(item.weight || 0), 0);
                  const duplicateScenarioAssets = sortedDuplicates(
                    scenario.allocations.map((allocation) => allocation.asset).filter(Boolean),
                  );
                  return (
                    <div key={scenario.id} className="rounded-md border border-slate-200 bg-white p-3">
                      <div className="mb-3 grid grid-cols-[1fr_36px_36px] gap-2">
                        <input
                          value={scenario.name}
                          onChange={(event) => updateScenario(scenario.id, { name: event.target.value })}
                          className="h-10 rounded-md border border-slate-300 px-3 font-semibold outline-none focus:border-reef"
                          aria-label="Scenario name"
                        />
                        <button
                          onClick={() => cloneScenario(scenario)}
                          className="flex h-10 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100"
                          title="Duplicate scenario"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setScenarios((current) => current.filter((item) => item.id !== scenario.id))}
                          className="flex h-10 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100"
                          title="Remove scenario"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="space-y-2">
                        {scenario.allocations.map((allocation, index) => (
                          <div key={`${scenario.id}-${index}`} className="grid grid-cols-[1fr_92px_36px] gap-2">
                            <select
                              value={allocation.asset}
                              onChange={(event) => updateAllocation(scenario.id, index, { asset: event.target.value })}
                              className="h-10 rounded-md border border-slate-300 bg-white px-3 outline-none focus:border-reef"
                              aria-label="Scenario asset"
                            >
                              <option value="">Select asset</option>
                              {assetLabels.map((label) => (
                                <option key={label} value={label}>
                                  {label}
                                </option>
                              ))}
                            </select>
                            <input
                              value={allocation.weight}
                              type="number"
                              onChange={(event) => updateAllocation(scenario.id, index, { weight: Number(event.target.value) })}
                              className="h-10 rounded-md border border-slate-300 px-3 outline-none focus:border-reef"
                              aria-label="Asset weight"
                            />
                            <button
                              onClick={() =>
                                updateScenario(scenario.id, {
                                  allocations: scenario.allocations.filter((_, allocationIndex) => allocationIndex !== index),
                                })
                              }
                              className="flex h-10 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-100"
                              title="Remove asset"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() =>
                            updateScenario(scenario.id, {
                              allocations: [...scenario.allocations, { asset: assetLabels[0] ?? "", weight: 0 }],
                            })
                          }
                          className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 px-3 font-medium text-reef hover:bg-mist"
                        >
                          <Plus className="h-4 w-4" />
                          Add Asset
                        </button>
                      </div>
                      <div className={Math.abs(total - 100) < 0.01 ? "mt-2 text-sm text-reef" : "mt-2 text-sm text-coral"}>
                        Weight total: {total.toFixed(2)}%
                      </div>
                      {duplicateScenarioAssets.length > 0 && (
                        <div className="mt-1 text-sm text-coral">Duplicate assets: {duplicateScenarioAssets.join(", ")}</div>
                      )}
                    </div>
                  );
                })}
                <button
                  onClick={addScenario}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 px-3 font-medium text-reef hover:bg-white"
                >
                  <Plus className="h-4 w-4" />
                  Add Scenario
                </button>
                <ValidationMessage messages={[...invalidScenarioMessages, dateIsInvalid ? "Start date must be before end date." : ""]} />
              </div>
            </Panel>

            <Panel title="Shared DCA Strategy" icon={<Play className="h-5 w-5" />}>
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
            <MetricsTable result={result} />
            <ChartPanel title="Portfolio Growth Comparison">
              <ResponsiveContainer width="100%" height={330}>
                <LineChart data={result?.charts.growth ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d9e1e5" />
                  <XAxis dataKey="date" minTickGap={28} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {chartKeys.map((key, index) => (
                    <Line key={key} dataKey={key} type="monotone" stroke={palette[index % palette.length]} dot={false} strokeWidth={2.5} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </ChartPanel>
            <ChartPanel title="Drawdown Comparison">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={result?.charts.drawdown ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d9e1e5" />
                  <XAxis dataKey="date" minTickGap={28} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {chartKeys.map((key, index) => (
                    <Line key={key} dataKey={key} type="monotone" stroke={palette[index % palette.length]} dot={false} strokeWidth={2} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </ChartPanel>
            <ChartPanel title="Contribution vs Growth">
              <div className="mb-3 flex justify-end">
                <select
                  value={contributionScenario}
                  onChange={(event) => setSelectedContributionScenario(event.target.value)}
                  className="h-10 rounded-md border border-slate-300 bg-white px-3 outline-none focus:border-reef"
                  aria-label="Contribution scenario"
                >
                  {result?.scenarios.map((scenario) => (
                    <option key={scenario.name} value={scenario.name}>
                      {scenario.name}
                    </option>
                  ))}
                </select>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={contributionData}>
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

function DataGuide() {
  return (
    <Panel title="Yahoo Finance Data Guide" icon={<FileUp className="h-5 w-5" />}>
      <div className="space-y-4 text-sm text-slate-600">
        <p>
          Use Yahoo Finance historical pages to export one asset at a time. Open the asset history table, set the date
          range, then paste one of these snippets into the browser console.
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Run the price script on the Historical Data table to download `prices.csv`.</li>
          <li>Run the dividend script on the Dividends page/table to download `dividends.csv`.</li>
          <li>Upload the price CSV here. If needed, merge dividends into the same file as `Date,Close,Dividends`.</li>
        </ol>
        <CodeSnippet title="Price CSV Script" code={yahooPriceScript} />
        <CodeSnippet title="Dividend CSV Script" code={yahooDividendScript} />
      </div>
    </Panel>
  );
}

function CodeSnippet({ title, code }: { title: string; code: string }) {
  async function copyCode() {
    await navigator.clipboard.writeText(code);
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 bg-mist px-3 py-2">
        <span className="font-semibold text-ink">{title}</span>
        <button
          onClick={copyCode}
          className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 font-medium text-reef hover:bg-slate-50"
          title={`Copy ${title}`}
        >
          <Copy className="h-4 w-4" />
          Copy
        </button>
      </div>
      <pre className="max-h-72 overflow-auto bg-slate-950 p-3 text-xs leading-5 text-slate-100">
        <code>{code}</code>
      </pre>
    </div>
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

function MetricsTable({ result }: { result: SimulationResult | null }) {
  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3 text-lg font-semibold text-ink">Scenario Metrics</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead className="bg-mist text-left text-slate-600">
            <tr>
              <th className="px-4 py-3 font-semibold">Scenario</th>
              {metricColumns.map(([, label]) => (
                <th key={label} className="px-4 py-3 text-right font-semibold">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(result?.scenarios ?? []).map((scenario) => (
              <tr key={scenario.name} className="border-t border-slate-100">
                <td className="px-4 py-3 font-semibold text-ink">{scenario.name}</td>
                {metricColumns.map(([key]) => (
                  <td key={key} className="px-4 py-3 text-right text-slate-700">
                    {formatMetric(key, scenario.metrics[key])}
                  </td>
                ))}
              </tr>
            ))}
            {!result && (
              <tr>
                <td className="px-4 py-8 text-slate-500" colSpan={metricColumns.length + 1}>
                  Run a comparison to populate metrics.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ValidationMessage({ messages }: { messages: string[] }) {
  const visible = messages.filter(Boolean);
  if (!visible.length) {
    return null;
  }
  return (
    <div className="mt-3 space-y-1 text-sm text-coral">
      {visible.map((message) => (
        <div key={message}>{message}</div>
      ))}
    </div>
  );
}

function inferLabel(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function inferUniqueLabel(baseLabel: string, existingLabels: string[]) {
  const existing = new Set(existingLabels.map((label) => label.trim().toUpperCase()));
  if (!existing.has(baseLabel)) {
    return baseLabel;
  }
  let index = 2;
  while (existing.has(`${baseLabel}_${index}`)) {
    index += 1;
  }
  return `${baseLabel}_${index}`;
}

function sortedDuplicates(values: string[]) {
  const normalized = values.map((value) => value.trim().toUpperCase()).filter(Boolean);
  return Array.from(new Set(normalized.filter((value, index) => normalized.indexOf(value) !== index))).sort();
}

function validateScenarios(scenarios: Scenario[], assetLabels: string[]) {
  const messages: string[] = [];
  const available = new Set(assetLabels);
  const names = scenarios.map((scenario) => scenario.name.trim()).filter(Boolean);
  const duplicateNames = sortedDuplicates(names);
  if (scenarios.length === 0) {
    messages.push("Add at least one scenario.");
  }
  if (duplicateNames.length > 0) {
    messages.push(`Duplicate scenario names: ${duplicateNames.join(", ")}`);
  }

  scenarios.forEach((scenario) => {
    const scenarioName = scenario.name.trim() || "Unnamed scenario";
    if (!scenario.name.trim()) {
      messages.push("Scenario names cannot be empty.");
    }
    const total = scenario.allocations.reduce((sum, item) => sum + Number(item.weight || 0), 0);
    if (Math.abs(total - 100) >= 0.01) {
      messages.push(`${scenarioName} weights must total 100%.`);
    }
    if (scenario.allocations.length === 0) {
      messages.push(`${scenarioName} needs at least one asset.`);
    }
    const duplicateAssets = sortedDuplicates(scenario.allocations.map((allocation) => allocation.asset));
    if (duplicateAssets.length > 0) {
      messages.push(`${scenarioName} has duplicate assets: ${duplicateAssets.join(", ")}.`);
    }
    scenario.allocations.forEach((allocation) => {
      if (!allocation.asset) {
        messages.push(`${scenarioName} has an empty asset selection.`);
      } else if (!available.has(allocation.asset)) {
        messages.push(`${scenarioName} uses an asset that is not uploaded: ${allocation.asset}.`);
      }
    });
  });

  return messages;
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
