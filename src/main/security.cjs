const { pathToFileURL } = require('node:url');
function isTrustedRenderer(url, entryPath) {
  return typeof url === 'string' && url === pathToFileURL(entryPath).href;
}
function validateProviderId(id, allowed) {
  if (typeof id !== 'string' || !allowed.includes(id)) throw new Error('未知服务商');
  return id;
}
module.exports = { isTrustedRenderer, validateProviderId };
