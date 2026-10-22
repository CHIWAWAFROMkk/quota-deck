/** Probe facts only: notification state, foreground executable/path and monitor coverage. */
function isGaming(fact, games) {
  if (!fact || !Number.isFinite(fact.notification) || typeof fact.exe !== 'string'
    || typeof fact.path !== 'string' || typeof fact.covers !== 'boolean') return false;
  if (fact.notification === 3) return true;
  if (!fact.covers) return false;
  return fact.path.toLowerCase().includes('\\steamapps\\common\\')
    || (Array.isArray(games) && games.some(exe => typeof exe === 'string' && exe.toLowerCase() === fact.exe.toLowerCase()));
}

module.exports = { isGaming };
