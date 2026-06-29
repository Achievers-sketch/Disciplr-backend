/**
 * Minimal Jest mime shim providing both mime@1.x and mime@2.x APIs.
 * Avoids pnpm internal paths that conflict with Jest's moduleNameMapper.
 */
const types = {
  'application/json': ['json'],
  'text/html': ['html', 'htm'],
  'text/plain': ['txt'],
  'application/octet-stream': ['bin'],
  'multipart/form-data': [],
}

const extToType = Object.entries(types).reduce((acc, [type, exts]) => {
  exts.forEach((e) => { acc[e] = type })
  return acc
}, {})

// mime@2.x API
const getType = (ext) => extToType[ext.replace(/^\./, '')] ?? 'application/octet-stream'
const getExtension = (type) => (Object.entries(extToType).find(([, t]) => t === type) ?? [])[0] ?? null

// mime@1.x API
const lookup = (path) => {
  const ext = path.split('.').pop() ?? ''
  return extToType[ext] ?? 'application/octet-stream'
}

module.exports = Object.assign(Object.create(null), {
  // mime@2.x
  getType,
  getExtension,
  define: () => {},
  // mime@1.x (needed by send/Express)
  lookup,
  extension: getExtension,
  load: () => {},
  charsets: { lookup: () => false },
  Mime: function Mime() {},
})
