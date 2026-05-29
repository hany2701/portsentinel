import { useState, useEffect } from 'react'
import { useAISStream } from './hooks/useAISStream'
import { mapWeatherRisk } from './utils/weatherMapper'

export default function App() {
  const { vessels, connected } = useAISStream()

  const [weather, setWeather] = useState(null)
  const [news, setNews] = useState([])

  useEffect(() => {
    async function fetchWeather() {
      try {
        const res = await fetch('/api/weather')
        const data = await res.json()
        setWeather(data)
      } catch {
        setWeather(prev => prev ? { ...prev, stale: true } : null)
      }
    }
    fetchWeather()
    const interval = setInterval(fetchWeather, 15 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    async function fetchNews() {
      try {
        const res = await fetch('/api/news')
        const data = await res.json()
        setNews(data.articles ?? [])
      } catch {
        // silent fail
      }
    }
    fetchNews()
    const interval = setInterval(fetchNews, 30 * 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <h1 className="text-2xl font-bold text-gray-800">PortSentinel AI</h1>
    </div>
  )
}
