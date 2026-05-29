import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).end()

  const { wind_kmh, wave_m, swell_m, sg_wind_kmh } = req.body

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: `You are a maritime weather officer. Write exactly two sentences — a factual sea state summary and an operational advisory for vessels transiting the Malacca Strait. Use the exact numbers provided. Do not speculate beyond the data.

Current data: Malacca Strait wind ${wind_kmh} km/h, wave height ${wave_m}m, swell ${swell_m}m. Singapore wind ${sg_wind_kmh} km/h.`
      }]
    })
    res.json({ advisory: response.content[0].text })
  } catch (err) {
    res.status(500).json({
      error: err.message,
      status: err.status,
      body: err.error ?? null
    })
  }
}
