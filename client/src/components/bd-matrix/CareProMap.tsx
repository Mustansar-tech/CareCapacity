import { useState, useMemo, useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMap, useMapEvents, GeoJSON } from "react-leaflet";
import type { FeatureCollection } from "geojson";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, ZoomIn, ZoomOut, Eye, EyeOff, Map as MapIcon, Search, X } from "lucide-react";
import type { EmployeeLocation, ClientLocation } from "@shared/schema";
import { normalizeGender } from "@/utils/bd-matrix-utils";

function makeIcon(gender: string) {
  const g = normalizeGender(gender);
  const color = g === 'female' ? '#ec4899' : g === 'male' ? '#3b82f6' : '#9ca3af';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="28" viewBox="0 0 32 40">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 24 16 24S32 26 32 16C32 7.163 24.837 0 16 0z" fill="${color}" stroke="white" stroke-width="2"/>
    <circle cx="16" cy="16" r="7" fill="white" opacity="0.9"/>
    <circle cx="16" cy="16" r="4" fill="${color}"/>
  </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [22, 28], iconAnchor: [11, 28], popupAnchor: [0, -28] });
}

function makeClientIcon() {
  const color = '#1f2937';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="28" viewBox="0 0 32 40">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 24 16 24S32 26 32 16C32 7.163 24.837 0 16 0z" fill="${color}" stroke="white" stroke-width="2"/>
    <circle cx="16" cy="16" r="7" fill="white" opacity="0.9"/>
    <circle cx="16" cy="16" r="4" fill="${color}"/>
  </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [22, 28], iconAnchor: [11, 28], popupAnchor: [0, -28] });
}

// Yellow search pin — memoised so the icon object is stable
const searchPinIcon = L.divIcon({
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="46" viewBox="0 0 36 46">
    <path d="M18 0C8.059 0 0 8.059 0 18c0 11.25 18 28 18 28S36 29.25 36 18C36 8.059 27.941 0 18 0z" fill="#eab308" stroke="white" stroke-width="2.5"/>
    <circle cx="18" cy="18" r="8" fill="white" opacity="0.95"/>
    <circle cx="18" cy="18" r="5" fill="#eab308"/>
  </svg>`,
  className: '',
  iconSize: [36, 46],
  iconAnchor: [18, 46],
  popupAnchor: [0, -46],
});

type SearchResult = { lat: number; lng: number; postcode: string };

/** Lives inside MapContainer — flies to result whenever lat/lng change */
function SearchFlyTo({ result }: { result: SearchResult | null }) {
  const map = useMap();
  useEffect(() => {
    if (result) {
      map.flyTo([result.lat, result.lng], 14, { animate: true, duration: 1.2 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.lat, result?.lng]);
  return null;
}

function ZoomControls() {
  const map = useMap();
  return (
    <div className="absolute bottom-6 right-6 z-[1000] flex flex-col gap-2">
      <Button onClick={() => map.zoomIn()} className="bg-white/95 hover:bg-white text-gray-900 font-bold shadow-2xl border-none rounded-xl h-10 w-10 p-0" title="Zoom in">
        <ZoomIn className="w-5 h-5 text-blue-600" />
      </Button>
      <Button onClick={() => map.zoomOut()} className="bg-white/95 hover:bg-white text-gray-900 font-bold shadow-2xl border-none rounded-xl h-10 w-10 p-0" title="Zoom out">
        <ZoomOut className="w-5 h-5 text-purple-600" />
      </Button>
    </div>
  );
}

// Area-weighted centroid of a polygon ring ([lng, lat][]) — good enough for label placement
function ringCentroid(ring: number[][]): [number, number] {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-12) return [ring[0][0], ring[0][1]];
  return [cx / (3 * a), cy / (3 * a)];
}

function ringArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(a / 2);
}

/** Always-on territory name labels at each territory's centre.
 *  Solid black text; auto-hidden when zoomed far out to stay clean. */
function TerritoryLabels({ territories }: { territories: FeatureCollection | null }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  const labels = useMemo(() => {
    if (!territories) return [];
    return territories.features
      .map((f) => {
        const name = f.properties?.realName as string | undefined;
        if (!name || !f.geometry) return null;
        // Use the largest outer ring (island territories are MultiPolygons)
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates]
          : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
        if (!polys.length) return null;
        const largest = polys.reduce((best, p) => (ringArea(p[0]) > ringArea(best[0]) ? p : best));
        const [lng, lat] = ringCentroid(largest[0]);
        return { key: f.properties?.branch as string, name, lat, lng };
      })
      .filter((x): x is { key: string; name: string; lat: number; lng: number } => !!x);
  }, [territories]);

  if (zoom < 8) return null; // auto-hide at far zoom
  return (
    <>
      {labels.map((l) => (
        <Marker
          key={`tlabel-${l.key}`}
          position={[l.lat, l.lng]}
          interactive={false}
          icon={L.divIcon({
            className: '',
            html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;font-weight:800;font-size:${zoom >= 10 ? 13 : 11}px;color:#000;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff,0 0 3px #fff;pointer-events:none;">${l.name}</div>`,
            iconSize: [0, 0],
          })}
        />
      ))}
    </>
  );
}

type MapLayer = 'both' | 'carePros' | 'clients';

// Distinct dot colors for the franchise picker rows (cycled by index)
const FRANCHISE_DOT_COLORS = [
  '#dc2626', '#0d9488', '#166534', '#db2777', '#a16207',
  '#2563eb', '#15803d', '#78350f', '#1d4ed8', '#7c3aed',
  '#ea580c', '#0891b2', '#be123c', '#4d7c0f', '#6d28d9',
];

export function CareProMap({
  locations,
  clients,
  onRefresh,
  isRefreshing,
  franchises = [],
  selectedFranchiseIds = [],
  onFranchiseSelectionChange,
}: {
  locations: EmployeeLocation[];
  clients: ClientLocation[];
  onRefresh?: () => void;
  isRefreshing?: boolean;
  franchises?: { id: string; name: string; displayName: string }[];
  selectedFranchiseIds?: string[];
  onFranchiseSelectionChange?: (ids: string[]) => void;
}) {
  const [showPostcodes, setShowPostcodes] = useState(false);
  const [layer, setLayer] = useState<MapLayer>('both');
  const [franchisePanelOpen, setFranchisePanelOpen] = useState(false);

  const hasFranchisePicker = franchises.length > 0 && !!onFranchiseSelectionChange;
  const selectedSet = useMemo(() => new Set(selectedFranchiseIds), [selectedFranchiseIds]);
  // slugs (branches.name) of the selected franchises — used to filter territory boundaries
  const selectedSlugs = useMemo(
    () => new Set(franchises.filter(f => selectedSet.has(f.id)).map(f => f.name)),
    [franchises, selectedSet]
  );

  function toggleFranchise(id: string) {
    if (!onFranchiseSelectionChange) return;
    onFranchiseSelectionChange(
      selectedSet.has(id) ? selectedFranchiseIds.filter(x => x !== id) : [...selectedFranchiseIds, id]
    );
  }

  // Franchise territory borders — built one franchise at a time from real postcode-sector
  // boundary data (currently: Glasgow North only). Purely visual; no marker/filter logic.
  const [territories, setTerritories] = useState<FeatureCollection | null>(null);
  useEffect(() => {
    fetch('/data/franchise-territories.geo.json')
      .then(res => (res.ok ? res.json() : null))
      .then(setTerritories)
      .catch(() => setTerritories(null));
  }, []);

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searchError, setSearchError] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input when search opens
  useEffect(() => {
    if (searchOpen) setTimeout(() => inputRef.current?.focus(), 50);
  }, [searchOpen]);

  const validEmployees = useMemo(() => locations.filter(l => l.homeLat && l.homeLng), [locations]);
  const validClients   = useMemo(() => clients.filter(c => c.lat && c.lng), [clients]);

  function applyJitter<T>(items: T[], getLat: (i: T) => number, getLng: (i: T) => number) {
    const JITTER = 0.0003;
    const key = (i: T) => `${getLat(i).toFixed(6)},${getLng(i).toFixed(6)}`;
    const groups = new Map<string, T[]>();
    for (const item of items) { const k = key(item); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(item); }
    return items.map(item => {
      const group = groups.get(key(item))!;
      const idx = group.indexOf(item);
      const angle = (2 * Math.PI * idx) / group.length;
      const baseLat = getLat(item), baseLng = getLng(item);
      return { ...item, _jLat: group.length === 1 ? baseLat : baseLat + JITTER * Math.cos(angle), _jLng: group.length === 1 ? baseLng : baseLng + JITTER * Math.sin(angle) };
    });
  }

  const jitteredEmployees = useMemo(() => applyJitter(validEmployees, e => parseFloat(e.homeLat!), e => parseFloat(e.homeLng!)), [validEmployees]);
  const jitteredClients   = useMemo(() => applyJitter(validClients, c => parseFloat(c.lat!), c => parseFloat(c.lng!)), [validClients]);

  const femaleCount = useMemo(() => validEmployees.filter(l => normalizeGender(l.gender) === 'female').length, [validEmployees]);
  const maleCount   = useMemo(() => validEmployees.filter(l => normalizeGender(l.gender) === 'male').length, [validEmployees]);

  const center = useMemo<[number, number]>(() => {
    const lats: number[] = [], lngs: number[] = [];
    if (layer !== 'clients')  validEmployees.forEach(e => { lats.push(parseFloat(e.homeLat!)); lngs.push(parseFloat(e.homeLng!)); });
    if (layer !== 'carePros') validClients.forEach(c => { lats.push(parseFloat(c.lat!)); lngs.push(parseFloat(c.lng!)); });
    if (lats.length === 0) return [53.5, -1.5];
    return [lats.reduce((s, v) => s + v, 0) / lats.length, lngs.reduce((s, v) => s + v, 0) / lngs.length];
  }, [validEmployees, validClients, layer]);

  async function handleSearch() {
    const pc = searchInput.trim().toUpperCase().replace(/\s+/g, '');
    if (!pc) return;
    setIsSearching(true);
    setSearchError('');
    try {
      // postcodes.io is a public API — call it directly from the browser to
      // avoid server-side auth/branch-resolution complexity in production.
      const res  = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
      const data = await res.json();
      if (res.ok && data.status === 200 && data.result?.latitude != null) {
        setSearchResult({
          lat: data.result.latitude,
          lng: data.result.longitude,
          postcode: data.result.postcode,
        });
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
    setSearchInput('');
    setSearchResult(null);
    setSearchError('');
    setSearchOpen(false);
  }

  // All 19 territory borders are always visible (markers, not borders, follow the
  // franchise picker selection).
  const visibleTerritories = territories ?? null;

  const hasData = validEmployees.length > 0 || validClients.length > 0;

  // With the franchise picker available we always show the map (the user may
  // simply have nothing ticked yet); the old empty-state only applies without it.
  if (!hasData && !hasFranchisePicker) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100">
        <MapIcon className="w-16 h-16 text-gray-300 mb-4" />
        <h4 className="text-xl font-bold text-gray-400">No Location Data</h4>
        <p className="text-sm text-gray-400 mt-2">Ensure postcodes are uploaded and geocoded</p>
        {onRefresh && (
          <Button onClick={onRefresh} disabled={isRefreshing} variant="outline" className="mt-4 gap-2">
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh Data
          </Button>
        )}
      </div>
    );
  }

  const showCPs     = layer === 'both' || layer === 'carePros';
  const showClients = layer === 'both' || layer === 'clients';

  const LayerToggle = () => (
    <div className="flex items-center bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden">
      {(['carePros', 'both', 'clients'] as MapLayer[]).map((l, i) => {
        const labels: Record<MapLayer, string> = { carePros: 'Care Pros', both: 'Both', clients: 'Clients' };
        const active = layer === l;
        return (
          <button key={l} onClick={() => setLayer(l)}
            className={`px-4 h-10 text-xs font-bold transition-all duration-200 ${i !== 0 ? 'border-l border-gray-200' : ''} ${active
              ? l === 'carePros' ? 'bg-indigo-600 text-white' : l === 'clients' ? 'bg-teal-600 text-white' : 'bg-gray-800 text-white'
              : 'text-gray-600 hover:bg-gray-50'}`}
          >{labels[l]}</button>
        );
      })}
    </div>
  );

  return (
    <div className="absolute inset-0">
      <MapContainer center={center} zoom={10} style={{ height: '100%', width: '100%' }} scrollWheelZoom zoomControl={false}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        <SearchFlyTo result={searchResult} />

        {/* Franchise territory borders — all 19 territories, always visible, thick solid
            lines. SUR = violet, Independent Franchise = red. Markers follow the picker. */}
        {visibleTerritories && (
          <GeoJSON
            key="all-territories"
            data={visibleTerritories}
            style={(feature) => feature?.properties?.group === 'independent'
              ? { color: '#dc2626', weight: 3, fillColor: '#dc2626', fillOpacity: 0.05, dashArray: '8 6' }
              : { color: '#7c3aed', weight: 3, fillColor: '#7c3aed', fillOpacity: 0.06 }}
            onEachFeature={(feature, layer) => {
              const name = feature.properties?.realName;
              const label = feature.properties?.group === 'independent' ? `${name} (Independent Franchise)` : name;
              if (name) layer.bindTooltip(label, { sticky: true, className: 'font-bold text-xs' });
            }}
          />
        )}

        <TerritoryLabels territories={visibleTerritories} />

        {showCPs && jitteredEmployees.map((loc) => (
          <Marker key={`cp-${loc.id}`} position={[loc._jLat, loc._jLng]} icon={makeIcon(loc.gender || '')}>
            {showPostcodes && <Tooltip permanent direction="right" offset={[15, -20]} className="bg-white/90 border-none shadow-md font-bold text-[10px] px-2 py-1 rounded-md"><span>{loc.homePostcode}</span></Tooltip>}
            <Popup>
              <div className="min-w-[150px]">
                <div className="flex items-center gap-1.5 mb-1"><div className="w-2 h-2 rounded-full bg-indigo-500" /><span className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Care Pro</span></div>
                <p className="text-sm font-bold text-gray-800">{loc.employeeName}</p>
                <p className="text-xs font-bold text-gray-400 uppercase mt-0.5">{loc.homePostcode}</p>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {normalizeGender(loc.gender) && <span className={`text-xs font-semibold capitalize ${normalizeGender(loc.gender) === 'female' ? 'text-pink-600' : 'text-blue-600'}`}>{normalizeGender(loc.gender)}</span>}
                  {loc.transportMode && <span className="text-xs text-gray-400">• {loc.transportMode}</span>}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

        {showClients && jitteredClients.map((loc) => (
          <Marker key={`cl-${loc.id}`} position={[loc._jLat, loc._jLng]} icon={makeClientIcon()}>
            {showPostcodes && <Tooltip permanent direction="right" offset={[15, -14]} className="bg-white/90 border-none shadow-md font-bold text-[10px] px-2 py-1 rounded-md"><span>{loc.postcode}</span></Tooltip>}
            <Popup>
              <div className="min-w-[150px]">
                <div className="flex items-center gap-1.5 mb-1"><div className="w-2 h-2 rounded-full bg-gray-800" /><span className="text-[10px] font-black uppercase tracking-widest text-gray-700">Client</span></div>
                <p className="text-sm font-bold text-gray-800">{loc.clientName}</p>
                <p className="text-xs font-bold text-gray-400 uppercase mt-0.5">{loc.postcode}</p>
                {loc.addressLine && <p className="text-xs text-gray-500 mt-0.5">{loc.addressLine}</p>}
              </div>
            </Popup>
          </Marker>
        ))}

        {/* Yellow search pin */}
        {searchResult && (
          <Marker position={[searchResult.lat, searchResult.lng]} icon={searchPinIcon}>
            <Popup>
              <div className="min-w-[140px]">
                <div className="flex items-center gap-1.5 mb-1"><div className="w-2 h-2 rounded-full bg-yellow-400" /><span className="text-[10px] font-black uppercase tracking-widest text-yellow-600">Searched Postcode</span></div>
                <p className="text-sm font-bold text-gray-800">{searchResult.postcode}</p>
                <p className="text-xs text-gray-400 mt-0.5">{searchResult.lat.toFixed(5)}, {searchResult.lng.toFixed(5)}</p>
              </div>
            </Popup>
          </Marker>
        )}

        <ZoomControls />
      </MapContainer>

      {/* ── Bottom toolbar ── */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center gap-2">

        {/* Error / result badge shown above toolbar */}
        {searchError && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-xs font-semibold px-3 py-1.5 rounded-lg shadow">
            {searchError}
          </div>
        )}
        {searchResult && !searchError && (
          <div className="bg-yellow-50 border border-yellow-300 text-yellow-800 text-xs font-semibold px-3 py-1.5 rounded-lg shadow flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-yellow-400" />
            Showing: {searchResult.postcode}
          </div>
        )}

        {/* Franchise picker panel */}
        {hasFranchisePicker && franchisePanelOpen && (
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-72 max-h-[50vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-100">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Franchises</span>
              <div className="flex items-center gap-2 text-xs font-bold">
                <button className="text-blue-600 hover:underline" onClick={() => onFranchiseSelectionChange!(franchises.map(f => f.id))}>All</button>
                <button className="text-gray-400 hover:underline" onClick={() => onFranchiseSelectionChange!([])}>None</button>
              </div>
            </div>
            <div className="overflow-y-auto py-1">
              {franchises.map((f, i) => {
                const checked = selectedSet.has(f.id);
                return (
                  <button
                    key={f.id}
                    onClick={() => toggleFranchise(f.id)}
                    className={`w-full flex items-center gap-2.5 px-4 py-1.5 text-left transition-colors ${checked ? 'bg-blue-50/60' : 'hover:bg-gray-50'}`}
                  >
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 border ${checked ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white'}`}>
                      {checked && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </span>
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: FRANCHISE_DOT_COLORS[i % FRANCHISE_DOT_COLORS.length] }} />
                    <span className="text-sm font-semibold text-gray-800 truncate">{f.displayName}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex gap-2 items-center">
          <LayerToggle />

          {/* Franchise picker toggle */}
          {hasFranchisePicker && (
            <Button
              onClick={() => setFranchisePanelOpen(o => !o)}
              className={`font-bold shadow-2xl border-none rounded-xl gap-2 h-10 px-4 ${franchisePanelOpen ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-white/95 hover:bg-white text-gray-900'}`}
              title="Choose franchises to show"
            >
              <MapIcon className={`w-4 h-4 ${franchisePanelOpen ? 'text-white' : 'text-blue-600'}`} />
              <span className="hidden sm:inline text-xs">Franchises ({selectedFranchiseIds.length}/{franchises.length})</span>
            </Button>
          )}

          {/* Show postcodes toggle */}
          <Button
            onClick={() => setShowPostcodes(!showPostcodes)}
            className="bg-white/95 hover:bg-white text-gray-900 font-bold shadow-2xl border-none rounded-xl gap-2 h-10 px-4"
            title={showPostcodes ? 'Hide postcodes' : 'Show postcodes'}
          >
            {showPostcodes ? <Eye className="w-4 h-4 text-blue-600" /> : <EyeOff className="w-4 h-4 text-gray-400" />}
            <span className="hidden sm:inline text-xs">{showPostcodes ? 'Postcodes' : 'Show'}</span>
          </Button>

          {/* Refresh */}
          {onRefresh && (
            <Button onClick={onRefresh} disabled={isRefreshing} className="bg-white/95 hover:bg-white text-gray-900 font-bold shadow-2xl border-none rounded-xl gap-2 h-10 px-4">
              <RefreshCw className={`w-4 h-4 text-purple-600 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline text-xs">{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
            </Button>
          )}

          {/* Search — collapsed icon → expanded inline input */}
          {!searchOpen ? (
            <Button
              onClick={() => setSearchOpen(true)}
              className="bg-white/95 hover:bg-white text-gray-900 font-bold shadow-2xl border-none rounded-xl h-10 w-10 p-0"
              title="Search postcode"
            >
              <Search className="w-4 h-4 text-yellow-500" />
            </Button>
          ) : (
            <div className="flex items-center gap-1.5 bg-white rounded-xl shadow-2xl border border-gray-100 px-3 h-10">
              <Search className="w-4 h-4 text-yellow-500 flex-shrink-0" />
              <Input
                ref={inputRef}
                value={searchInput}
                onChange={e => { setSearchInput(e.target.value); setSearchError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') handleSearch(); if (e.key === 'Escape') clearSearch(); }}
                placeholder="e.g. SW1A 1AA"
                className="border-0 shadow-none bg-transparent h-7 w-36 text-sm font-medium p-0 focus-visible:ring-0 placeholder:text-gray-400"
              />
              <Button
                onClick={handleSearch}
                disabled={!searchInput.trim() || isSearching}
                className="h-7 px-3 text-xs font-bold bg-yellow-400 hover:bg-yellow-500 text-gray-900 border-none rounded-lg shadow-none"
              >
                {isSearching ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Go'}
              </Button>
              <button onClick={clearSearch} className="text-gray-400 hover:text-red-500 transition-colors ml-0.5" title="Close search">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-6 left-6 bg-white p-4 rounded-2xl shadow-2xl border border-gray-100 flex flex-col gap-1.5 z-[1000] min-w-[170px]">
        <h5 className="text-[10px] font-black uppercase tracking-widest text-gray-400 border-b border-gray-100 pb-2 mb-0.5">Legend</h5>
        {showCPs && (
          <>
            <p className="text-[9px] font-black uppercase tracking-widest text-indigo-400 mt-0.5">Care Pros ({validEmployees.length})</p>
            <div className="flex items-center gap-2">
              <svg width="14" height="18" viewBox="0 0 32 40"><path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 24 16 24S32 26 32 16C32 7.163 24.837 0 16 0z" fill="#ec4899" stroke="white" strokeWidth="2"/></svg>
              <span className="text-xs font-semibold text-gray-700">Female <span className="text-pink-500">({femaleCount})</span></span>
            </div>
            <div className="flex items-center gap-2">
              <svg width="14" height="18" viewBox="0 0 32 40"><path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 24 16 24S32 26 32 16C32 7.163 24.837 0 16 0z" fill="#3b82f6" stroke="white" strokeWidth="2"/></svg>
              <span className="text-xs font-semibold text-gray-700">Male <span className="text-blue-500">({maleCount})</span></span>
            </div>
          </>
        )}
        {layer === 'both' && <div className="border-t border-gray-100 my-0.5" />}
        {showClients && (
          <>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-600 mt-0.5">Clients ({validClients.length})</p>
            <div className="flex items-center gap-2">
              <svg width="14" height="18" viewBox="0 0 32 40"><path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 24 16 24S32 26 32 16C32 7.163 24.837 0 16 0z" fill="#1f2937" stroke="white" strokeWidth="2"/></svg>
              <span className="text-xs font-semibold text-gray-700">Client location</span>
            </div>
          </>
        )}
        {searchResult && (
          <>
            <div className="border-t border-gray-100 my-0.5" />
            <div className="flex items-center gap-2">
              <svg width="14" height="18" viewBox="0 0 32 40"><path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 24 16 24S32 26 32 16C32 7.163 24.837 0 16 0z" fill="#eab308" stroke="white" strokeWidth="2"/></svg>
              <span className="text-xs font-semibold text-gray-700">Search: {searchResult.postcode}</span>
            </div>
          </>
        )}
        {hasFranchisePicker && (
          <>
            <div className="border-t border-gray-100 my-0.5" />
            <div className="flex items-center gap-2">
              <MapIcon className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-xs font-semibold text-gray-700">{selectedFranchiseIds.length} of {franchises.length} franchises shown</span>
            </div>
          </>
        )}
        {visibleTerritories && visibleTerritories.features.length > 0 && (
          <>
            <div className="border-t border-gray-100 my-0.5" />
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 rounded-sm border-2 border-violet-600 bg-violet-600/10" />
              <span className="text-xs font-semibold text-gray-700">Territory border</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
