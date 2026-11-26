import { useEffect, useRef, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Building2, Compass, Home, Navigation, Route as RouteIcon } from 'lucide-react';
import { haversineDistanceKm } from '../../shared/domain.ts';
import type { HospitalSettings } from '../types/api.ts';

interface HospitalMapPanelProps {
  mapsApiKey: string;
  hospital: HospitalSettings;
  patientLocation?: { lat: number; lng: number; label?: string } | null;
  nurseLocation?: { lat: number; lng: number; label?: string; updatedAt?: string | null } | null;
  title?: string;
}

interface LatLngLiteral {
  lat: number;
  lng: number;
}

interface PolylineHandle {
  setMap: (map: unknown) => void;
  setOptions: (opts: { strokeColor: string; strokeWeight: number; strokeOpacity: number }) => void;
}

interface MapWithFitBounds {
  fitBounds: (bounds: unknown) => void;
}

interface RouteOverlayProps {
  origin: LatLngLiteral;
  destination: LatLngLiteral;
  onRouteComputed: (summary: { distanceKm: number; durationMins: number } | null) => void;
  onRouteError: (msg: string | null) => void;
}

function RoutesApiOverlay({
  origin,
  destination,
  onRouteComputed,
  onRouteError,
}: RouteOverlayProps) {
  const map = useMap() as MapWithFitBounds | null;
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<PolylineHandle[]>([]);

  useEffect(() => {
    if (!routesLib || !map) return;

    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
    onRouteError(null);

    const request = {
      origin,
      destination,
      travelMode: 'DRIVING',
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
    };

    const routeClass = (routesLib as unknown as {
      Route?: {
        computeRoutes: (req: unknown) => Promise<{
          routes?: Array<{
            distanceMeters?: number;
            durationMillis?: number;
            viewport?: unknown;
            createPolylines?: () => PolylineHandle[];
          }>;
        }>;
      };
    }).Route;

    if (!routeClass || typeof routeClass.computeRoutes !== 'function') {
      onRouteError('Routes service unavailable in current browser session.');
      return;
    }

    let cancelled = false;

    routeClass
      .computeRoutes(request)
      .then((res) => {
        if (cancelled) return;
        const primaryRoute = res.routes?.[0];
        if (!primaryRoute) {
          onRouteComputed(null);
          return;
        }
        if (typeof primaryRoute.createPolylines === 'function') {
          const lines = primaryRoute.createPolylines();
          lines.forEach((line) => {
            line.setOptions({ strokeColor: '#0f766e', strokeWeight: 5, strokeOpacity: 0.9 });
            line.setMap(map);
          });
          polylinesRef.current = lines;
        }
        if (primaryRoute.viewport) {
          map.fitBounds(primaryRoute.viewport);
        }
        onRouteComputed({
          distanceKm: Number(((primaryRoute.distanceMeters ?? 0) / 1000).toFixed(2)),
          durationMins: Math.max(1, Math.round((primaryRoute.durationMillis ?? 0) / 60000)),
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('OVER_QUERY_LIMIT')) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        onRouteError('Unable to load live turn-by-turn route; showing Haversine estimate.');
        onRouteComputed(null);
      });

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [routesLib, map, origin.lat, origin.lng, destination.lat, destination.lng, onRouteComputed, onRouteError]);

  return null;
}

export function HospitalMapPanel({
  mapsApiKey,
  hospital,
  patientLocation,
  nurseLocation,
  title = 'East-City Service Zone & Live Tracking',
}: HospitalMapPanelProps) {
  const [routeSummary, setRouteSummary] = useState<{ distanceKm: number; durationMins: number } | null>(null);
  const [routeNotice, setRouteNotice] = useState<string | null>(null);
  const [mapsQuotaHit, setMapsQuotaHit] = useState(false);

  useEffect(() => {
    const onQuota = () => setMapsQuotaHit(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  const hospitalCoords = { lat: hospital.latitude, lng: hospital.longitude };
  const routeOrigin = nurseLocation
    ? { lat: nurseLocation.lat, lng: nurseLocation.lng }
    : hospitalCoords;
  const routeDest = patientLocation
    ? { lat: patientLocation.lat, lng: patientLocation.lng }
    : null;

  const haversineNurseToPatient =
    nurseLocation && patientLocation
      ? haversineDistanceKm(nurseLocation, patientLocation)
      : null;

  const haversineHospitalToPatient = patientLocation
    ? haversineDistanceKm(hospitalCoords, patientLocation)
    : null;

  const canRenderGoogleMaps = Boolean(mapsApiKey) && !mapsQuotaHit;

  // Schematic fallback projection centered on East-City Hospital
  const projectPoint = (lat: number, lng: number) => {
    const dx = (lng - hospital.longitude) * 1400;
    const dy = (hospital.latitude - lat) * 1600;
    return {
      x: Math.max(36, Math.min(364, 200 + dx)),
      y: Math.max(36, Math.min(204, 120 + dy)),
    };
  };

  const hospSvg = projectPoint(hospital.latitude, hospital.longitude);
  const patSvg = patientLocation ? projectPoint(patientLocation.lat, patientLocation.lng) : null;
  const nurseSvg = nurseLocation ? projectPoint(nurseLocation.lat, nurseLocation.lng) : null;

  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-teal-700" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 font-mono tabular-nums">
          {routeSummary ? (
            <span className="inline-flex items-center gap-1.5 text-teal-800 font-medium">
              <RouteIcon className="w-3.5 h-3.5" aria-hidden="true" />
              {routeSummary.distanceKm} km · ~{routeSummary.durationMins} min drive
            </span>
          ) : haversineNurseToPatient !== null ? (
            <span>
              Nurse → Home: {haversineNurseToPatient.toFixed(2)} km (Haversine)
            </span>
          ) : haversineHospitalToPatient !== null ? (
            <span>
              Hospital → Home: {haversineHospitalToPatient.toFixed(2)} km
            </span>
          ) : (
            <span>Radius: {hospital.serviceRadiusKm} km</span>
          )}
        </div>
      </div>

      {canRenderGoogleMaps ? (
        <div className="h-[340px] w-full relative bg-slate-100">
          <APIProvider apiKey={mapsApiKey} language="en" region="PK">
            <GoogleMap
              defaultCenter={patientLocation ?? hospitalCoords}
              defaultZoom={13}
              mapId="DEMO_MAP_ID"
              gestureHandling="greedy"
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              className="w-full h-full"
            >
              <AdvancedMarker position={hospitalCoords} title={hospital.hospitalName}>
                <Pin background="#0f172a" glyphColor="#ffffff" borderColor="#0f172a" />
              </AdvancedMarker>

              {patientLocation && (
                <AdvancedMarker
                  position={{ lat: patientLocation.lat, lng: patientLocation.lng }}
                  title={patientLocation.label || 'Patient Home'}
                >
                  <Pin background="#0f766e" glyphColor="#ffffff" borderColor="#115e59" />
                </AdvancedMarker>
              )}

              {nurseLocation && (
                <AdvancedMarker
                  position={{ lat: nurseLocation.lat, lng: nurseLocation.lng }}
                  title={nurseLocation.label || 'Assigned Nurse'}
                >
                  <Pin background="#0284c7" glyphColor="#ffffff" borderColor="#0369a1" />
                </AdvancedMarker>
              )}

              {routeDest && (
                <RoutesApiOverlay
                  origin={routeOrigin}
                  destination={routeDest}
                  onRouteComputed={setRouteSummary}
                  onRouteError={setRouteNotice}
                />
              )}
            </GoogleMap>
          </APIProvider>
        </div>
      ) : (
        <div className="bg-slate-50 p-4">
          <div className="flex items-center justify-between text-xs text-slate-600 mb-2">
            <span>
              Coordinate & Haversine Zone View ({hospital.city} · Service Radius {hospital.serviceRadiusKm} km)
            </span>
            <span className="font-mono tabular-nums">
              Hospital: {hospital.latitude.toFixed(4)}, {hospital.longitude.toFixed(4)}
            </span>
          </div>
          <svg
            viewBox="0 0 400 240"
            className="w-full h-[250px] bg-white border border-slate-200 rounded-lg"
            role="img"
            aria-label="East-City Hospital home visit coordinate map"
          >
            <defs>
              <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#f1f5f9" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="400" height="240" fill="url(#grid)" />
            <circle
              cx={hospSvg.x}
              cy={hospSvg.y}
              r="88"
              fill="#f0fdfa"
              fillOpacity="0.65"
              stroke="#99f6e4"
              strokeDasharray="4 4"
            />
            {patSvg && (
              <line
                x1={nurseSvg ? nurseSvg.x : hospSvg.x}
                y1={nurseSvg ? nurseSvg.y : hospSvg.y}
                x2={patSvg.x}
                y2={patSvg.y}
                stroke="#0f766e"
                strokeWidth="2.5"
                strokeDasharray="6 4"
              />
            )}
            <g transform={`translate(${hospSvg.x}, ${hospSvg.y})`}>
              <circle r="8" fill="#0f172a" />
              <text x="12" y="4" fontSize="11" fontWeight="600" fill="#0f172a">
                East-City Hospital
              </text>
            </g>
            {patSvg && (
              <g transform={`translate(${patSvg.x}, ${patSvg.y})`}>
                <circle r="8" fill="#0f766e" />
                <text x="12" y="4" fontSize="11" fontWeight="600" fill="#115e59">
                  {patientLocation?.label || 'Patient Home'}
                </text>
              </g>
            )}
            {nurseSvg && (
              <g transform={`translate(${nurseSvg.x}, ${nurseSvg.y})`}>
                <circle r="8" fill="#0284c7" />
                <text x="12" y="-10" fontSize="11" fontWeight="600" fill="#0369a1">
                  {nurseLocation?.label || 'Assigned Nurse'}
                </text>
              </g>
            )}
          </svg>
        </div>
      )}

      <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5 text-slate-900" aria-hidden="true" />
            <span>{hospital.hospitalName}</span>
          </span>
          {patientLocation && (
            <span className="inline-flex items-center gap-1.5">
              <Home className="w-3.5 h-3.5 text-teal-700" aria-hidden="true" />
              <span>Patient Home (Consented)</span>
            </span>
          )}
          {nurseLocation && (
            <span className="inline-flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5 text-sky-700" aria-hidden="true" />
              <span>
                Assigned Nurse Live GPS
                {nurseLocation.updatedAt
                  ? ` · ${new Date(nurseLocation.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : ''}
              </span>
            </span>
          )}
        </div>
        {routeNotice && <span className="text-amber-700">{routeNotice}</span>}
      </div>
    </section>
  );
}
