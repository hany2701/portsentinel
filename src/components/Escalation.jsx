export default function Escalation({ onGenerate, escalationBrief, escalationLoading }) {
  function copyBrief() {
    if (escalationBrief) navigator.clipboard.writeText(escalationBrief)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg flex flex-col h-80">
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-800">Escalation Brief</span>
        {escalationBrief && (
          <button
            onClick={copyBrief}
            className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded px-2 py-1"
          >
            Copy
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!escalationBrief && !escalationLoading && (
          <p className="text-xs text-gray-400 leading-relaxed">
            Generates a formal escalation brief for the logistics director — includes incident summary, current conditions, recommended action, and required approvals.
          </p>
        )}
        {escalationLoading && (
          <div className="space-y-2">
            {[100, 80, 90, 70, 85].map((w, i) => (
              <div key={i} className={`h-2.5 bg-gray-100 rounded animate-pulse`} style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
        {escalationBrief && !escalationLoading && (
          <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
            {escalationBrief}
          </pre>
        )}
      </div>

      <div className="px-4 py-3 border-t border-gray-100">
        <button
          onClick={onGenerate}
          disabled={escalationLoading}
          className="w-full text-xs text-red-600 border border-red-300 rounded-md py-2 hover:bg-red-50 transition-colors disabled:opacity-40"
        >
          {escalationLoading ? 'Generating...' : 'Generate Escalation Brief'}
        </button>
      </div>
    </div>
  )
}
