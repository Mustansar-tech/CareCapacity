import { Fragment, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  Filter,
  Home,
  Menu,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import './_group.css';

type Trend = 'up' | 'down' | 'flat' | 'missing';
type Row = {
  office: string;
  region: string;
  dayRate: number | null;
  revenue: number | null;
  change: number | null;
  trend: Trend;
  values: (number | null)[];
  lic?: boolean;
};

const days = ['03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const rows: Row[] = [
  { office: 'East Cheshire', region: 'SUR Group', dayRate: 1_112.40, revenue: 25_384, change: 7.8, trend: 'up', values: [1030, 1062, 1018, 1075, 1098, 1104, 1116, 1092, 1107, 1112] },
  { office: 'Edinburgh West', region: 'Independent', dayRate: 986.25, revenue: 19_725, change: -4.2, trend: 'down', values: [1021, 1007, 1014, 992, 1008, 995, 972, 981, 991, 986] },
  { office: 'Glasgow South', region: 'SUR Group', dayRate: 924.70, revenue: 16_644, change: 2.1, trend: 'up', values: [892, 901, 900, 916, 914, 920, 918, 924, 923, 925], lic: true },
  { office: 'Stirling & Falkirk', region: 'Independent', dayRate: 861.10, revenue: 13_777, change: 0, trend: 'flat', values: [861, 862, 860, 861, 862, 860, 861, 861, 861, 861] },
  { office: 'Perth', region: 'Independent', dayRate: null, revenue: null, change: null, trend: 'missing', values: [812, 820, null, null, null, null, null, null, null, null] },
  { office: 'Inverclyde & N Ayrshire', region: 'SUR Group', dayRate: 744.80, revenue: 10_427, change: -8.6, trend: 'down', values: [819, 806, 794, 781, 775, 768, 759, 751, 748, 745] },
];

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const precise = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 });
const formatRevenue = (value: number | null) => value === null ? '—' : gbp.format(value);

function TrendMark({ trend }: { trend: Trend }) {
  if (trend === 'up') return <span className="inline-flex items-center gap-1 text-[#087f78]"><ArrowUpRight size={14} /> rising</span>;
  if (trend === 'down') return <span className="inline-flex items-center gap-1 text-[#bc5d4f]"><ArrowDownRight size={14} /> falling</span>;
  if (trend === 'flat') return <span className="text-[#b17c35]">flat</span>;
  return <span className="text-[#8a9b99]">not yet reported</span>;
}

export function ControlRoom() {
  const [month, setMonth] = useState('Current month');
  const [office, setOffice] = useState('All franchises');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [notice, setNotice] = useState('');

  const filteredRows = useMemo(
    () => rows.filter((row) => (office === 'All franchises' || row.office === office) && row.office.toLowerCase().includes(query.toLowerCase())),
    [office, query],
  );
  const visibleTotal = filteredRows.reduce((sum, row) => sum + (row.revenue ?? 0), 0);
  const latestRate = filteredRows.length === rows.length ? 966.45 : filteredRows.reduce((sum, row) => sum + (row.dayRate ?? 0), 0) / Math.max(filteredRows.filter((row) => row.dayRate).length, 1);

  const handleRun = () => {
    setRunning(true);
    setNotice('Automation queued — figures will refresh when People Planner completes.');
    window.setTimeout(() => setRunning(false), 2200);
  };

  return (
    <main className="day-rate-mockup min-h-screen p-3 text-[13px] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1480px]">
        <header className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button className="dr-button rounded-lg border border-[var(--dr-line)] bg-[var(--dr-panel)] p-2 text-[var(--dr-ink-soft)] lg:hidden" aria-label="Open navigation"><Menu size={18} /></button>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--dr-ink)] text-[#b9e4d9] shadow-sm"><Home size={19} /></div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[.19em] text-[var(--dr-teal)]">Home Instead · Care Capacity</div>
              <div className="mt-0.5 font-semibold tracking-tight text-[var(--dr-ink)]">Data House <span className="mx-1.5 text-[#a6b9b5]">/</span> Day Rate Tracker</div>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-[11px] text-[var(--dr-ink-soft)] sm:flex"><span className="h-2 w-2 rounded-full bg-[#168c78]" /> Admin view <span className="mx-1 text-[#c0ceca]">•</span> Updated 09:42</div>
        </header>

        <section className="overflow-hidden rounded-2xl border border-[#cbdcd7] bg-[var(--dr-panel)] shadow-[0_12px_34px_rgba(23,54,66,.07)]">
          <div className="border-b border-[var(--dr-line)] bg-[linear-gradient(108deg,#e7f3ef_0%,#f9fbf9_55%,#f8f0e2_100%)] px-4 py-5 sm:px-7 sm:py-6">
            <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
              <div>
                <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.16em] text-[var(--dr-teal)]"><Activity size={15} /> Operational view <span className="rounded-full bg-[#d4ebe4] px-2 py-0.5 text-[10px] tracking-normal text-[#17675f]">LIVE PULSE</span></div>
                <h1 className="max-w-2xl text-2xl font-semibold tracking-[-.04em] text-[var(--dr-ink)] sm:text-4xl">Know where the day rate is moving.</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--dr-ink-soft)]">A clear read on cumulative revenue and day rate across every franchise. Start with the latest day, then inspect the detail.</p>
              </div>
              <button onClick={handleRun} disabled={running} className="dr-button inline-flex w-fit items-center gap-2 rounded-lg bg-[var(--dr-teal)] px-4 py-2.5 font-semibold text-[#f7fbf9] shadow-[0_5px_12px_rgba(8,127,120,.18)] hover:bg-[#066d67] disabled:cursor-wait disabled:opacity-70">
                {running ? <RefreshCw size={16} className="dr-pulse" /> : <Play size={16} fill="currentColor" />} {running ? 'Running automation…' : 'Run automation now'}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--dr-line)] px-4 py-3 sm:px-7">
            {['Closed month', 'Current month', 'Next month'].map((label) => (
              <button key={label} onClick={() => setMonth(label)} className="dr-tab rounded-md px-3 py-2 text-xs font-semibold text-[var(--dr-ink-soft)] hover:bg-[#edf4f1]" data-active={month === label}>{label}{label === 'Closed month' && <span className="ml-1.5 rounded bg-[#e7ece9] px-1.5 py-0.5 text-[10px] font-medium">FINAL</span>}</button>
            ))}
            <div className="ml-auto flex items-center gap-2 text-xs text-[var(--dr-ink-soft)]"><Clock3 size={14} /> Reporting window: 03–12 May 2025</div>
          </div>

          {notice && <div className="flex items-start gap-2 border-b border-[#cfe5df] bg-[#eef8f4] px-4 py-3 text-xs text-[#17675f] sm:px-7"><Check size={15} className="mt-0.5 shrink-0" />{notice}<button onClick={() => setNotice('')} className="ml-auto" aria-label="Dismiss notification"><X size={14} /></button></div>}

          <div className="grid grid-cols-1 gap-px bg-[var(--dr-line)] lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
            <div className="bg-[var(--dr-panel)] p-5 sm:p-6"><div className="mb-3 text-[11px] font-bold uppercase tracking-[.16em] text-[var(--dr-ink-soft)]">Latest day · 12 May</div><div className="dr-mono text-3xl font-bold tracking-[-.06em] text-[var(--dr-ink)]">{formatRevenue(visibleTotal)}</div><div className="mt-2 text-xs text-[var(--dr-ink-soft)]">Group total revenue <span className="ml-1 font-semibold text-[#087f78]">+3.4% vs 11 May</span></div></div>
            <div className="bg-[var(--dr-panel)] p-5 sm:p-6"><div className="mb-3 text-[11px] font-bold uppercase tracking-[.16em] text-[var(--dr-ink-soft)]">Group day rate</div><div className="dr-mono text-3xl font-bold tracking-[-.06em] text-[var(--dr-ink)]">{precise.format(latestRate)}</div><div className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#087f78]"><ArrowUpRight size={14} /> +2.6% on yesterday</div></div>
            <div className="bg-[var(--dr-panel)] p-5 sm:p-6"><div className="mb-3 text-[11px] font-bold uppercase tracking-[.16em] text-[var(--dr-ink-soft)]">Franchises tracked</div><div className="dr-mono text-3xl font-bold tracking-[-.06em] text-[var(--dr-ink)]">{filteredRows.length}<span className="ml-1 text-lg font-normal text-[#8aa09a]">/ 6</span></div><div className="mt-2 text-xs text-[var(--dr-ink-soft)]">5 reporting · 1 awaiting data</div></div>
            <div className="bg-[var(--dr-panel)] p-5 sm:p-6"><div className="mb-3 text-[11px] font-bold uppercase tracking-[.16em] text-[var(--dr-ink-soft)]">Automation status</div><div className="flex items-center gap-2 text-lg font-semibold text-[#17675f]"><span className="h-2.5 w-2.5 rounded-full bg-[#168c78]" /> Healthy</div><div className="mt-2 text-xs text-[var(--dr-ink-soft)]">Last run 12 May · 09:40 · 6/6 succeeded</div></div>
          </div>

          <div className="flex flex-col gap-3 border-b border-[var(--dr-line)] px-4 py-4 sm:px-7 md:flex-row md:items-center">
            <div className="relative min-w-0 flex-1 md:max-w-xs"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8aa09a]" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search franchises…" className="dr-select h-9 w-full rounded-md border border-[var(--dr-line)] bg-[#f7faf8] pl-9 pr-3 text-xs text-[var(--dr-ink)] placeholder:text-[#91a39f]" /></div>
            <button onClick={() => setShowFilters((value) => !value)} className={`dr-button inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-xs font-semibold ${showFilters ? 'border-[#8cc8bc] bg-[#e8f5f0] text-[#17675f]' : 'border-[var(--dr-line)] bg-[var(--dr-panel)] text-[var(--dr-ink-soft)]'}`}><SlidersHorizontal size={14} /> Filters <ChevronDown size={13} /></button>
            <div className="ml-auto hidden items-center gap-2 sm:flex"><button className="dr-button inline-flex items-center gap-2 rounded-md border border-[var(--dr-line)] px-3 py-2 text-xs font-semibold text-[var(--dr-ink-soft)] hover:bg-[#f0f7f4]"><Download size={14} /> Export view</button><span className="mx-1 h-5 w-px bg-[var(--dr-line)]" /><span className="text-[11px] text-[#7d938e]">Day rate trend</span><TrendMark trend="up" /><TrendMark trend="down" /></div>
          </div>
          {showFilters && <div className="flex flex-wrap items-center gap-2 border-b border-[var(--dr-line)] bg-[#f6faf8] px-4 py-3 sm:px-7"><Filter size={14} className="text-[var(--dr-teal)]" /><span className="text-xs font-semibold text-[var(--dr-ink-soft)]">View franchise:</span>{['All franchises', ...rows.map((row) => row.office)].map((name) => <button key={name} onClick={() => setOffice(name)} className={`rounded-full border px-3 py-1.5 text-[11px] ${office === name ? 'border-[#8cc8bc] bg-[#e1f2ed] font-semibold text-[#17675f]' : 'border-[var(--dr-line)] bg-[var(--dr-panel)] text-[var(--dr-ink-soft)]'}`}>{name}</button>)}</div>}

          <div className="dr-scrollbar overflow-x-auto">
            <table className="w-full min-w-[910px] border-collapse text-xs">
              <thead><tr className="border-b border-[var(--dr-line)] bg-[#f6f9f7] text-left text-[10px] font-bold uppercase tracking-[.12em] text-[#718984]"><th className="sticky left-0 z-10 min-w-[220px] bg-[#f6f9f7] px-4 py-3 sm:px-7">Office / franchise</th>{days.map((day, i) => <th key={day} colSpan={2} className={`min-w-[106px] border-l border-[#e1e9e6] px-3 py-3 text-center ${i === days.length - 1 ? 'bg-[#e8f4ef] text-[#17675f]' : ''}`}><div className="dr-mono text-[12px] text-[var(--dr-ink)]">{day}</div><div className="mt-1 font-normal tracking-normal">May · {i === days.length - 1 ? 'latest' : 'day'}</div></th>)}</tr><tr className="border-b border-[var(--dr-line)] bg-[#fbfcfa] text-[10px] text-[#849793]"><th className="sticky left-0 z-10 bg-[#fbfcfa] px-4 py-2 text-left font-medium sm:px-7">Daily detail</th>{days.map((day, i) => <Fragment key={day}><th className={`border-l border-[#e1e9e6] px-2 py-2 text-right font-medium ${i === days.length - 1 ? 'bg-[#f0f8f4]' : ''}`}>Revenue</th><th className={`px-2 py-2 text-right font-medium ${i === days.length - 1 ? 'bg-[#f0f8f4]' : ''}`}>Rate</th></Fragment>)}</tr></thead>
              <tbody>
                 {filteredRows.map((row) => <tr key={row.office} className="dr-row border-b border-[#e4ece9]">
                  <td className="sticky left-0 z-10 bg-[var(--dr-panel)] px-4 py-3 sm:px-7"><button onClick={() => setExpanded(expanded === row.office ? null : row.office)} className="flex items-center gap-2 text-left"><span className="text-[var(--dr-teal)]">{expanded === row.office ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span><span><span className="block font-semibold text-[var(--dr-ink)]">{row.office}{row.lic && <span className="ml-2 rounded bg-[#f6ebd7] px-1.5 py-0.5 text-[9px] font-bold text-[#967034]">LIC</span>}</span><span className="mt-0.5 block text-[10px] text-[#8a9d98]">{row.region}</span></span></button></td>
                   {row.values.map((value, index) => <Fragment key={`${row.office}-${index}`}><td className={`border-l border-[#e8efec] px-2 py-3 text-right dr-mono text-[10px] text-[#617a74] ${index === days.length - 1 ? 'bg-[#f0f8f4]' : ''}`}>{value === null ? '—' : formatRevenue(value * 16)}</td><td className={`px-2 py-3 text-right dr-mono text-[11px] font-bold ${index === days.length - 1 ? 'bg-[#e8f4ef]' : ''} ${value === null ? 'text-[#a5b3af]' : row.trend === 'up' ? 'text-[#087f78]' : row.trend === 'down' ? 'text-[#bc5d4f]' : 'text-[#b17c35]'}`}>{value === null ? '—' : precise.format(value)}{index === days.length - 1 && value !== null && <span className="ml-1 inline-block align-middle">{row.trend === 'up' ? <ArrowUpRight size={12} /> : row.trend === 'down' ? <ArrowDownRight size={12} /> : null}</span>}</td></Fragment>)}
                </tr>)}
                 <tr className="border-t-2 border-[#bdd5ce] bg-[#edf6f2] font-bold"><td className="sticky left-0 z-10 bg-[#edf6f2] px-4 py-3 text-[var(--dr-ink)] sm:px-7">Group total <span className="ml-1 text-[10px] font-normal text-[#6e8982]">latest day</span></td>{days.map((day, i) => <Fragment key={day}><td className="border-l border-[#d8e8e2] px-2 py-3 text-right dr-mono text-[10px] text-[#55736c]">{formatRevenue(visibleTotal * (0.78 + i * .025))}</td><td className="px-2 py-3 text-right dr-mono text-[11px] text-[#087f78]">{precise.format(latestRate * (0.96 + i * .004))}</td></Fragment>)}</tr>
              </tbody>
            </table>
          </div>
          <footer className="flex flex-col gap-2 border-t border-[var(--dr-line)] bg-[#f8faf8] px-4 py-3 text-[11px] text-[#748984] sm:flex-row sm:items-center sm:justify-between sm:px-7"><span><CircleAlert size={13} className="mr-1 inline text-[#b17c35]" /> Figures come from the People Planner Financial Summary.</span><span>Showing {filteredRows.length} of 6 franchises · {month}</span></footer>
        </section>
      </div>
    </main>
  );
}