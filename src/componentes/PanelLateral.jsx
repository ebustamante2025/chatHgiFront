// src/components/PanelLateral.jsx
import React from "react";
// import { chatStyles as styles } from "../styles/chatStyles"; // YA NO SE USA

export function PanelLateral({
  usuariosConectados,
  usuariosDesconectados,
  salas,
  noLeidosPorLlave,
  onSeleccionarUsuario,
  onSeleccionarSala,
  tipoChat,
  usuarioSeleccionado,
  salaSeleccionada,
  nombreNuevaSala,
  setNombreNuevaSala,
  miembrosSalaSeleccionados,
  onAbrirModalSeleccion,
  onCrearSala,
  onEliminarSala,
  getConversationKey
}) {
  return (
    <aside className="barra-lateral">
      <h3>Usuarios conectados</h3>
      <div className="contenedor-lista">
        <ul className="lista-usuarios">
          {usuariosConectados.map((u) => {
            const key = getConversationKey("user", u.id);
            const unread = noLeidosPorLlave[key] || 0;
            const esSeleccionado =
              tipoChat === "user" &&
              usuarioSeleccionado &&
              usuarioSeleccionado.id === u.id;

            return (
              <li
                key={u.id}
                className={`item-usuario ${esSeleccionado ? "seleccionado" : ""}`}
                onClick={() => onSeleccionarUsuario(u)}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flex: 1
                  }}
                >
                  <span
                    className="punto-estado"
                    style={{
                      backgroundColor: "green"
                    }}
                  />
                  <span>{u.username}</span>
                </div>
                {unread > 0 && (
                  <span className="badge-pequeno">{unread}</span>
                )}
              </li>
            );
          })}
          {usuariosConectados.length === 0 && (
            <li style={{ fontSize: 12, opacity: 0.7 }}>
              No hay usuarios conectados.
            </li>
          )}
        </ul>
      </div>

      <h3 style={{ marginTop: 12 }}>Otros usuarios</h3>
      <div className="contenedor-lista">
        <ul className="lista-usuarios">
          {usuariosDesconectados.map((u) => {
            const key = getConversationKey("user", u.id);
            const unread = noLeidosPorLlave[key] || 0;
            const esSeleccionado =
              tipoChat === "user" &&
              usuarioSeleccionado &&
              usuarioSeleccionado.id === u.id;

            return (
              <li
                key={u.id}
                className={`item-usuario ${esSeleccionado ? "seleccionado" : ""}`}
                onClick={() => onSeleccionarUsuario(u)}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flex: 1
                  }}
                >
                  <span
                    className="punto-estado"
                    style={{
                      backgroundColor: "gray"
                    }}
                  />
                  <span>{u.username}</span>
                </div>
                {unread > 0 && (
                  <span className="badge-pequeno">{unread}</span>
                )}
              </li>
            );
          })}
          {usuariosDesconectados.length === 0 && (
            <li style={{ fontSize: 12, opacity: 0.7 }}>
              No hay otros usuarios.
            </li>
          )}
        </ul>
      </div>

      <hr style={{ margin: "12px 0" }} />

      <h3>Salas</h3>
      <div className="contenedor-lista">
        <ul className="lista-usuarios">
          {salas.map((s) => {
            const key = getConversationKey("room", s.id);
            const unread = noLeidosPorLlave[key] || 0;
            const esSeleccionado =
              tipoChat === "room" &&
              salaSeleccionada &&
              salaSeleccionada.id === s.id;

            return (
              <li
                key={s.id}
                className={`item-usuario ${esSeleccionado ? "seleccionado" : ""}`}
                style={{ justifyContent: "space-between" }}
              >
                <span
                  onClick={() => onSeleccionarSala(s)}
                  style={{ flex: 1, cursor: "pointer" }}
                >
                  # {s.name}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {unread > 0 && <span className="badge">{unread}</span>}
                  {onEliminarSala && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEliminarSala(s.id);
                      }}
                      style={{
                        padding: "2px 6px",
                        fontSize: 10,
                        borderRadius: 3,
                        border: "1px solid #ef4444",
                        background: "#fee2e2",
                        color: "#dc2626",
                        cursor: "pointer",
                        marginLeft: 4
                      }}
                      title="Eliminar sala"
                    >
                      ×
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          {salas.length === 0 && (
            <li style={{ fontSize: 12, opacity: 0.7 }}>
              No tienes salas creadas.
            </li>
          )}
        </ul>
      </div>

      <div style={{ marginTop: 12 }}>
        <button
          className="boton-primario"
          style={{
            width: "100%"
          }}
          type="button"
          onClick={onAbrirModalSeleccion}
        >
          + Crear Nueva Sala
        </button>
      </div>
    </aside>
  );
}
