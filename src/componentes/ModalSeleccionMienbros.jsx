// src/components/ModalSeleccionMiembros.jsx
import React from "react";
import { chatStyles as styles } from "../styles/chatStyles";

export function ModalSeleccionMiembros({
  abierto,
  usuarios,
  idUsuarioActual,
  miembrosSalaSeleccionados,
  onAlternarMiembro,
  onCerrar
}) {
  if (!abierto) return null;

  const otrosUsuarios = usuarios.filter((u) => u.id !== idUsuarioActual);

  return (
    <div style={styles.fondoModal}>
      <div style={styles.contenidoModal}>
        <h3 style={{ marginTop: 0, marginBottom: 8 }}>
          Elegir integrantes de la nueva sala
        </h3>
        <div style={{ fontSize: 13, marginBottom: 8 }}>
          Marca los usuarios que quieres agregar a la sala.
          <br />
          <span style={{ opacity: 0.7 }}>
            (Tú normalmente quedarás agregado desde el backend).
          </span>
        </div>

        <div style={styles.listaModal}>
          {otrosUsuarios.map((u) => (
            <label
              key={u.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 14,
                padding: "4px 0"
              }}
            >
              <input
                type="checkbox"
                checked={miembrosSalaSeleccionados.includes(u.id)}
                onChange={() => onAlternarMiembro(u.id)}
              />
              <span>{u.username}</span>
              <span style={{ fontSize: 11, opacity: 0.6 }}>
                ({u.online ? "online" : "offline"})
              </span>
            </label>
          ))}
          {otrosUsuarios.length === 0 && (
            <div style={{ fontSize: 13, opacity: 0.7 }}>
              No hay otros usuarios disponibles.
            </div>
          )}
        </div>

        <div style={styles.pieModal}>
          <div style={{ fontSize: 12 }}>
            Seleccionados: <strong>{miembrosSalaSeleccionados.length}</strong>
          </div>
          <div>
            <button
              type="button"
              style={styles.botonSecundario}
              onClick={onCerrar}
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
