export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const url = `https://api.currentsapi.services/v1/search?keywords=Malacca%20Strait%20OR%20Singapore%20port%20OR%20Tuas%20shipping&language=en&apiKey=${process.env.CURRENTS_API_KEY}`
    const response = await fetch(url)
    const data = await response.json()

    const articles = (data.news ?? []).slice(0, 3).map(a => ({
      title: a.title,
      url: a.url,
      publishedAt: a.published
    }))

    res.json({ articles })
  } catch (err) {
    res.json({ articles: [], error: err.message })
  }
}
