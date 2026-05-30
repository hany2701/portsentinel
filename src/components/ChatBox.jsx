import { useRef, useEffect, useState } from 'react'

function formatAssistantMessage(text) {
  return text.split('\n').map((line, i) => {
    if (!line.trim()) return <div key={i} style={{ height: 4 }} />
    if (/^\[[A-Z][A-Z\s\-]+\]$/.test(line)) {
      return (
        <div key={i} className="text-xs font-semibold text-blue-700 uppercase tracking-wide mt-3 first:mt-0">
          {line.slice(1, -1)}
        </div>
      )
    }
    if (/^\[.+\]$/.test(line)) {
      return (
        <div key={i} className="text-xs text-gray-500 border-t border-gray-200 pt-2 mt-2">{line}</div>
      )
    }
    return <p key={i} className="text-xs text-gray-700 leading-relaxed">{line}</p>
  })
}

export default function ChatBox({ chatHistory, onSend, aiLoading }) {
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory, aiLoading])

  function handleSend() {
    const msg = input.trim()
    if (!msg || aiLoading) return
    setInput('')
    onSend(msg)
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg flex flex-col h-80">
      <div className="px-4 py-2.5 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-800">AI Chat</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {chatHistory.length === 0 && (
          <p className="text-xs text-gray-400 text-center mt-4">Ask the AI about the current situation...</p>
        )}
        {chatHistory.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-3 py-2 rounded-lg ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white text-xs leading-relaxed'
                : 'bg-gray-100 text-gray-800'
            }`}>
              {msg.role === 'user' ? msg.content : formatAssistantMessage(msg.content)}
            </div>
          </div>
        ))}
        {aiLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 px-3 py-2 rounded-lg">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask about current conditions..."
          className="flex-1 text-xs border border-gray-200 rounded-md px-3 py-2 outline-none focus:border-blue-300"
        />
        <button
          onClick={handleSend}
          disabled={aiLoading || !input.trim()}
          className="text-xs bg-gray-900 text-white px-3 py-2 rounded-md disabled:opacity-40 hover:bg-gray-700 transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  )
}
