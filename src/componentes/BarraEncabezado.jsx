// src/components/BarraEncabezado.jsx
import React from "react";
// import { chatStyles as styles } from "../styles/chatStyles"; // YA NO SE USA

export function BarraEncabezado({ usuario, estadoWs, onLogout }) {
  const etiquetaWs =
    estadoWs === "connected"
      ? "Conectado"
      : estadoWs === "connecting"
        ? "Conectando..."
        : "Desconectado";

  return (
    <header className="encabezado">
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <span style={{ whiteSpace: "nowrap" }}>💬 Chat HGI</span>
      </div>
      <div style={{ fontSize: 12, opacity: 0.9, whiteSpace: "nowrap" }}>
        {etiquetaWs}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ whiteSpace: "nowrap", fontSize: 13 }}>
          <strong>{usuario.username}</strong>
        </span>
        <button onClick={onLogout} className="boton-secundario" style={{ whiteSpace: "nowrap" }}>
          Salir
        </button>
      </div>
    </header>
  );
}
