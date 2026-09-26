// Small leveled logger for the main process.
//
// Level is chosen once at startup:
//   PET_LOG_LEVEL=debug|info|warn|error|silent   (explicit, wins)
//   --dev flag                                   (defaults to debug)
//   otherwise                                    (info)
//
// Renderer logs are forwarded here over IPC so everything shows up in one terminal.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function resolveLevel() {
  const fromEnv = process.env.PET_LOG_LEVEL?.toLowerCase();
  if (fromEnv in LEVELS) return fromEnv;
  return process.argv.includes('--dev') ? 'debug' : 'info';
}

const activeLevel = resolveLevel();
const threshold = LEVELS[activeLevel];

export function isLogLevel(value) {
  return typeof value === 'string' && value in LEVELS && value !== 'silent';
}

export function createLogger(scope) {
  const prefix = `[Pet:${scope}]`;
  const write = (level, args) => {
    if (LEVELS[level] < threshold) return;
    const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    out(prefix, ...args);
  };
  return {
    debug: (...args) => write('debug', args),
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
  };
}

export const logLevel = activeLevel;
