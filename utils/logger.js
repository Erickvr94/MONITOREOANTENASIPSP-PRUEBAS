import pino from "pino";

/**
 * Logger centralizado usando Pino
 * Configuración optimizada para monitoreo de antenas
 */
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
      ignore: "pid,hostname",
      singleLine: false,
    },
  },
});

export default logger;
