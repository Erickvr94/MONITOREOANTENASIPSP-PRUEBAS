import { EventEmitter } from "events";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import express from "express";
import cors from "cors";
import logger from "../utils/logger.js";

const WS_PORT = parseInt(process.env.WS_PORT) || 3000;

export class WebSocketService extends EventEmitter {
  constructor() {
    super();
    this.clients = new Set();
    this.app = express();
    this.app.use(
      cors({
        origin: function (origin, callback) {
          // Permitir peticiones sin origin (como Postman o Server-to-Server)
          if (!origin) return callback(null, true);

          const isLocalhost = allowedOrigins.includes(origin);
          const isSubnet148 = origin.startsWith("http://192.168.148.");

          if (isLocalhost || isSubnet148) {
            callback(null, true);
          } else {
            callback(new Error("Bloqueado por CORS: Origen no permitido"));
          }
        },
        credentials: true,
      }),
    );
    this.app.use(express.json());
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this._setupHandlers();
  }

  /**
   * Monta un router de Express en una ruta base.
   * @param {string} path
   * @param {Router} router
   */
  use(path, router) {
    this.app.use(path, router);
  }

  _setupHandlers() {
    this.wss.on("connection", (ws, req) => {
      const clientIp = req.socket.remoteAddress;
      logger.info(`[WS] Cliente conectado: ${clientIp}`);
      this.clients.add(ws);

      // Emitir evento para que index.js envíe el estado completo al nuevo cliente
      this.emit("client_connected", ws);

      ws.on("close", () => {
        this.clients.delete(ws);
        logger.info(`[WS] Cliente desconectado: ${clientIp}`);
      });

      ws.on("error", (err) => {
        logger.error(`[WS] Error de cliente: ${err.message}`);
        this.clients.delete(ws);
      });
    });
  }

  /**
   * Envía un mensaje a todos los clientes conectados.
   * @param {object} data
   */
  broadcast(data) {
    const message = JSON.stringify(data);
    let sent = 0;
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
        sent++;
      }
    }
    if (sent > 0) logger.debug(`[WS] Broadcast enviado a ${sent} cliente(s)`);
  }

  /**
   * Envía un mensaje a un cliente específico.
   * @param {WebSocket} ws
   * @param {object} data
   */
  sendToClient(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server.listen(WS_PORT, () => {
        logger.info(`[WS] Servidor escuchando en ws://localhost:${WS_PORT}`);
        resolve();
      });
      this.server.on("error", reject);
    });
  }
}
