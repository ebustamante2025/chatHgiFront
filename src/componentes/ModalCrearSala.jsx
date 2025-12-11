// src/components/ModalCrearSala.jsx
import React from "react";
// import { chatStyles as styles } from "../styles/chatStyles"; // YA NO SE USA

export function ModalCrearSala({
  abierto,
  usuarios,
  idUsuarioActual,
  nombreSala,
  setNombreSala,
  miembrosSalaSeleccionados,
  onAlternarMiembro,
  onCerrar,
  onCrearSala
}) {
  if (!abierto) return null;

  const otrosUsuarios = usuarios.filter((u) => u.id !== idUsuarioActual);

  return (
    <div className="fondo-modal">
      <div className="contenido-modal">
        <h3 style={{ marginTop: 0, marginBottom: 16 }}>
          Crear Nueva Sala
        </h3>

        {/* Campo de nombre de sala */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 13, marginBottom: 6, fontWeight: 500 }}>
            Nombre de la sala
          </label>
          <input
            type="text"
            placeholder="Ej: Equipo de Desarrollo"
            value={nombreSala}
            onChange={(e) => setNombreSala(e.target.value)}
            className="input"
            style={{ width: "100%" }}
            autoFocus
          />
        </div>

        {/* Selección de integrantes */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 13, marginBottom: 8, fontWeight: 500 }}>
            Seleccionar integrantes
          </label>
          <div className="lista-modal">
            {otrosUsuarios.map((u) => (
              <label
                key={u.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 14,
                  padding: "6px 0",
                  cursor: "pointer"
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
              <div style={{ fontSize: 13, opacity: 0.7, padding: "8px 0" }}>
                No hay otros usuarios disponibles.
              </div>
            )}
          </div>
        </div>

        <div style={{ fontSize: 12, marginBottom: 16, opacity: 0.7 }}>
          <strong>{miembrosSalaSeleccionados.length}</strong> integrante(s) seleccionado(s)
          <br />
          <span style={{ fontSize: 11 }}>
            (Tú serás agregado automáticamente como miembro)
          </span>
        </div>

        <div className="pie-modal">
          <button
            type="button"
            className="boton-secundario"
            onClick={onCerrar}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="boton-primario"
            style={{
              opacity: !nombreSala.trim() ? 0.5 : 1,
              cursor: !nombreSala.trim() ? "not-allowed" : "pointer"
            }}
            onClick={onCrearSala}
            disabled={!nombreSala.trim()}
          >
            Crear Sala
          </button>
        </div>
      </div>
    </div>
  );
}

