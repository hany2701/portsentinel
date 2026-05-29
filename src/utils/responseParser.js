export function parseAgentResponse(text) {
  function extract(startTag, ...endTags) {
    const startIdx = text.indexOf(startTag)
    if (startIdx === -1) return null
    const contentStart = startIdx + startTag.length
    let endIdx = text.length
    for (const tag of endTags) {
      const idx = text.indexOf(tag, contentStart)
      if (idx !== -1 && idx < endIdx) endIdx = idx
    }
    return text.slice(contentStart, endIdx).trim()
  }

  const confidenceMatch = text.match(/\[CONFIDENCE: (High|Medium|Low) \| REASON: ([^\]]+)\]/)
  const escalationMatch = text.match(/\[ESCALATION: (Required|Not required) \| REASON: ([^\]]*)\]/)

  return {
    portOps:     extract('[PORT OPERATIONS]',    '[MARITIME RISK]', '[INVENTORY]', '[COST-SERVICE]', '[INCIDENT COMMANDER]', '[CONFIDENCE'),
    maritime:    extract('[MARITIME RISK]',       '[INVENTORY]', '[COST-SERVICE]', '[INCIDENT COMMANDER]', '[CONFIDENCE'),
    inventory:   extract('[INVENTORY]',           '[COST-SERVICE]', '[INCIDENT COMMANDER]', '[CONFIDENCE'),
    costService: extract('[COST-SERVICE]',        '[INCIDENT COMMANDER]', '[CONFIDENCE'),
    commander:   extract('[INCIDENT COMMANDER]',  '[CONFIDENCE'),
    confidence:  confidenceMatch
      ? { level: confidenceMatch[1], reason: confidenceMatch[2].trim() }
      : null,
    escalation:  escalationMatch
      ? { required: escalationMatch[1] === 'Required', reason: escalationMatch[2].trim() }
      : null
  }
}
