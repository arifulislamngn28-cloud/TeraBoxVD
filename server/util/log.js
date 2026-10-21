/** Tiny structured logger — readable in a terminal, JSON in production. */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const current = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 20;

function ts() {
  return new Date().toISOString();
}

function emit(level, msg, extra) {
  if (LEVELS[level] < current) return;
  const line = `${ts()} ${level.toUpperCase().padEnd(5)} ${msg}`;
  if (extra && Object.keys(extra).length) {
    if (process.env.LOG_JSON === '1') {
      console.log(JSON.stringify({ ts: ts(), level, msg, ...extra }));
    } else {
      console.log(line, extra);
    }
  } else {
    console.log(line);
  }
}

module.exports = {
  debug: (m, e) => emit('debug', m, e),
  info: (m, e) => emit('info', m, e),
  warn: (m, e) => emit('warn', m, e),
  error: (m, e) => emit('error', m, e),
};
