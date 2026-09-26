// Renderer logger: forwards to the main process so all logs appear in one
// terminal as "[Pet:renderer] scope: message". The main process applies the
// log level filter.

export function createLogger(scope) {
  const send = (level, parts) => {
    const message = `${scope}: ${parts.map(String).join(' ')}`;
    if (window.desktopPet) window.desktopPet.log(level, message);
    else console[level](`[Pet:renderer] ${message}`);
  };
  return {
    debug: (...parts) => send('debug', parts),
    info: (...parts) => send('info', parts),
    warn: (...parts) => send('warn', parts),
    error: (...parts) => send('error', parts),
  };
}
