import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, GeoJSON, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { Facility, LayerState, PowerAsset } from '../types'
import { RISK_COLORS, ZONE_RISK_FILL, ZONE_RISK_BORDER, facilityTypeIcon, formatFacilityType } from '../utils/colors'
import { ScoreLegend } from './ScoreLegend'
import { GhostCorridorLayer } from './GhostCorridorLayer'
import type { Corridor } from '../data/corridors'
import type { Scenario } from '../data/scenarios'
import { generateBriefNarrative } from '../utils/narrative'

const BENGALURU_CENTER: [number, number] = [12.9716, 77.5946]

/** GIBS imagery is processed with ~24h delay — always request yesterday's date */
function yesterday(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

interface Props {
  facilities: Facility[]
  powerAssets: PowerAsset[]
  riskZones: any | null
  layers: LayerState
  selectedFacility: Facility | null
  onSelectFacility: (f: Facility) => void
  corridors: Corridor[]
  corridorStatuses: Record<string, 'clear' | 'degraded' | 'blocked'>
  activeScenario: Scenario | null
  powerStressGeoJSON: any | null
}

function FlyToSelected({ facility }: { facility: Facility | null }) {
  const map = useMap()
  const prev = useRef<string | null>(null)
  useEffect(() => {
    if (facility && facility.id !== prev.current) {
      map.flyTo([facility.latitude, facility.longitude], 14, { duration: 0.8 })
      prev.current = facility.id
    }
  }, [facility, map])
  return null
}

function zoneStyle(feature: any) {
  const type = feature?.properties?.risk_type ?? 'flood'
  return {
    fillColor: ZONE_RISK_FILL[type] ?? 'rgba(100,100,100,0.1)',
    color: ZONE_RISK_BORDER[type] ?? '#888',
    weight: 1.5,
    fillOpacity: 1,
  }
}

function onEachZone(feature: any, layer: any) {
  if (feature.properties) {
    const { name, risk_type, severity, description } = feature.properties
    layer.bindTooltip(
      `<div style="font-size:11px;max-width:200px">
        <strong>${name}</strong><br/>
        <span style="color:#64748b">${risk_type.replace('_', ' ')} · ${severity}</span><br/>
        <span style="color:#374151">${description}</span>
      </div>`,
      { sticky: true }
    )
  }
}

function powerStressStyle(feature: any) {
  const color = feature?.properties?.color ?? '#94a3b8'
  return { fillColor: color, color: color, weight: 1, fillOpacity: 0.35 }
}

function onEachPowerZone(feature: any, layer: any) {
  const { zone, stress_score, tier, thermal_load_index, outage_frequency_score, demand_index } = feature.properties ?? {}
  layer.bindTooltip(
    `<div style="font-size:11px;max-width:200px">
      <strong>⚡ ${zone}</strong><br/>
      <span style="color:#64748b">Power stress ${tier} · ${stress_score}/100</span><br/>
      <span style="color:#374151">Thermal ${thermal_load_index} · Outage freq ${outage_frequency_score} · Demand ${demand_index}</span>
    </div>`,
    { sticky: true }
  )
}

export function MapView({ facilities, powerAssets, riskZones, layers, selectedFacility, onSelectFacility, corridors, corridorStatuses, activeScenario, powerStressGeoJSON }: Props) {
  // Build facilityMap for corridor lookup
  const facilityMap = Object.fromEntries(facilities.map(f => [f.id, f]))
  return (
    <div className="relative flex-1 h-full">
      <MapContainer
        center={BENGALURU_CENTER}
        zoom={11}
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
      >
        {/* Carto Dark Matter — free, no API key, professional dark map */}
        <TileLayer
          attribution='&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />

        {/* NASA GIBS — VIIRS Thermal Anomalies (375m, near-real-time) */}
        {layers.satelliteThermal && (
          <TileLayer
            url={`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_Thermal_Anomalies_375m_All/default/${yesterday()}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`}
            attribution='NASA GIBS · VIIRS SNPP Thermal Anomalies'
            opacity={0.85}
            maxZoom={9}
          />
        )}

        {/* NASA GIBS — MODIS Flood Detection (3-day composite) */}
        {layers.satelliteFlood && (
          <TileLayer
            url={`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Combined_MCDWD_NearRealTime_3Day/default/${yesterday()}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`}
            attribution='NASA GIBS · MODIS Flood Detection'
            opacity={0.7}
            maxZoom={9}
          />
        )}

        {/* NASA GIBS — VIIRS Night Lights (power outage / infrastructure proxy) */}
        {layers.nightLights && (
          <TileLayer
            url={`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_DayNightBand_AtSensor_M15/default/${yesterday()}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`}
            attribution='NASA GIBS · VIIRS Day/Night Band'
            opacity={0.8}
            maxZoom={9}
          />
        )}

        {/* Risk zones GeoJSON */}
        {riskZones && layers.floodZones && (
          <GeoJSON
            key="flood"
            data={{
              ...riskZones,
              features: riskZones.features.filter((f: any) => f.properties.risk_type === 'flood'),
            }}
            style={zoneStyle}
            onEachFeature={onEachZone}
          />
        )}
        {riskZones && layers.waterStress && (
          <GeoJSON
            key="water"
            data={{
              ...riskZones,
              features: riskZones.features.filter((f: any) => f.properties.risk_type === 'water_stress'),
            }}
            style={zoneStyle}
            onEachFeature={onEachZone}
          />
        )}
        {riskZones && layers.roadAccess && (
          <GeoJSON
            key="road"
            data={{
              ...riskZones,
              features: riskZones.features.filter((f: any) => f.properties.risk_type === 'road_access'),
            }}
            style={zoneStyle}
            onEachFeature={onEachZone}
          />
        )}
        {riskZones && layers.heatZones && (
          <GeoJSON
            key="heat"
            data={{
              ...riskZones,
              features: riskZones.features.filter((f: any) => f.properties.risk_type === 'heat'),
            }}
            style={zoneStyle}
            onEachFeature={onEachZone}
          />
        )}

        {/* Power stress choropleth */}
        {layers.powerStress && powerStressGeoJSON && (
          <GeoJSON
            key={`power-stress-${Date.now()}`}
            data={powerStressGeoJSON}
            style={powerStressStyle}
            onEachFeature={onEachPowerZone}
          />
        )}

        {/* Power assets — amber glow matching OpenGridWorks substation style */}
        {layers.powerAssets && powerAssets.map((pa) => (
          <CircleMarker
            key={pa.id}
            center={[pa.latitude, pa.longitude]}
            radius={8}
            pathOptions={{
              color: '#f59e0b',
              fillColor: '#fbbf24',
              fillOpacity: 0.92,
              weight: 2,
            }}
          >
            <Popup>
              <div className="text-xs">
                <strong>⚡ {pa.name}</strong><br />
                {pa.asset_type} · {pa.zone}<br />
                {pa.capacity_mva && <span>Capacity: {pa.capacity_mva} MVA<br /></span>}
                {pa.feeder_count && <span>Feeders: {pa.feeder_count}<br /></span>}
                {pa.reliability_score && <span>Reliability: {pa.reliability_score}/100</span>}
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {/* Ghost ambulance corridors */}
        <GhostCorridorLayer
          corridors={corridors}
          facilityMap={facilityMap}
          corridorStatuses={corridorStatuses}
          visible={layers.ghostCorridors}
        />

        {/* Facilities */}
        {layers.facilities && facilities.map((f) => {
          const color = RISK_COLORS[f.risk_level]
          const isSelected = selectedFacility?.id === f.id
          const isCritical = f.risk_level === 'Critical'
          const isScenarioAffected = activeScenario?.overrides.some(o => o.facilityId === f.id)
          const scenarioNote = activeScenario?.overrides.find(o => o.facilityId === f.id)?.event_label
          // Larger, glowing markers on dark map — Critical = bigger + bright border
          const radius = isSelected ? 14 : isCritical ? 11 : isScenarioAffected ? 10 : 8
          return (
            <CircleMarker
              key={f.id}
              center={[f.latitude, f.longitude]}
              radius={radius}
              pathOptions={{
                color: isSelected ? '#60a5fa' : isScenarioAffected ? '#fff' : isCritical ? '#ff6b6b' : color,
                fillColor: color,
                fillOpacity: isCritical ? 0.95 : isScenarioAffected ? 1 : 0.88,
                weight: isSelected ? 3 : isCritical ? 2.5 : isScenarioAffected ? 2.5 : 1.5,
              }}
              eventHandlers={{ click: () => onSelectFacility(f) }}
            >
              <Popup>
                <div style={{ fontSize: '11px', maxWidth: '240px' }}>
                  <div style={{ fontWeight: 700, marginBottom: 2, fontSize: 12 }}>
                    {facilityTypeIcon(f.facility_type)} {f.name}
                  </div>
                  <div style={{ color: '#64748b', marginBottom: 4 }}>
                    {formatFacilityType(f.facility_type)} · {f.zone}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{f.continuity_risk_score}</span>
                    <span style={{ background: color, color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
                      {f.risk_level}
                    </span>
                  </div>
                  {/* Plain-English summary */}
                  <div style={{ color: '#4b5563', fontSize: 10, marginBottom: scenarioNote ? 4 : 0, lineHeight: 1.4 }}>
                    {generateBriefNarrative(f)}
                  </div>
                  {/* Scenario event note */}
                  {scenarioNote && (
                    <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 4, padding: '4px 6px', fontSize: 10, color: '#92400e', marginTop: 3, lineHeight: 1.4 }}>
                      ⚡ {scenarioNote}
                    </div>
                  )}
                  <div style={{ marginTop: 5, color: '#9ca3af', fontSize: 10 }}>Click for full risk card →</div>
                </div>
              </Popup>
            </CircleMarker>
          )
        })}

        <FlyToSelected facility={selectedFacility} />
      </MapContainer>

      <ScoreLegend />
    </div>
  )
}
