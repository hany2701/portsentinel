import { useEffect, useRef, useState } from 'react'
import { classifyVessel, isCargoVessel } from '../utils/vesselClassifier'

const WS_URL = 'wss://stream.aisstream.io/v0/stream'
const STALE_MS = 600_000 // 10 minutes

export function useAISStream() {
  const ws = useRef(null)
  const vesselMap = useRef({})
  const [vessels, setVessels] = useState([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    function connect() {
      ws.current = new WebSocket(WS_URL)

      ws.current.onopen = () => {
        setConnected(true)
        ws.current.send(JSON.stringify({
          Apikey: import.meta.env.VITE_AISSTREAM_KEY,
          BoundingBoxes: [[[1.15, 103.45], [1.45, 103.85]]],
          FilterMessageTypes: ['PositionReport', 'ShipStaticData']
        }))
      }

      ws.current.onmessage = async (event) => {
        const text = event.data instanceof Blob ? await event.data.text() : event.data
        const msg = JSON.parse(text)
        const mmsi = msg.MetaData?.MMSI
        if (!mmsi) return

        // ShipStaticData — update destination + accurate typeCode for known vessels
        const staticData = msg.Message?.ShipStaticData
        if (staticData) {
          if (vesselMap.current[mmsi]) {
            vesselMap.current[mmsi] = {
              ...vesselMap.current[mmsi],
              typeCode:    staticData.TypeOfShipAndCargo ?? vesselMap.current[mmsi].typeCode,
              destination: (staticData.Destination ?? '').trim().replace(/@/g, '').trim(),
              updatedAt:   Date.now()
            }
            setVessels(Object.values(vesselMap.current))
          }
          return
        }

        // PositionReport — primary vessel update
        const pos = msg.Message?.PositionReport
        if (!pos) return

        const typeCode = vesselMap.current[mmsi]?.typeCode ?? 70
        if (!isCargoVessel(typeCode) && !vesselMap.current[mmsi]) return

        const classification = classifyVessel(
          pos.Latitude, pos.Longitude, pos.Sog, pos.NavigationalStatus
        )

        vesselMap.current[mmsi] = {
          ...vesselMap.current[mmsi],  // preserve destination from ShipStaticData
          mmsi,
          name:      (msg.MetaData.ShipName ?? 'Unknown').trim(),
          lat:       pos.Latitude,
          lon:       pos.Longitude,
          sog:       pos.Sog,
          heading:   pos.TrueHeading,
          navStatus: pos.NavigationalStatus,
          typeCode,
          ...classification,
          updatedAt: Date.now()
        }

        // Prune stale vessels
        const now = Date.now()
        for (const key of Object.keys(vesselMap.current)) {
          if (now - vesselMap.current[key].updatedAt > STALE_MS) {
            delete vesselMap.current[key]
          }
        }

        setVessels(Object.values(vesselMap.current))
      }

      ws.current.onclose = () => {
        setConnected(false)
        setTimeout(connect, 5000)
      }

      ws.current.onerror = () => ws.current.close()
    }

    connect()
    return () => ws.current?.close()
  }, [])

  return { vessels, connected }
}
