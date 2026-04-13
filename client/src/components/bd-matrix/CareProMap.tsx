import { useState, useMemo } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMap } from "react-leaflet";
import { Button } from "@/components/ui/button";
import { RefreshCw, ZoomIn, ZoomOut, Eye, EyeOff, Map as MapIcon } from "lucide-react";
import type { EmployeeLocation, ClientLocation } from "@shared/schema";
import { normalizeGender } from "@/utils/bd-matrix-utils";

function makeIcon(gender: string) {
  const g = normalizeGender(gender);
  const color = g === 'female' ? '#ec4899' : g === 'male' ? '#3b82f6' : '#9ca3af';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 24 16 24S32 26 32 16C32 7.163 24.837 0 16 0z" fill="${color}" stroke="white" stroke-width="2"/>
    <circle cx="16" cy="16" r="7" fill="white" opacity="0.9"/>
    <circle cx="16" cy="16" r="4" fill="${color}"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [32, 40],
    iconAnchor: [16, 40],
    popupAnchor: [0, -40],
  });
}

function makeClientIcon() {
  const color = '#1f2937';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 24 16 24S32 26 32 16C32 7.163 24.837 0 16 0z" fill="${color}" stroke="white" stroke-width="2"/>
    <circle cx="16" cy="16" r="7" fill="white" opacity="0.9"/>
    <circle cx="16" cy="16" r="4" fill="${color}"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [32, 40],
    iconAnchor: [16, 40],
    popupAnchor: [0, -40],
  });
}

function ZoomControls() {
  const map = useMap();
  return (
    <div className="absolute bottom-6 right-6 z-[1000] flex flex-col gap-2">
      <Button
        onClick={() => map.zoomIn()}
        className="bg-white/95 hover:bg-white dark:bg-gray-800/95 dark:hover:bg-gray-800 text-gray-900 dark:text-white font-bold shadow-2xl border-none rounded-xl h-10 w-10 p-0"
        title="Zoom in"
      >
        <ZoomIn className="w-5 h-5 text-blue-600" />
      </Button>
      <Button
        onClick={() => map.zoomOut()}
        className="bg-white/95 hover:bg-white dark:bg-gray-800/95 dark:hover:bg-gray-800 text-gray-900 dark:text-white font-bold shadow-2xl border-none rounded-xl h-10 w-10 p-0"
        title="Zoom out"
      >
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
}: {
  locations: EmployeeLocation[];
  clients: ClientLocation[];
  onRefresh?: () => void;
  isRefreshing?: boolean;
}) {
  const [showPostcodes, setShowPostcodes] = useState(false);
  const [layer, setLayer] = useState<MapLayer>('both');

  const validEmployees = useMemo(
    () => locations.filter(l => l.homeLat && l.homeLng),
    [locations]
  );
  const validClients = useMemo(
    () => clients.filter(c => c.lat && c.lng),
    [clients]
  );

  function applyJitter<T>(items: T[], getLat: (i: T) => number, getLng: (i: T) => number): (T & { _jLat: number; _jLng: number })[] {
    const JITTER = 0.0003;
    const key = (i: T) => `${getLat(i).toFixed(6)},${getLng(i).toFixed(6)}`;
    const groups = new Map<string, T[]>();
    for (const item of items) {
      const k = key(item);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(item);
    }
    return items.map(item => {
      const group = groups.get(key(item))!;
      const idx = group.indexOf(item);
      const angle = (2 * Math.PI * idx) / group.length;
      const baseLat = getLat(item);
      const baseLng = getLng(item);
      return {
        ...item,
        _jLat: group.length === 1 ? baseLat : baseLat + JITTER * Math.cos(angle),
        _jLng: group.length === 1 ? baseLng : baseLng + JITTER * Math.sin(angle),
      };
    });
  }

  const jitteredEmployees = useMemo(
    () => applyJitter(validEmployees, e => parseFloat(e.homeLat!), e => parseFloat(e.homeLng!)),
    [validEmployees]
  );
  const jitteredClients = useMemo(
    () => applyJitter(validClients, c => parseFloat(c.lat!), c => parseFloat(c.lng!)),
    [validClients]
  );

  const femaleCount = useMemo(() => validEmployees.filter(l => normalizeGender(l.gender) === 'female').length, [validEmployees]);
  const maleCount = useMemo(() => validEmployees.filter(l => normalizeGender(l.gender) === 'male').length, [validEmployees]);

  const center = useMemo<[number, number]>(() => {
    const allLats: number[] = [];
    const allLngs: number[] = [];
    if (layer !== 'clients') validEmployees.forEach(e => { allLats.push(parseFloat(e.homeLat!)); allLngs.push(parseFloat(e.homeLng!)); });
    if (layer !== 'carePros') validClients.forEach(c => { allLats.push(parseFloat(c.lat!)); allLngs.push(parseFloat(c.lng!)); });
    if (allLats.length === 0) return [53.5, -1.5];
    return [
      allLats.reduce((s, v) => s + v, 0) / allLats.length,
      allLngs.reduce((s, v) => s + v, 0) / allLngs.length,
    ];
  }, [validEmployees, validClients, layer]);

  const hasData = validEmployees.length > 0 || validClients.length > 0;

  if (!hasData) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100">
        <MapIcon className="w-16 h-16 text-gray-300 mb-4" />
        <h4 className="text-xl font-bold text-gray-400">No Location Data</h4>
        <p className="text-sm text-gray-400 mt-2">Ensure postcodes are uploaded and geocoded</p>
        {onRefresh && (
          <Button onClick={onRefresh} disabled={isRefreshing} variant="outline" className="mt-4 gap-2">
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh Data
          </Button>
        )}
      </div>
    );
  }

  const showCPs = layer === 'both' || layer === 'carePros';
  const showClients = layer === 'both' || layer === 'clients';

  const LayerToggle = () => (
    <div className="flex items-center bg-white/95 backdrop-blur-md rounded-xl shadow-2xl border border-gray-100 overflow-hidden">
      {(['carePros', 'both', 'clients'] as MapLayer[]).map((l, i) => {
        const labels: Record<MapLayer, string> = { carePros: 'Care Pros', both: 'Both', clients: 'Clients' };
        const active = layer === l;
        return (
          <button
            key={l}
            onClick={() => setLayer(l)}
            className={`px-4 h-10 text-xs font-bold transition-all duration-200 ${
              i !== 0 ? 'border-l border-gray-200' : ''
            } ${
              active
                ? l === 'carePros'
                  ? 'bg-indigo-600 text-white'
                  : l === 'clients'
                    ? 'bg-teal-600 text-white'
                    : 'bg-gray-800 text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {labels[l]}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="absolute inset-0">
      <MapContainer
        center={center}
        zoom={10}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
        zoomControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {showCPs && jitteredEmployees.map((loc) => (
          <Marker key={`cp-${loc.id}`} position={[loc._jLat, loc._jLng]} icon={makeIcon(loc.gender || '')}>
            {showPostcodes && (
              <Tooltip permanent direction="right" offset={[15, -20]} className="bg-white/90 border-none shadow-md font-bold text-[10px] px-2 py-1 rounded-md">
                <span>{loc.homePostcode}</span>
              </Tooltip>
            )}
            <Popup>
              <div className="min-w-[150px]">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-2 h-2 rounded-full bg-indigo-500" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Care Pro</span>
                </div>
                <p className="text-sm font-bold text-gray-800">{loc.employeeName}</p>
                <p className="text-xs font-bold text-gray-400 uppercase mt-0.5">{loc.homePostcode}</p>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  {normalizeGender(loc.gender) && (
                    <span className={`text-xs font-semibold capitalize ${normalizeGender(loc.gender) === 'female' ? 'text-pink-600' : 'text-blue-600'}`}>
                      {normalizeGender(loc.gender)}
                    </span>
                  )}
                  {loc.transportMode && <span className="text-xs text-gray-400">• {loc.transportMode}</span>}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

        {showClients && jitteredClients.map((loc) => (
          <Marker key={`cl-${loc.id}`} position={[loc._jLat, loc._jLng]} icon={makeClientIcon()}>
            {showPostcodes && (
              <Tooltip permanent direction="right" offset={[15, -14]} className="bg-white/90 border-none shadow-md font-bold text-[10px] px-2 py-1 rounded-md">
                <span>{loc.postcode}</span>
              </Tooltip>
            )}
            <Popup>
              <div className="min-w-[150px]">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-2 h-2 rounded-full bg-gray-800" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-700">Client</span>
                </div>
                <p className="text-sm font-bold text-gray-800">{loc.clientName}</p>
                <p className="text-xs font-bold text-gray-400 uppercase mt-0.5">{loc.postcode}</p>
                {loc.addressLine && <p className="text-xs text-gray-500 mt-0.5">{loc.addressLine}</p>}
              </div>
            </Popup>
          </Marker>
        ))}

        <ZoomControls />
      </MapContainer>

      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-[1000] flex gap-2 items-center">
        <LayerToggle />
        <Button
          onClick={() => setShowPostcodes(!showPostcodes)}
          className="bg-white/95 hover:bg-white dark:bg-gray-800/95 dark:hover:bg-gray-800 text-gray-900 dark:text-white font-bold shadow-2xl border-none rounded-xl gap-2 h-10 px-4"
          title={showPostcodes ? 'Hide postcodes' : 'Show postcodes'}
        >
          {showPostcodes ? <Eye className="w-4 h-4 text-blue-600" /> : <EyeOff className="w-4 h-4 text-gray-400" />}
          <span className="hidden sm:inline text-xs">{showPostcodes ? 'Postcodes' : 'Show'}</span>
        </Button>
        {onRefresh && (
          <Button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="bg-white/95 hover:bg-white dark:bg-gray-800/95 dark:hover:bg-gray-800 text-gray-900 dark:text-white font-bold shadow-2xl border-none rounded-xl gap-2 h-10 px-4"
          >
            <RefreshCw className={`w-4 h-4 text-purple-600 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline text-xs">{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </Button>
        )}
      </div>

      <div className="absolute bottom-6 left-6 bg-white/95 backdrop-blur-md p-4 rounded-2xl shadow-2xl border border-gray-100 flex flex-col gap-1.5 z-[1000] min-w-[170px]">
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
      </div>
    </div>
  );
}
