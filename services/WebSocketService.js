import { EventEmitter } from "events";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import express from "express";
import cors from "cors";
import logger from "../utils/logger.js";
import { requireInternalToken } from "../middleware/authMiddleware.js";

const WS_PORT = parseInt(process.env.WS_PORT) || 3000;
// HOST: "127.0.0.1" solo local (default seguro) | "0.0.0.0" para exponer en la red
const WS_HOST = process.env.WS_HOST || "127.0.0.1";
// CORS_ORIGIN: orígenes permitidos separados por coma, o * para todos
const CORS_ORIGIN =
  !process.env.CORS_ORIGIN || process.env.CORS_ORIGIN.trim() === "*"
    ? "*"
    : process.env.CORS_ORIGIN.split(",").map((o) => o.trim());

export class WebSocketService extends EventEmitter {
  constructor() {
    super();
    this.clients = new Set();
    this.app = express();
    this.app.use(cors({ origin: CORS_ORIGIN }));
    this.app.use(express.json());
    this.app.use("/api", requireInternalToken);
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    this._setupHandlers();
  }

  use(path, router) {
    this.app.use(path, router);
  }

  _setupHandlers() {
    this.wss.on("connection", (ws, req) => {
      const clientIp = req.socket.remoteAddress;

      const tokenQuery = new URL(req.url, "http://localhost").searchParams.get("token");
      const token = req.headers["x-internal-token"] ?? tokenQuery;

      if (token !== process.env.INTERNAL_TOKEN) {
        logger.warn(`[WS] Conexión rechazada (token inválido): ${clientIp}`);
        ws.close(1008, "No autorizado");
        return;
      }

      logger.info(`[WS] Cliente conectado: ${clientIp} — esperando suscripción`);
      this.clients.add(ws);

      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.accion === "suscribir" && typeof msg.finca === "string") {
            ws.finca = msg.finca;
            logger.info(`[WS] Cliente ${clientIp} suscrito a finca "${msg.finca}"`);
            this.emit("client_subscribed", ws, msg.finca);
          }
        } catch {
          logger.warn(`[WS] Mensaje inválido de ${clientIp}`);
        }
      });

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
   * Envía un mensaje solo a los clientes suscritos a una finca específica.
   * @param {string} finca
   * @param {object} data
   */
  broadcastToFinca(finca, data) {
    const message = JSON.stringify(data);
    let sent = 0;
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN && client.finca === finca) {
        client.send(message);
        sent++;
      }
    }
    if (sent > 0)
      logger.debug(`[WS] Broadcast finca "${finca}" → ${sent} cliente(s)`);
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
      this.server.listen(WS_PORT, WS_HOST, () => {
        logger.info(`[WS] Servidor escuchando en ws://${WS_HOST}:${WS_PORT}`);
        resolve();
      });
      this.server.on("error", reject);
    });
  }
}