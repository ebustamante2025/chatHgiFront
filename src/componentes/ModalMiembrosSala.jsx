// src/components/ModalMiembrosSala.jsx
import React from "react";
// import { chatStyles as styles } from "../styles/chatStyles"; // YA NO SE USA

export function ModalMiembrosSala({
  abierto,
  salaSeleccionada,
  usuarios,
  idUsuarioActual,
  miembrosSalaSeleccionados,
  onAlternarMiembro,
  onCerrar,
  onGuardar
}) {
  if (!abierto || !salaSeleccionada) return null;

  const otrosUsuarios = usuarios.filter((u) => u.id !== idUsuarioActual);

  return (
    <div className="fondo-modal">
      <div className="contenido-modal">
        <h3 style={{ marginTop: 0, marginBottom: 8 }}>
          Gestionar integrantes de la sala #{salaSeleccionada.name}
        </h3>
        <div style={{ fontSize: 13, marginBottom: 12, padding: "10px", background: "#e0f2ff", borderRadius: 4, border: "1px solid #93c5fd" }}>
          <div style={{ marginBottom: 4 }}>
            <strong>Integrantes actuales:</strong> {miembrosSalaSeleccionados.length + 1}
            <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 8 }}>
              (incluyéndote a ti)
            </span>
          </div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            ✓ Marca usuarios para <strong>agregarlos</strong> a la sala
            <br />
            ✗ Desmarca usuarios para <strong>eliminarlos</strong> de la sala
          </div>
        </div>

        <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 500, color: "#2563eb" }}>
          Tú (siempre en la sala)
        </div>

        <div className="lista-modal">
          {otrosUsuarios.map((u) => {
            const esMiembro = miembrosSalaSeleccionados.includes(u.id);
            return (
              <label
                key={u.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 14,
                  padding: "6px 8px",
                  borderRadius: 4,
                  background: esMiembro ? "#e0f2ff" : "transparent",
                  border: esMiembro ? "1px solid #93c5fd" : "1px solid transparent",
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
              >
                <input
                  type="checkbox"
                  checked={esMiembro}
                  onChange={() => onAlternarMiembro(u.id)}
                  style={{ cursor: "pointer" }}
                />
                <span style={{ flex: 1, fontWeight: esMiembro ? 500 : 400 }}>
                  {u.username}
                </span>
                <span style={{
                  fontSize: 11,
                  opacity: 0.6,
                  padding: "2px 6px",
                  borderRadius: 10,
                  background: u.online ? "#dcfce7" : "#f3f4f6",
                  color: u.online ? "#166534" : "#6b7280"
                }}>
                  {u.online ? "● online" : "○ offline"}
                </span>
                {esMiembro && (
                  <span style={{ fontSize: 11, color: "#16a34a", fontWeight: 500 }}>
                    ✓ En la sala
                  </span>
                )}
              </label>
            );
          })}
          {otrosUsuarios.length === 0 && (
            <div style={{ fontSize: 13, opacity: 0.7, padding: "12px", textAlign: "center" }}>
              No hay otros usuarios disponibles.
            </div>
          )}
        </div>

        <div className="pie-modal">
          <div style={{ fontSize: 12 }}>
            Seleccionados: <strong>{miembrosSalaSeleccionados.length}</strong>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
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
              onClick={onGuardar}
            >
              Guardar cambios
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
