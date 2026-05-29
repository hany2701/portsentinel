export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const [straitRes, sgRes, sgStraitRes] = await Promise.all([
      fetch('https://marine-api.open-meteo.com/v1/marine?latitude=4.0&longitude=100.0&current=wave_height,wind_speed_10m,swell_wave_height&wind_speed_unit=kmh'),
      fetch('https://api.open-meteo.com/v1/forecast?latitude=1.3521&longitude=103.8198&current=wind_speed_10m,precipitation,weathercode&wind_speed_unit=kmh'),
      fetch('https://marine-api.open-meteo.com/v1/marine?latitude=1.15&longitude=104.0&current=wave_height,wind_speed_10m,swell_wave_height&wind_speed_unit=kmh')
    ])

    const strait = await straitRes.json()
    const sg = await sgRes.json()
    const sgStrait = await sgStraitRes.json()

    res.json({
      strait: {
        wind_kmh: Math.round(strait.current.wind_speed_10m),
        wave_m:   Number(strait.current.wave_height.toFixed(1)),
        swell_m:  Number(strait.current.swell_wave_height.toFixed(1))
      },
      sg: {
        wind_kmh:      Math.round(sg.current.wind_speed_10m),
        precipitation: Number(sg.current.precipitation.toFixed(1)),
        weatherCode:   sg.current.weathercode
      },
      sgStrait: {
        wind_kmh: Math.round(sgStrait.current.wind_speed_10m),
        wave_m:   Number(sgStrait.current.wave_height.toFixed(1)),
        swell_m:  Number(sgStrait.current.swell_wave_height.toFixed(1))
      },
      stale: false,
      fetchedAt: new Date().toISOString()
    })
  } catch (err) {
    res.status(200).json({ stale: true, error: err.message })
  }
}
