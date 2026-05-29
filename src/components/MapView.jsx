import { MapContainer, TileLayer, CircleMarker, Rectangle, Polygon, Popup } from 'react-leaflet'
import { WAITING_ANCHORAGE } from '../utils/vesselClassifier'
import geoData from '../data/port-zones.json'

const STATUS_COLOURS = {
  berthed:     '#1D9E75',
  waiting:     '#BA7517',
  manoeuvring: '#378ADD',
  transiting:  '#888780'
}

// GeoJSON uses [lon, lat] — Leaflet needs [lat, lon]
function toLeaflet(ring) {
  return ring.map(([lon, lat]) => [lat, lon])
}

// Extract terminal polygons from GeoJSON once at module load
const tuasPositions = (() => {
  const f = geoData.features.find(f => f.properties.id === 'tuas-terminal')
  return f ? toLeaflet(f.geometry.coordinates[0]) : []
})()

const REFERENCE_TERMINALS = geoData.features
  .filter(f => f.geometry.type === 'Polygon' && f.properties.id !== 'tuas-terminal')
  .map(f => ({ name: f.properties.name, positions: toLeaflet(f.geometry.coordinates[0]) }))

export default function MapView({ vessels, metrics, sim, aisConnected }) {
  const berthedCount    = vessels.filter(v => v.status === 'berthed').length
  const waitingCount    = vessels.filter(v => v.status === 'waiting').length
  const transitingCount = vessels.filter(v => v.status === 'transiting').length

  const avgOcc = Math.round(
    Object.values(metrics.berthOccupancy).reduce((a, b) => a + b, 0) / 5
  )
  const tuasColour = avgOcc >= 85 ? '#E24B4A' : avgOcc >= 70 ? '#BA7517' : '#1D9E75'

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 56px)' }}>
      <MapContainer
        center={[1.270, 103.72]}
        zoom={11}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />

        {/* Waiting anchorage zone */}
        <Rectangle
          bounds={[
            [WAITING_ANCHORAGE.latMin, WAITING_ANCHORAGE.lonMin],
            [WAITING_ANCHORAGE.latMax, WAITING_ANCHORAGE.lonMax]
          ]}
          pathOptions={{ color: '#BA7517', fillColor: '#BA7517', fillOpacity: 0.06, weight: 1.5, dashArray: '6 4' }}
        >
          <Popup>
            <strong>Western anchorage</strong><br />
            {metrics.waitingCount} vessels waiting<br />
            Est. berth wait: {metrics.effectiveBerthWait}h
          </Popup>
        </Rectangle>

        {/* Tuas Mega Port — actual GeoJSON polygon, coloured by occupancy */}
        {tuasPositions.length > 0 && (
          <Polygon
            positions={tuasPositions}
            pathOptions={{ color: tuasColour, fillColor: tuasColour, fillOpacity: 0.15, weight: 2 }}
          >
            <Popup>
              <strong>Tuas Mega Port</strong><br />
              T1: {metrics.berthOccupancy.T1}% &nbsp;T2: {metrics.berthOccupancy.T2}% &nbsp;T3: {metrics.berthOccupancy.T3}%<br />
              T4: {metrics.berthOccupancy.T4}% &nbsp;T5: {metrics.berthOccupancy.T5}%<br />
              Avg occupancy: {avgOcc}%<br />
              Status: {avgOcc >= 85 ? 'Critical' : avgOcc >= 70 ? 'High' : 'Normal'}
            </Popup>
          </Polygon>
        )}

        {/* Reference terminals — visual only, grey dashed outlines */}
        {REFERENCE_TERMINALS.map(({ name, positions }) => (
          <Polygon
            key={name}
            positions={positions}
            pathOptions={{ color: '#9ca3af', fillColor: '#9ca3af', fillOpacity: 0.08, weight: 1.5, dashArray: '4 3' }}
          >
            <Popup>
              <strong>{name}</strong><br />
              <span style={{ color: '#6b7280', fontSize: 11 }}>Reference terminal — visual only</span>
            </Popup>
          </Polygon>
        ))}

        {/* Vessel dots */}
        {vessels.map(v => {
          const minsAgo = Math.round((Date.now() - v.updatedAt) / 60000)
          const lastSeen = minsAgo < 1 ? 'just now' : `${minsAgo} min ago`
          const heading = v.heading != null && v.heading !== 511 ? `${v.heading}°` : '—'
          return (
            <CircleMarker
              key={v.mmsi}
              center={[v.lat, v.lon]}
              radius={v.status === 'berthed' ? 5 : v.status === 'waiting' ? 7 : 4}
              pathOptions={{
                color: STATUS_COLOURS[v.status] ?? '#888780',
                fillColor: STATUS_COLOURS[v.status] ?? '#888780',
                fillOpacity: 0.85,
                weight: 1
              }}
            >
              <Popup>
                <strong>{v.name}</strong><br />
                Status: <span style={{ textTransform: 'capitalize' }}>{v.status}</span><br />
                Speed: {v.sog.toFixed(1)} knots<br />
                Heading: {heading}<br />
                Location: {v.location}<br />
                MMSI: {v.mmsi}<br />
                Last seen: {lastSeen}
              </Popup>
            </CircleMarker>
          )
        })}
      </MapContainer>

      {/* Floating stats overlay — top right */}
      <div style={{
        position: 'absolute', top: 16, right: 16, zIndex: 1000,
        background: 'white', border: '0.5px solid #e5e7eb', borderRadius: 10,
        padding: '14px 18px', minWidth: 160, boxShadow: '0 1px 4px rgba(0,0,0,0.08)'
      }}>
        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 10, fontWeight: 500 }}>Live summary</div>

        <div style={{ fontSize: 13, marginBottom: 6 }}>
          <span style={{ color: '#6b7280' }}>Risk score </span>
          <strong style={{ color: metrics.riskScore >= 85 ? '#dc2626' : metrics.riskScore >= 70 ? '#ea580c' : metrics.riskScore >= 40 ? '#d97706' : '#16a34a' }}>
            {metrics.riskScore} — {metrics.riskLevel}
          </strong>
        </div>

        <div style={{ fontSize: 13, marginBottom: 6 }}>
          <span style={{ color: '#6b7280' }}>Berth wait </span>
          <strong>{metrics.effectiveBerthWait}h</strong>
        </div>

        <div style={{ fontSize: 13, marginBottom: 12 }}>
          <span style={{ color: '#6b7280' }}>Inventory </span>
          <strong style={{ color: sim.inventoryDays < 3 ? '#dc2626' : '#16a34a' }}>
            {sim.inventoryDays.toFixed(1)} days
          </strong>
        </div>

        <div style={{ borderTop: '0.5px solid #f3f4f6', paddingTop: 10 }}>
          {[['berthed', '#1D9E75', berthedCount], ['waiting', '#BA7517', waitingCount], ['transiting', '#888780', transitingCount]].map(([status, colour, count]) => (
            <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: colour, flexShrink: 0 }} />
              <span style={{ color: '#6b7280', textTransform: 'capitalize', flex: 1 }}>{status}</span>
              <strong>{count}</strong>
            </div>
          ))}
        </div>

        {!aisConnected && (
          <div style={{ marginTop: 10, padding: '6px 8px', background: '#fef3c7', borderRadius: 6, fontSize: 11, color: '#92400e' }}>
            AIS offline — no vessel data
          </div>
        )}
      </div>

      {/* Legend — bottom left */}
      <div style={{
        position: 'absolute', bottom: 24, left: 16, zIndex: 1000,
        background: 'white', border: '0.5px solid #e5e7eb', borderRadius: 8, padding: '10px 14px'
      }}>
        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8, fontWeight: 500 }}>Map legend</div>
        {[
          ['Berthed vessel',       '#1D9E75'],
          ['Waiting vessel',       '#BA7517'],
          ['Transiting vessel',    '#888780'],
          ['Tuas Mega Port',       '#1D9E75'],
          ['Reference terminals',  '#9ca3af'],
          ['Anchorage zone',       '#BA7517']
        ].map(([label, colour]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#374151', marginBottom: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: colour, flexShrink: 0, opacity: 0.85 }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}
