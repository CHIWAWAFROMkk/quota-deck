function returnUrl(alert) {
  if (!alert || alert.returnable !== true || typeof alert.sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(alert.sessionId)) return null;
  if (alert.vendor === 'claude') return `vscode://anthropic.claude-code/open?session=${alert.sessionId}`;
  if (alert.vendor === 'codex') return `codex://threads/${alert.sessionId}`;
  return null;
}

module.exports = { returnUrl };
