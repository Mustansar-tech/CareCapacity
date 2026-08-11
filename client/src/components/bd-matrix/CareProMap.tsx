import { useState, useMemo, useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, Tooltip, GeoJSON, CircleMarker, useMap } from "react-leaflet";
import type { FeatureCollection } from "geojson";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RefreshCw, ZoomIn, ZoomOut, Eye, EyeOff, Map as MapIcon, Search, X, Landmark } from "lucide-react";
import type { EmployeeLocation, ClientLocation } from "@shared/schema";
import { normalizeGender } from "@/utils/bd-matrix-utils";
import { getRealFranchiseName, getFranchiseColor } from "@/data/franchise-real-names";

export type FranchiseBranch = { id: string; name: string; displayName: string };

function makeIcon(gender: string) {
  const g = normalizeGender(gender);
  const color = g === 'female' ? '#ec4899' : g === 'male' ? '#3b82f6' : '#9ca3af';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 24 16 24S32 26 32 16C32 7.163 24.837 0 16 0z" fill="${color}" stroke="white" stroke-width="2"/>
    <circle cx="16" cy="16" r="7" fill="white" opacity="0.9"/>
    <circle cx="16" cy="16" r="4" fill="${color}"/>
  </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [32, 40], iconAnchor: [16, 40], popupAnchor: [0, -40] });
}

function makeClientIcon() {
  const color = '#1f2937';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 24 16 24S32 26 32 16C32 7.163 24.837 0 16 0z" fill="${color}" stroke="white" stroke-width="2"/>
    <circle cx="16" cy="16" r="7" fill="white" opacity="0.9"/>
    <circle cx="16" cy="16" r="4" fill="${color}"/>
  </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [32, 40], iconAnchor: [16, 40], popupAnchor: [0, -40] });
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

type MapLayer = 'both' | 'carePros' | 'clients';

export function CareProMap({
  locations,
  clients,
  onRefresh,
  isRefreshing,
  branches,
  defaultBranchId,
}: {
  locations: EmployeeLocation[];
  clients: ClientLocation[];
  onRefresh?: () => void;
  isRefreshing?: boolean;
  /** When provided, enables the multi-franchise view: territory borders for
   *  each branch plus a filter to narrow which franchises' markers show.
   *  `locations`/`clients` are expected to carry `branchId` in this mode. */
  branches?: FranchiseBranch[];
  /** The app's globally selected branch id — used as the initial franchise
   *  filter selection so opening the map doesn't show every franchise's
   *  markers at once. */
  defaultBranchId?: string | null;
}) {
  const [showPostcodes, setShowPostcodes] = useState(false);
  const [layer, setLayer] = useState<MapLayer>('both');
  const multiFranchise = !!branches && branches.length > 0;

  // Franchise filter — defaults to just the app's globally selected
  // franchise (not "all"), so opening the map doesn't dump every franchise's
  // markers on screen at once. Territory borders for every franchise still
  // render regardless. Falls back to "all" if there's no global selection
  // or it isn't in the accessible branch list.
  const [selectedBranchIds, setSelectedBranchIds] = useState<Set<string> | null>(null);
  const [franchisePanelOpen, setFranchisePanelOpen] = useState(false);
  useEffect(() => {
    if (branches && selectedBranchIds === null) {
      const defaultValid = defaultBranchId && branches.some(b => b.id === defaultBranchId);
      setSelectedBranchIds(new Set(defaultValid ? [defaultBranchId!] : branches.map(b => b.id)));
    }
  }, [branches, selectedBranchIds, defaultBranchId]);

  const activeBranchIds = useMemo(() => {
    if (!multiFranchise) return null;
    return selectedBranchIds ?? new Set((branches ?? []).map(b => b.id));
  }, [multiFranchise, selectedBranchIds, branches]);

  function toggleFranchise(id: string) {
    setSelectedBranchIds(prev => {
      const next = new Set(prev ?? (branches ?? []).map(b => b.id));
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const selectAllFranchises = () => setSelectedBranchIds(new Set((branches ?? []).map(b => b.id)));
  const selectNoFranchises = () => setSelectedBranchIds(new Set());

  // Territory borders — loaded once as a static GeoJSON asset; filtered down
  // to whichever franchises the caller passed in `branches`.
  const [territories, setTerritories] = useState<FeatureCollection | null>(null);
  useEffect(() => {
    if (!multiFranchise) return;
    let cancelled = false;
    fetch('/data/franchise-territories.geo.json')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (!cancelled && data) setTerritories(data); })
      .catch(() => { /* borders are a visual extra — ignore fetch failures */ });
    return () => { cancelled = true; };
  }, [multiFranchise]);

  const branchSlugById = useMemo(() => {
    const map = new Map<string, string>();
    (branches ?? []).forEach(b => map.set(b.id, b.name));
    return map;
  }, [branches]);

  const visibleTerritories = useMemo<FeatureCollection | null>(() => {
    if (!territories || !branches) return null;
    const accessibleSlugs = new Set(branches.map(b => b.name));
    return {
      ...territories,
      features: territories.features.filter(f => accessibleSlugs.has((f.properties as any)?.branch)),
    };
  }, [territories, branches]);

  // Other (non-SUR) Home Instead franchise territories — a read-only
  // reference layer so the SUR team can see where neighbouring, independently
  // owned franchises operate. These aren't real Branch records in this app,
  // so they're always shown (no filter/access-control tie-in) whenever the
  // SUR territory layer is shown, styled distinctly (transparent red) so
  // they're never confused with SUR's own coloured territories.
  const [otherTerritories, setOtherTerritories] = useState<FeatureCollection | null>(null);
  useEffect(() => {
    if (!multiFranchise) return;
    let cancelled = false;
    fetch('/data/other-franchise-territories.geo.json')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (!cancelled && data) setOtherTerritories(data); })
      .catch(() => { /* borders are a visual extra — ignore fetch failures */ });
    return () => { cancelled = true; };
  }, [multiFranchise]);

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

  const validEmployees = useMemo(() => locations.filter(l => l.homeLat && l.homeLng && (!activeBranchIds || activeBranchIds.has((l as any).branchId))), [locations, activeBranchIds]);
  const validClients   = useMemo(() => clients.filter(c => c.lat && c.lng && (!activeBranchIds || activeBranchIds.has((c as any).branchId))), [clients, activeBranchIds]);

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

  const hasData = validEmployees.length > 0 || validClients.length > 0;

  if (!hasData) {
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
  const selectedCount = activeBranchIds ? activeBranchIds.size : (branches?.length ?? 0);

  const FranchiseFilter = () => {
    if (!multiFranchise) return null;
    return (
      <div className="relative">
        <Button
          onClick={() => setFranchisePanelOpen(o => !o)}
          className="bg-white/95 hover:bg-white text-gray-900 font-bold shadow-2xl border-none rounded-xl gap-2 h-10 px-4"
          title="Filter franchises"
        >
          <Landmark className="w-4 h-4 text-[#5d51d5]" />
          <span className="hidden sm:inline text-xs">Franchises ({selectedCount}/{branches!.length})</span>
        </Button>
        {franchisePanelOpen && (
          <div className="absolute bottom-12 left-0 z-[1000] bg-white rounded-xl shadow-2xl border border-gray-100 p-3 w-64 max-h-80 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Franchises</span>
              <div className="flex gap-2">
                <button onClick={selectAllFranchises} className="text-[11px] font-bold text-[#5d51d5] hover:underline">All</button>
                <button onClick={selectNoFranchises} className="text-[11px] font-bold text-gray-400 hover:underline">None</button>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {branches!.map(b => {
                const checked = activeBranchIds?.has(b.id) ?? true;
                return (
                  <label key={b.id} className="flex items-center gap-2 px-1.5 py-1 text-xs rounded-lg hover:bg-gray-50 cursor-pointer">
                    <Checkbox checked={checked} onCheckedChange={() => toggleFranchise(b.id)} className="shrink-0" />
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: getFranchiseColor(b.name) }} />
                    <span className="font-semibold text-gray-700 truncate">{getRealFranchiseName(b.name, b.displayName)}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

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

        {visibleTerritories && (
          <GeoJSON
            key={JSON.stringify(activeBranchIds ? Array.from(activeBranchIds) : null)}
            data={visibleTerritories as any}
            style={(feature: any) => {
              const slug = feature?.properties?.branch;
              const branchId = [...branchSlugById.entries()].find(([, s]) => s === slug)?.[0];
              const isSelected = !branchId || !activeBranchIds || activeBranchIds.has(branchId);
              const color = getFranchiseColor(slug);
              return {
                color,
                weight: isSelected ? 5 : 3.5,
                opacity: isSelected ? 1 : 0.7,
                fillColor: color,
                fillOpacity: isSelected ? 0.1 : 0.03,
                lineCap: 'round' as const,
                lineJoin: 'round' as const,
              };
            }}
            onEachFeature={(feature: any, layer: any) => {
              const slug = feature?.properties?.branch;
              const realName = feature?.properties?.realName ?? slug;
              const color = getFranchiseColor(slug);
              layer.bindTooltip(
                `<span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;border-radius:9999px;background:${color};display:inline-block;"></span>${realName}</span>`,
                { sticky: true, className: 'font-bold text-xs' },
              );
            }}
          />
        )}

        {/* Non-SUR Home Instead franchise territories — always-on reference
            layer, styled distinctly (transparent red) from SUR's own
            territories above. Purely visual: no selection/filter tie-in. */}
        {otherTerritories && (
          <GeoJSON
            data={otherTerritories as any}
            style={() => ({
              color: '#dc2626',
              weight: 2,
              opacity: 0.55,
              fillColor: '#dc2626',
              fillOpacity: 0.06,
              dashArray: '6 4',
              lineCap: 'round' as const,
              lineJoin: 'round' as const,
            })}
          />
        )}

        {/* Permanent name labels for the non-SUR layer, anchored at each
            polygon's pre-computed centroid (guaranteed to fall inside the
            shape — see scripts/generate-franchise-territories.mjs) rather
            than Leaflet's bounding-box center, which can land outside an
            odd-shaped or multi-part (e.g. island-containing) territory. */}
        {otherTerritories?.features.map((feature: any, idx: number) => {
          const centroid = feature?.properties?.centroid;
          if (!Array.isArray(centroid)) return null;
          const realName = feature?.properties?.realName ?? 'Other franchise';
          return (
            <CircleMarker
              key={`other-label-${idx}`}
              center={[centroid[1], centroid[0]]}
              radius={0}
              pathOptions={{ opacity: 0, fillOpacity: 0 }}
              ref={(marker) => {
                if (marker && !marker.getTooltip()) {
                  marker.bindTooltip(
                    `<span style="display:inline-flex;align-items:center;gap:6px;color:#991b1b;"><span style="width:8px;height:8px;border-radius:9999px;background:#dc2626;display:inline-block;"></span>${realName}</span>`,
                    { permanent: true, direction: 'center', className: 'font-bold text-[10px] !bg-white/80 !border-red-200' },
                  );
                }
              }}
            />
          );
        })}

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

        <div className="flex gap-2 items-center">
          <LayerToggle />

          <FranchiseFilter />

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
        {multiFranchise && (
          <>
            <div className="border-t border-gray-100 my-0.5" />
            <div className="flex items-center gap-2">
              <Landmark className="w-3.5 h-3.5 text-[#5d51d5]" />
              <span className="text-xs font-semibold text-gray-700">{selectedCount} of {branches!.length} franchises shown</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
