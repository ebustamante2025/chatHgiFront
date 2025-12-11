// src/components/BarraPestanias.jsx
import React from "react";
// import { chatStyles as styles } from "../styles/chatStyles"; // YA NO SE USA

export function BarraPestanias({
  pestaniasAbiertas,
  llaveActiva,
  noLeidosPorLlave,
  onClickPestania,
  onCerrarPestania
}) {
  return (
    <div className="barra-pestanias">
      {pestaniasAbiertas.map((tab) => {
        const unread = noLeidosPorLlave[tab.key] || 0;
        const activa = tab.key === llaveActiva;
        return (
          <div
            key={tab.key}
            className="item-pestania"
            style={{
              backgroundColor: activa ? "#ffffff" : "#e5e7eb",
              borderBottom: activa
                ? "2px solid #2563eb"
                : "2px solid transparent"
            }}
            onClick={() => onClickPestania(tab)}
          >
            <span>{tab.label}</span>
            {unread > 0 && (
              <span className="badge-pequeno">{unread}</span>
            )}
            <button
              className="boton-cerrar-pestania"
              onClick={(e) => {
                e.stopPropagation();
                onCerrarPestania(tab.key);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      {pestaniasAbiertas.length === 0 && (
        <div style={{ fontSize: 12, opacity: 0.7, padding: "4px 8px" }}>
          No hay chats abiertos. Selecciona un usuario o una sala.
        </div>
      )}
    </div>
  );
}
