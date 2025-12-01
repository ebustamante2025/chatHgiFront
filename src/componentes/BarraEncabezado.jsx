// src/components/BarraEncabezado.jsx
import React from "react";
import { chatStyles as styles } from "../styles/chatStyles";

export function BarraEncabezado({ usuario, estadoWs, onLogout }) {
  const etiquetaWs =
    estadoWs === "connected"
      ? "Conectado al servidor"
      : estadoWs === "connecting"
      ? "Conectando..."
      : "Desconectado (reintentando...)";

  return (
    <header style={styles.encabezado}>
      <div>💬 Chat HGI (Multiusuario)</div>
      <div style={{ fontSize: 12, opacity: 0.9 }}>{etiquetaWs}</div>
      <div>
        Conectado como <strong>{usuario.username}</strong>{" "}
        <button onClick={onLogout} style={styles.botonSecundario}>
          Cerrar sesión
        </button>
      </div>
    </header>
  );
}
