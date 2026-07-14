import fs from "fs/promises";
import path from "path";
import { consultarSNMP } from "./SNMPService.js";

let coordenadas = {};

export async function cargarCoordenadas(fincaId) {
    const archivo = path.join(
        "config",
        "fincas",
        fincaId,
        "coordenadas.json"
    );
    coordenadas = JSON.parse(
        await fs.readFile(archivo, "utf8")
    );
    console.log(`Coordenadas cargadas: ${Object.keys(coordenadas).length}`);

}

export async function generarMapa(direccionesIP) {
    const antenas = [];
    for (const [grupo, dispositivos] of Object.entries(direccionesIP)) {
        for (const [nombre, info] of Object.entries(dispositivos)) {
            const snmp = await consultarSNMP(info.IP, info.OID);
            const coord = coordenadas[nombre];
            antenas.push({
                id: nombre,
                nombre,
                grupo,
                ip: info.IP,
                ubicacion: info.Ubicacion,
                coordenadas: {
                    lat: coord?.lat ?? null,
                    lon: coord?.lon ?? null
                },
                estado: {
                    online: snmp.online,
                    potencia: snmp.potencia,
                    fecha: snmp.fecha
                }
            });
        }
    }
    return antenas;
}