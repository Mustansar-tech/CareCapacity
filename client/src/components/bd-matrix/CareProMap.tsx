import { useState, useMemo, useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, Tooltip, GeoJSON, useMap } from "react-leaflet";
import type { FeatureCollection } from "geojson";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RefreshCw, ZoomIn, ZoomOut, Eye, EyeOff,
  Map as MapIcon, Search, X, ChevronLeft, ChevronRight,
} from "lucide-react";
import type { EmployeeLocation, ClientLocation } from "@shared/schema";
import { normalizeGender } from "@/utils/bd-matrix-utils";
import { getRealFranchiseName } from "@/data/franchise-real-names";

export type FranchiseBranch = { id: string; name: string; displayName: string };

// ── One distinct colour per branch slug ──────────────────────────────────────
const BRANCH_COLORS: Record<string, string> = {
  'aberdeen':          '#ef4444',  // red
  'south-ayrshire':    '#f97316',  // orange
  'east-lothian':      '#eab308',  // amber-yellow
  'glasgow-north':     '#22c55e',  // green
  'glasgow-south':     '#14b8a6',  // teal
  'north-lanarkshire': '#3b82f6',  // blue
  'perthshire':        '#8b5cf6',  // violet
  'scottish-borders':  '#ec4899',  // pink
  'stirling-falkirk':  '#f59e0b',  // amber-orange
  'west-fife-kinross': '#06b6d4',  // cyan
};
const DEFAULT_COLOR = '#6366f1';

function branchColor(slug: string) {
  return BRANCH_COLORS[slug] ?? DEFAULT_COLOR;
}

// ── Map pin icons ────────────────────────────────────────────────────────────
function makeCarePinIcon(gender: string, franchiseColor?: string) {
  const g = normalizeGender(gender);
  // Inner dot colour encodes gender; outer pin uses franchise colour when known
  const pinColor  = franchiseColor ?? (g === 'female' ? '#ec4899' : g === 'male' ? '#3b82f6' : '#9ca3af');
  const dotColor  = g === 'female' ? '#ec4899' : g === 'male' ? '#3b82f6' : '#9ca3af';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="38" viewBox="0 0 30 38">
    <path d="M15 0C6.716 0 0 6.716 0 15c0 9.375 15 23 15 23S30 24.375 30 15C30 6.716 23.284 0 15 0z"
          fill="${pinColor}" stroke="white" stroke-width="2"/>
    <circle cx="15" cy="15" r="6" fill="white" opacity="0.9"/>
    <circle cx="15" cy="15" r="3.5" fill="${dotColor}"/>
  </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [30, 38], iconAnchor: [15, 38], popupAnchor: [0, -38] });
}

function makeClientIcon(franchiseColor?: string) {
  const color = franchiseColor ?? '#1f2937';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="34" viewBox="0 0 26 34">
    <path d="M13 0C5.82 0 0 5.82 0 13c0 8.125 13 21 13 21S26 21.125 26 13C26 5.82 20.18 0 13 0z"
          fill="${color}" stroke="white" stroke-width="2"/>
    <rect x="7" y="9" width="12" height="9" rx="1.5" fill="white" opacity="0.9"/>
    <rect x="10" y="12" width="6" height="1.5" rx="0.75" fill="${color}"/>
    <rect x="10" y="14.5" width="4" height="1.5" rx="0.75" fill="${color}"/>
  </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [26, 34], iconAnchor: [13, 34], popupAnchor: [0, -34] });
}

const searchPinIcon = L.divIcon({
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="46" viewBox="0 0 36 46">
    <path d="M18 0C8.059 0 0 8.059 0 18c0 11.25 18 28 18 28S36 29.25 36 18C36 8.059 27.941 0 18 0z"
          fill="#eab308" stroke="white" stroke-width="2.5"/>
    <circle cx="18" cy="18" r="8" fill="white" opacity="0.95"/>
    <circle cx="18" cy="18" r="5" fill="#eab308"/>
  </svg>`,
  className: '', iconSize: [36, 46], iconAnchor: [18, 46], popupAnchor: [0, -46],
});

// ── Tiny in-map helpers ──────────────────────────────────────────────────────
type SearchResult = { lat: number; lng: number; postcode: string };

function SearchFlyTo({ result }: { result: SearchResult | null }) {
  const map = useMap();
  useEffect(() => {
    if (result) map.flyTo([result.lat, result.lng], 14, { animate: true, duration: 1.2 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.lat, result?.lng]);
  return null;
}

function ZoomControls() {
  const map = useMap();
  return (
    <div className="absolute bottom-6 right-5 z-[1000] flex flex-col gap-1.5">
      <button
        onClick={() => map.zoomIn()}
        className="w-9 h-9 bg-white hover:bg-gray-50 rounded-xl shadow-lg border border-gray-200 flex items-center justify-center transition-all"
        title="Zoom in"
      >
        <ZoomIn className="w-4 h-4 text-gray-600" />
      </button>
      <button
        onClick={() => map.zoomOut()}
        className="w-9 h-9 bg-white hover:bg-gray-50 rounded-xl shadow-lg border border-gray-200 flex items-center justify-center transition-all"
        title="Zoom out"
      >
        <ZoomOut className="w-4 h-4 text-gray-600" />
      </button>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
type MapLayer = 'both' | 'carePros' | 'clients';

export function CareProMap({
  locations,
  clients,
  onRefresh,
  isRefreshing,
  branches,
  selectedBranchId,
}: {
  locations: EmployeeLocation[];
  clients: ClientLocation[];
  onRefresh?: () => void;
  isRefreshing?: boolean;
  /**
   * All franchises the user has access to — used to draw territory borders for
   * every franchise simultaneously (with unique colours). Requires `locations`
   * and `clients` to carry a `branchId` field (the multi-branch endpoint
   * returns these).
   */
  branches?: FranchiseBranch[];
  /**
   * The franchise whose Care Pros & Clients are shown as map markers.
   * Borders for every franchise are always drawn; only this franchise's pins
   * are rendered. Defaults to showing all accessible franchises' pins when
   * omitted (backward compatible).
   */
  selectedBranchId?: string | null;
}) {
  const [showPostcodes, setShowPostcodes] = useState(false);
  const [layer, setLayer]               = useState<MapLayer>('both');
  const [legendOpen, setLegendOpen]     = useState(true);
  const multiFranchise = !!branches && branches.length > 0;

  // ── Territory GeoJSON ──
  const [territories, setTerritories] = useState<FeatureCollection | null>(null);
  useEffect(() => {
    if (!multiFranchise) return;
    let cancelled = false;
    fetch('/data/franchise-territories.geo.json')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setTerritories(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [multiFranchise]);

  // Only show territories for branches the caller has access to
  const accessibleSlugs = useMemo(() => new Set((branches ?? []).map(b => b.name)), [branches]);
  const visibleTerritories = useMemo<FeatureCollection | null>(() => {
    if (!territories || !branches) return null;
    return {
      ...territories,
      features: territories.features.filter(f => accessibleSlugs.has((f.properties as any)?.branch)),
    };
  }, [territories, branches, accessibleSlugs]);

  // Selected branch slug (for territory highlight + colour lookup)
  const selectedSlug = useMemo(() => {
    if (!selectedBranchId || !branches) return null;
    return branches.find(b => b.id === selectedBranchId)?.name ?? null;
  }, [selectedBranchId, branches]);

  const selectedColor = selectedSlug ? branchColor(selectedSlug) : DEFAULT_COLOR;

  // ── Marker filtering ──
  const validEmployees = useMemo(() =>
    locations.filter(l => l.homeLat && l.homeLng &&
      (!selectedBranchId || (l as any).branchId === selectedBranchId)),
  [locations, selectedBranchId]);

  const validClients = useMemo(() =>
    clients.filter(c => c.lat && c.lng &&
      (!selectedBranchId || (c as any).branchId === selectedBranchId)),
  [clients, selectedBranchId]);

  // ── Jitter overlapping pins ──
  function applyJitter<T>(items: T[], getLat: (i: T) => number, getLng: (i: T) => number) {
    const JITTER = 0.0003;
    const key    = (i: T) => `${getLat(i).toFixed(6)},${getLng(i).toFixed(6)}`;
    const groups = new Map<string, T[]>();
    for (const item of items) {
      const k = key(item);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(item);
    }
    return items.map(item => {
      const group = groups.get(key(item))!;
      const idx   = group.indexOf(item);
      const angle = (2 * Math.PI * idx) / group.length;
      const baseLat = getLat(item), baseLng = getLng(item);
      return {
        ...item,
        _jLat: group.length === 1 ? baseLat : baseLat + JITTER * Math.cos(angle),
        _jLng: group.length === 1 ? baseLng : baseLng + JITTER * Math.sin(angle),
      };
    });
  }

  const jitteredEmployees = useMemo(
    () => applyJitter(validEmployees, e => parseFloat(e.homeLat!), e => parseFloat(e.homeLng!)),
    [validEmployees],
  );
  const jitteredClients = useMemo(
    () => applyJitter(validClients, c => parseFloat(c.lat!), c => parseFloat(c.lng!)),
    [validClients],
  );

  const femaleCount = useMemo(() => validEmployees.filter(l => normalizeGender(l.gender) === 'female').length, [validEmployees]);
  const maleCount   = useMemo(() => validEmployees.filter(l => normalizeGender(l.gender) === 'male').length, [validEmployees]);

  // ── Map centre: bias to selected branch data ──
  const center = useMemo<[number, number]>(() => {
    const lats: number[] = [], lngs: number[] = [];
    if (layer !== 'clients')  validEmployees.forEach(e => { lats.push(parseFloat(e.homeLat!)); lngs.push(parseFloat(e.homeLng!)); });
    if (layer !== 'carePros') validClients.forEach(c => { lats.push(parseFloat(c.lat!)); lngs.push(parseFloat(c.lng!)); });
    // Fallback: Scotland centre
    if (lats.length === 0) return [56.5, -4.0];
    return [lats.reduce((s, v) => s + v, 0) / lats.length, lngs.reduce((s, v) => s + v, 0) / lngs.length];
  }, [validEmployees, validClients, layer]);

  // ── Postcode search ──
  const [searchOpen,   setSearchOpen]   = useState(false);
  const [searchInput,  setSearchInput]  = useState('');
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searchError,  setSearchError]  = useState('');
  const [isSearching,  setIsSearching]  = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [searchOpen]);

  async function handleSearch() {
    const pc = searchInput.trim().toUpperCase().replace(/\s+/g, '');
    if (!pc) return;
    setIsSearching(true); setSearchError('');
    try {
      const res  = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
      const data = await res.json();
      if (res.ok && data.status === 200 && data.result?.latitude != null) {
        setSearchResult({ lat: data.result.latitude, lng: data.result.longitude, postcode: data.result.postcode });
        setSearchError('');
      } else {
        setSearchError(`"${searchInput.trim().toUpperCase()}" not found`);
        setSearchResult(null);
      }
    } catch {
      setSearchError(`"${searchInput.trim().toUpperCase()}" not found`);
      setSearchResult(null);
    } finally {
      setIsSearching(false);
    }
  }

  function clearSearch() {
    setSearchInput(''); setSearchResult(null); setSearchError(''); setSearchOpen(false);
  }

  // ── "No data" state (still show map with territory borders if possible) ──
  const hasMarkers = validEmployees.length > 0 || validClients.length > 0;
  const hasAnything = hasMarkers || !!visibleTerritories;

  if (!hasAnything) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50">
        <MapIcon className="w-16 h-16 text-gray-200 mb-4" />
        <h4 className="text-xl font-bold text-gray-400">No Location Data</h4>
        <p className="text-sm text-gray-400 mt-1">Ensure postcodes are uploaded and geocoded</p>
        {onRefresh && (
          <Button onClick={onRefresh} disabled={isRefreshing} variant="outline" className="mt-4 gap-2 rounded-xl">
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        )}
      </div>
    );
  }

  const showCPs     = layer === 'both' || layer === 'carePros';
  const showClients = layer === 'both' || layer === 'clients';

  return (
    <div className="absolute inset-0">
      {/* ─── Map ─────────────────────────────────────────────────────────── */}
      <MapContainer
        center={center}
        zoom={hasMarkers ? 10 : 7}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
        zoomControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        <SearchFlyTo result={searchResult} />

        {/* Territory borders — all franchises, unique colours, selected highlighted */}
        {visibleTerritories && (
          <GeoJSON
            key="territories"
            data={visibleTerritories as any}
            style={(feature: any) => {
              const slug     = feature?.properties?.branch as string;
              const color    = branchColor(slug);
              const isSel    = !selectedSlug || slug === selectedSlug;
              return {
                color,
                weight:      isSel ? 3 : 1.5,
                opacity:     isSel ? 1  : 0.55,
                fillColor:   color,
                fillOpacity: isSel ? 0.12 : 0.03,
                dashArray:   isSel ? undefined : '6 4',
              };
            }}
            onEachFeature={(feature: any, lyr: any) => {
              const realName = feature?.properties?.realName ?? feature?.properties?.branch;
              lyr.bindTooltip(`<strong>${realName}</strong>`, {
                sticky: true,
                className: 'leaflet-franchise-tip',
              });
            }}
          />
        )}

        {/* Care Pro pins */}
        {showCPs && jitteredEmployees.map(loc => (
          <Marker
            key={`cp-${loc.id}`}
            position={[loc._jLat, loc._jLng]}
            icon={makeCarePinIcon(loc.gender || '', selectedColor)}
          >
            {showPostcodes && (
              <Tooltip permanent direction="right" offset={[14, -18]} className="!bg-white/90 !border-0 !shadow-md !font-bold !text-[10px] !px-2 !py-0.5 !rounded-md">
                {loc.homePostcode}
              </Tooltip>
            )}
            <Popup>
              <div className="min-w-[160px] text-xs">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: selectedColor }} />
                  <span className="font-black uppercase tracking-widest text-[10px]" style={{ color: selectedColor }}>Care Pro</span>
                </div>
                <p className="text-sm font-bold text-gray-800 leading-tight">{loc.employeeName}</p>
                <p className="font-bold text-gray-400 uppercase mt-0.5">{loc.homePostcode}</p>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {normalizeGender(loc.gender) && (
                    <span className={`font-semibold capitalize ${normalizeGender(loc.gender) === 'female' ? 'text-pink-500' : 'text-blue-500'}`}>
                      {normalizeGender(loc.gender)}
                    </span>
                  )}
                  {loc.transportMode && <span className="text-gray-400">· {loc.transportMode}</span>}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Client pins */}
        {showClients && jitteredClients.map(loc => (
          <Marker
            key={`cl-${loc.id}`}
            position={[loc._jLat, loc._jLng]}
            icon={makeClientIcon(selectedColor)}
          >
            {showPostcodes && (
              <Tooltip permanent direction="right" offset={[12, -16]} className="!bg-white/90 !border-0 !shadow-md !font-bold !text-[10px] !px-2 !py-0.5 !rounded-md">
                {loc.postcode}
              </Tooltip>
            )}
            <Popup>
              <div className="min-w-[160px] text-xs">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: selectedColor }} />
                  <span className="font-black uppercase tracking-widest text-[10px]" style={{ color: selectedColor }}>Client</span>
                </div>
                <p className="text-sm font-bold text-gray-800 leading-tight">{loc.clientName}</p>
                <p className="font-bold text-gray-400 uppercase mt-0.5">{loc.postcode}</p>
                {loc.addressLine && <p className="text-gray-500 mt-0.5">{loc.addressLine}</p>}
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Search pin */}
        {searchResult && (
          <Marker position={[searchResult.lat, searchResult.lng]} icon={searchPinIcon}>
            <Popup>
              <div className="min-w-[140px] text-xs">
                <div className="flex items-center gap-1.5 mb-1"><div className="w-2 h-2 rounded-full bg-yellow-400" /><span className="font-black uppercase tracking-widest text-[10px] text-yellow-600">Searched Postcode</span></div>
                <p className="text-sm font-bold text-gray-800">{searchResult.postcode}</p>
                <p className="text-gray-400 mt-0.5">{searchResult.lat.toFixed(5)}, {searchResult.lng.toFixed(5)}</p>
              </div>
            </Popup>
          </Marker>
        )}

        <ZoomControls />
      </MapContainer>

      {/* ─── Territory legend (left side, below header) ──────────────────── */}
      {multiFranchise && (
        <div className="absolute left-4 z-[1000]" style={{ top: '104px' }}>
          <div className="flex items-start gap-0">
            {/* Panel */}
            <div className={`bg-white/97 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-100 transition-all duration-200 overflow-hidden ${legendOpen ? 'w-52 opacity-100' : 'w-0 opacity-0 pointer-events-none'}`}>
              <div className="p-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2 px-0.5">All Territories</p>
                <div className="flex flex-col gap-0.5 max-h-[52vh] overflow-y-auto pr-0.5">
                  {branches!.map(b => {
                    const slug    = b.name;
                    const color   = branchColor(slug);
                    const isActive = slug === selectedSlug;
                    const realName = getRealFranchiseName(slug, b.displayName);
                    return (
                      <div
                        key={b.id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${isActive ? 'bg-gray-50' : ''}`}
                      >
                        {/* Colour swatch */}
                        <div className="shrink-0 flex items-center gap-1">
                          <div
                            className="w-3 h-3 rounded-sm shrink-0 ring-1 ring-inset ring-white/50"
                            style={{ background: color, opacity: isActive ? 1 : 0.55 }}
                          />
                        </div>
                        <span className={`text-xs leading-tight truncate ${isActive ? 'font-bold text-gray-900' : 'font-medium text-gray-500'}`}>
                          {realName}
                        </span>
                        {isActive && (
                          <span className="ml-auto shrink-0 w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* Mini stats for the active branch */}
                {hasMarkers && (
                  <div className="mt-2 pt-2 border-t border-gray-100 flex gap-3 px-0.5">
                    {showCPs && (
                      <div className="text-center">
                        <p className="text-sm font-black" style={{ color: selectedColor }}>{validEmployees.length}</p>
                        <p className="text-[9px] uppercase tracking-widest text-gray-400 font-bold">Care Pros</p>
                      </div>
                    )}
                    {showClients && (
                      <div className="text-center">
                        <p className="text-sm font-black text-gray-800">{validClients.length}</p>
                        <p className="text-[9px] uppercase tracking-widest text-gray-400 font-bold">Clients</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            {/* Toggle tab */}
            <button
              onClick={() => setLegendOpen(o => !o)}
              className="mt-2 ml-1 w-6 h-10 bg-white/97 backdrop-blur-sm rounded-r-xl shadow-lg border border-l-0 border-gray-100 flex items-center justify-center hover:bg-gray-50 transition-colors"
              title={legendOpen ? 'Hide legend' : 'Show territories'}
            >
              {legendOpen ? <ChevronLeft className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
            </button>
          </div>
        </div>
      )}

      {/* ─── Bottom toolbar ──────────────────────────────────────────────── */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center gap-2">
        {/* Error / result badge */}
        {searchError && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-xs font-semibold px-3 py-1.5 rounded-full shadow-sm">
            {searchError}
          </div>
        )}
        {searchResult && !searchError && (
          <div className="bg-white border border-yellow-300 text-yellow-700 text-xs font-bold px-3 py-1.5 rounded-full shadow-sm flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-yellow-400" />
            {searchResult.postcode}
            <button onClick={clearSearch} className="ml-1 text-gray-300 hover:text-gray-500">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        <div className="flex gap-2 items-center">
          {/* Layer toggle */}
          <div className="flex items-center bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
            {(['carePros', 'both', 'clients'] as MapLayer[]).map((l, i) => {
              const labels: Record<MapLayer, string> = { carePros: 'Care Pros', both: 'Both', clients: 'Clients' };
              const active = layer === l;
              return (
                <button key={l} onClick={() => setLayer(l)}
                  className={`px-4 h-9 text-xs font-bold transition-colors ${i !== 0 ? 'border-l border-gray-200' : ''} ${active
                    ? l === 'carePros'
                      ? 'text-white'
                      : l === 'clients'
                        ? 'bg-teal-600 text-white'
                        : 'bg-gray-800 text-white'
                    : 'text-gray-500 hover:bg-gray-50'}`}
                  style={active && l === 'carePros' ? { background: selectedColor } : undefined}
                >
                  {labels[l]}
                </button>
              );
            })}
          </div>

          {/* Postcodes toggle */}
          <button
            onClick={() => setShowPostcodes(!showPostcodes)}
            title={showPostcodes ? 'Hide postcodes' : 'Show postcodes'}
            className={`w-9 h-9 rounded-xl shadow-lg border flex items-center justify-center transition-all ${showPostcodes ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200 hover:bg-gray-50'}`}
          >
            {showPostcodes
              ? <Eye className="w-4 h-4 text-blue-600" />
              : <EyeOff className="w-4 h-4 text-gray-400" />}
          </button>

          {/* Refresh */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Refresh data"
              className="w-9 h-9 rounded-xl shadow-lg border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-center transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 text-gray-500 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          )}

          {/* Search */}
          {!searchOpen ? (
            <button
              onClick={() => setSearchOpen(true)}
              title="Search postcode"
              className="w-9 h-9 rounded-xl shadow-lg border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-center transition-all"
            >
              <Search className="w-4 h-4 text-yellow-500" />
            </button>
          ) : (
            <div className="flex items-center gap-1.5 bg-white rounded-xl shadow-lg border border-gray-200 px-3 h-9">
              <Search className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
              <Input
                ref={inputRef}
                value={searchInput}
                onChange={e => { setSearchInput(e.target.value); setSearchError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') handleSearch(); if (e.key === 'Escape') clearSearch(); }}
                placeholder="Postcode…"
                className="border-0 shadow-none bg-transparent h-6 w-28 text-sm font-medium p-0 focus-visible:ring-0 placeholder:text-gray-300"
              />
              <button
                onClick={handleSearch}
                disabled={!searchInput.trim() || isSearching}
                className="h-6 px-2.5 text-xs font-bold bg-yellow-400 hover:bg-yellow-500 text-gray-900 rounded-lg disabled:opacity-50 transition-colors"
              >
                {isSearching ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Go'}
              </button>
              <button onClick={clearSearch} className="text-gray-300 hover:text-gray-500 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ─── Bottom-left marker legend ───────────────────────────────────── */}
      {hasMarkers && (
        <div className="absolute bottom-5 left-4 z-[1000] bg-white/97 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-100 px-4 py-3 flex flex-col gap-1.5 min-w-[150px]">
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100 pb-1.5 mb-0.5">Markers</p>
          {showCPs && (
            <>
              <div className="flex items-center gap-2">
                <svg width="12" height="15" viewBox="0 0 30 38">
                  <path d="M15 0C6.716 0 0 6.716 0 15c0 9.375 15 23 15 23S30 24.375 30 15C30 6.716 23.284 0 15 0z"
                    fill={selectedColor} stroke="white" strokeWidth="2"/>
                  <circle cx="15" cy="15" r="5" fill="white" opacity="0.9"/>
                  <circle cx="15" cy="15" r="3" fill="#ec4899"/>
                </svg>
                <span className="text-xs font-semibold text-gray-600">Female <span className="text-pink-500 font-bold">({femaleCount})</span></span>
              </div>
              <div className="flex items-center gap-2">
                <svg width="12" height="15" viewBox="0 0 30 38">
                  <path d="M15 0C6.716 0 0 6.716 0 15c0 9.375 15 23 15 23S30 24.375 30 15C30 6.716 23.284 0 15 0z"
                    fill={selectedColor} stroke="white" strokeWidth="2"/>
                  <circle cx="15" cy="15" r="5" fill="white" opacity="0.9"/>
                  <circle cx="15" cy="15" r="3" fill="#3b82f6"/>
                </svg>
                <span className="text-xs font-semibold text-gray-600">Male <span className="text-blue-500 font-bold">({maleCount})</span></span>
              </div>
            </>
          )}
          {showClients && (
            <div className="flex items-center gap-2">
              <svg width="10" height="13" viewBox="0 0 26 34">
                <path d="M13 0C5.82 0 0 5.82 0 13c0 8.125 13 21 13 21S26 21.125 26 13C26 5.82 20.18 0 13 0z"
                  fill={selectedColor} stroke="white" strokeWidth="2"/>
              </svg>
              <span className="text-xs font-semibold text-gray-600">Clients <span className="font-bold text-gray-800">({validClients.length})</span></span>
            </div>
          )}
          {searchResult && (
            <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-400 shrink-0" />
              <span className="text-xs font-semibold text-gray-600">{searchResult.postcode}</span>
            </div>
          )}
        </div>
      )}

      {/* Tooltip style override — Leaflet's tooltip can't take Tailwind directly */}
      <style>{`
        .leaflet-franchise-tip {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.10);
          padding: 4px 10px;
          font-size: 12px;
          color: #374151;
        }
        .leaflet-franchise-tip::before { display: none; }
      `}</style>
    </div>
  );
}
