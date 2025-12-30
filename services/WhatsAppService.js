import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import pino from "pino";
import { EventEmitter } from "events";

/**
 * Servicio de WhatsApp usando Baileys
 */
export class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.sock = null;
    this.qrAttempts = 0;
    this.maxQrAttempts = 5;
    this.isReady = false;

    // Logger de Baileys (silencioso para producción)
    this.logger = pino({ level: "silent" });
  }

  /**
   * Inicia la conexión con WhatsApp
   */
  async connect() {
    try {
      const { state, saveCreds } =
        await useMultiFileAuthState("auth_info_baileys");
      const { version } = await fetchLatestBaileysVersion();

      this.sock = makeWASocket({
        version,
        logger: this.logger,
        printQRInTerminal: false, // Lo haremos manualmente
        auth: state,
        markOnlineOnConnect: true,
        browser: ["Antenas IPSP", "Chrome", "1.0.0"], // Nombre personalizado
      });

      // Manejar credenciales
      this.sock.ev.on("creds.update", saveCreds);

      // Manejar actualizaciones de conexión
      this.sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Mostrar QR si está disponible
        if (qr) {
          this.qrAttempts++;
          console.log("\n" + "═".repeat(60));
          console.log("📱 ESCANEA EL CÓDIGO QR CON WHATSAPP");
          console.log("═".repeat(60));
          qrcode.generate(qr, { small: true });
          console.log("═".repeat(60));
          console.log(`Intento ${this.qrAttempts}/${this.maxQrAttempts}`);
          console.log("═".repeat(60) + "\n");

          if (this.qrAttempts >= this.maxQrAttempts) {
            console.log("⚠️  Máximo de intentos alcanzado. Reiniciando...");
            this.qrAttempts = 0;
          }
        }

        // Manejar conexión establecida
        if (connection === "open") {
          this.isReady = true;
          this.qrAttempts = 0;
          console.log("\n✅ WhatsApp conectado exitosamente\n");
          this.emit("ready");
        }

        // Manejar desconexión
        if (connection === "close") {
          this.isReady = false;
          const shouldReconnect =
            lastDisconnect?.error?.output?.statusCode !==
            DisconnectReason.loggedOut;

          console.log(
            "❌ Conexión cerrada. Reconectando:",
            shouldReconnect ? "Sí" : "No (sesión cerrada)",
          );

          if (shouldReconnect) {
            setTimeout(() => this.connect(), 3000);
          } else {
            this.emit("logout");
            console.log(
              "⚠️  Sesión cerrada. Elimina la carpeta 'auth_info' y vuelve a escanear el QR",
            );
          }
        }
      });

      // Manejar mensajes (opcional, para respuestas automáticas)
      this.sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.key.fromMe && msg.message) {
          this.emit("message", msg);
        }
      });
    } catch (error) {
      console.error("Error al conectar WhatsApp:", error);
      this.emit("error", error);
      setTimeout(() => this.connect(), 5000);
    }
  }

  /**
   * Formatea un número de teléfono para WhatsApp
   * @param {string} number - Número en formato internacional sin +
   * @returns {string} - Número formateado para Baileys
   */
  formatNumber(number) {
    // Remover caracteres no numéricos
    let cleaned = number.replace(/\D/g, "");

    // Si no tiene código de país, asumir Ecuador (+593)
    if (!cleaned.startsWith("593") && cleaned.length <= 9) {
      cleaned = "593" + cleaned;
    }

    return cleaned + "@s.whatsapp.net";
  }

  /**
   * Envía un mensaje de texto
   * @param {string} to - Número de destino (ej: "593912345678")
   * @param {string} message - Mensaje a enviar
   */
  async sendMessage(to, message) {
    if (!this.isReady) {
      console.log("⚠️  WhatsApp no está conectado. Mensaje no enviado.");
      return false;
    }

    try {
      const jid = this.formatNumber(to);
      await this.sock.sendMessage(jid, { text: message });
      console.log(`✅ Mensaje enviado a ${to}`);
      return true;
    } catch (error) {
      console.error(`❌ Error enviando mensaje a ${to}:`, error.message);
      return false;
    }
  }

  /**
   * Envía un mensaje a múltiples destinatarios
   * @param {string[]} recipients - Array de números
   * @param {string} message - Mensaje a enviar
   */
  async sendBroadcast(recipients, message) {
    if (!this.isReady) {
      console.log("⚠️  WhatsApp no está conectado. Mensajes no enviados.");
      return [];
    }

    const results = [];
    for (const recipient of recipients) {
      try {
        await this.sendMessage(recipient, message);
        results.push({ recipient, success: true });
      } catch (error) {
        results.push({ recipient, success: false, error: error.message });
      }
      // Pequeña pausa entre mensajes para evitar límites
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return results;
  }

  /**
   * Verifica si WhatsApp está listo
   */
  isConnected() {
    return this.isReady;
  }

  /**
   * Cierra la conexión
   */
  async disconnect() {
    if (this.sock) {
      await this.sock.logout();
      this.isReady = false;
    }
  }
}
