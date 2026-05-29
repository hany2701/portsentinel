const AGENTS = [
  { key: 'portOps',     name: 'Port Operations', abbr: 'PORT' },
  { key: 'maritime',    name: 'Maritime Risk',    abbr: 'MRT'  },
  { key: 'inventory',   name: 'Inventory',        abbr: 'INV'  },
  { key: 'costService', name: 'Cost-Service',     abbr: 'CST'  }
]

function Skeleton() {
  return (
    <div className="space-y-1.5 mt-1">
      <div className="h-2.5 bg-gray-100 rounded animate-pulse w-full" />
      <div className="h-2.5 bg-gray-100 rounded animate-pulse w-4/5" />
      <div className="h-2.5 bg-gray-100 rounded animate-pulse w-3/5" />
    </div>
  )
}

export default function AgentPanel({ agentSections, aiLoading }) {
  if (!agentSections && !aiLoading) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center justify-center min-h-[200px]">
        <p className="text-xs text-gray-400 text-center px-4">
          Ask a question or use the simulator to activate the agent panel
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
      {AGENTS.map(({ key, name, abbr }) => (
        <div key={key} className="border border-gray-100 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">{abbr}</span>
            <span className="text-xs font-semibold text-gray-700">{name}</span>
          </div>
          {aiLoading ? <Skeleton /> : (
            <p className="text-xs text-gray-600 leading-relaxed">{agentSections?.[key] ?? '—'}</p>
          )}
        </div>
      ))}

      <div className="border-2 border-gray-300 rounded-lg p-3 bg-gray-50">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-xs font-bold text-gray-800 bg-gray-200 px-1.5 py-0.5 rounded">CMD</span>
          <span className="text-xs font-bold text-gray-800">Incident Commander</span>
        </div>
        {aiLoading ? <Skeleton /> : (
          <>
            {agentSections?.escalation?.required && (
              <div className="mb-2 px-2 py-1 bg-red-100 border border-red-200 rounded text-xs text-red-700 font-medium">
                Escalation required
              </div>
            )}
            <p className="text-xs text-gray-700 leading-relaxed">{agentSections?.commander ?? '—'}</p>
          </>
        )}
      </div>
    </div>
  )
}
