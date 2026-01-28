export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LoggerMode = 'cli' | 'web' | 'libdb';

interface LoggerConfig {
  mode: LoggerMode;
  level: LogLevel;
  silent: boolean;
  timestamp: boolean;
}

class Logger {
  private config: LoggerConfig = {
    mode: 'cli',
    level: 'info',
    silent: false,
    timestamp: false,
  };

  private levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  setMode(mode: LoggerMode) {
    this.config.mode = mode;
  }

  setLevel(level: LogLevel) {
    this.config.level = level;
  }

  setSilent(silent: boolean) {
    this.config.silent = silent;
  }

  setTimestamp(timestamp: boolean) {
    this.config.timestamp = timestamp;
  }

  getMode(): LoggerMode {
    return this.config.mode;
  }

  private shouldLog(level: LogLevel): boolean {
    if (this.config.silent) return false;
    return this.levelPriority[level] >= this.levelPriority[this.config.level];
  }

  private formatMessage(level: LogLevel, message: string, ...args: any[]): string {
    const timestamp = this.config.timestamp 
      ? `[${new Date().toISOString()}] ` 
      : '';
    
    const prefix = this.getModePrefix(level);
    
    const formattedArgs = args.length > 0 
      ? ' ' + args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ')
      : '';
    
    return `${timestamp}${prefix}${message}${formattedArgs}`;
  }

  private getModePrefix(level: LogLevel): string {
    const modeTag = this.config.mode === 'cli' ? '' : `[${this.config.mode.toUpperCase()}] `;
    
    switch (level) {
      case 'debug':
        return `${modeTag}[DEBUG] `;
      case 'info':
        return modeTag;
      case 'warn':
        return `${modeTag}⚠️  `;
      case 'error':
        return `${modeTag}❌ `;
      default:
        return modeTag;
    }
  }

  debug(message: string, ...args: any[]) {
    if (!this.shouldLog('debug')) return;
    console.debug(this.formatMessage('debug', message, ...args));
  }

  info(message: string, ...args: any[]) {
    if (!this.shouldLog('info')) return;
    console.info(this.formatMessage('info', message, ...args));
  }

  log(message: string, ...args: any[]) {
    this.info(message, ...args);
  }

  warn(message: string, ...args: any[]) {
    if (!this.shouldLog('warn')) return;
    console.warn(this.formatMessage('warn', message, ...args));
  }

  error(message: string, ...args: any[]) {
    if (!this.shouldLog('error')) return;
    console.error(this.formatMessage('error', message, ...args));
  }

  progress(current: number, total: number, message: string = '') {
    if (this.config.silent) return;
    if (this.config.mode === 'cli') {
      const percentage = Math.round((current / total) * 100);
      const bar = '█'.repeat(Math.floor(percentage / 2)) + '░'.repeat(50 - Math.floor(percentage / 2));
      process.stdout.write(`\r[${bar}] ${percentage}% ${message}`);
      if (current === total) {
        process.stdout.write('\n');
      }
    } else {
      this.info(`Progress: ${current}/${total} (${Math.round((current / total) * 100)}%) ${message}`);
    }
  }

  time(label: string) {
    console.time(this.formatMessage('info', label));
  }

  timeEnd(label: string) {
    console.timeEnd(this.formatMessage('info', label));
  }

  group(label: string) {
    if (this.config.silent) return;
    console.group(this.formatMessage('info', label));
  }

  groupEnd() {
    if (this.config.silent) return;
    console.groupEnd();
  }
}

export const logger = new Logger();
