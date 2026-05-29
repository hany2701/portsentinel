const SEGMENTS = {
  High:   5,
  Medium: 3,
  Low:    1
}

export default function Confidence({ confidence, conflicts }) {
  const filled = confidence ? (SEGMENTS[confidence.level] ?? 0) : 0

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-sm font-semibold text-gray-800 mb-3">Data confidence</div>

      <div className="flex gap-1 mb-2">
        {[1, 2, 3, 4, 5].map(i => (
          <div
            key={i}
            className={`flex-1 h-2.5 rounded-sm ${i <= filled ? 'bg-green-500' : 'bg-gray-100'}`}
          />
        ))}
      </div>

      {confidence ? (
        <div className="mb-3">
          <span className="text-xs font-semibold text-gray-700">{confidence.level}</span>
          <p className="text-xs text-gray-500 mt-0.5">{confidence.reason}</p>
        </div>
      ) : (
        <p className="text-xs text-gray-400 mb-3">No AI assessment yet</p>
      )}

      <div className="space-y-1">
        {conflicts.length === 0 ? (
          <p className="text-xs text-green-600">All data sources consistent</p>
        ) : (
          conflicts.map((c, i) => (
            <div key={i} className="flex gap-1.5 text-xs text-amber-700">
              <span className="mt-0.5 shrink-0">▲</span>
              <span>{c}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
