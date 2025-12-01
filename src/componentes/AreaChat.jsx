// src/components/AreaChat.jsx
import React, { useEffect, useRef } from "react";
import { chatStyles as styles } from "../styles/chatStyles";

export function AreaChat({
  tipoChat,
  usuarioSeleccionado,
  salaSeleccionada,
  mensajesActuales,
  miembrosSalaPorId,
  visibleTypingPrivado,
  visibleTypingSala,
  usuarioTypingSala,
  textoMensaje,
  onChangeMensaje,
  onEnviarMensaje,
  usuarioActual,
  onAbrirModalMiembrosSala,
  usuarios
}) {
  const finMensajesRef = useRef(null);

  // Scroll siempre al final cuando cambian los mensajes
  useEffect(() => {
    if (finMensajesRef.current) {
      finMensajesRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [mensajesActuales, tipoChat, usuarioSeleccionado?.id, salaSeleccionada?.id]);

  const renderEstadoMensaje = (m) => {
    if (!m.status) return null;
    let label = "";
    if (m.status === "sent") label = "✓ enviado";
    else if (m.status === "delivered") label = "✓✓ entregado";
    else if (m.status === "read") label = "✓✓ leído";
    return (
      <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 4 }}>
        {label}
      </span>
    );
  };

  const tieneChatActivo =
    (tipoChat === "user" && usuarioSeleccionado) ||
    (tipoChat === "room" && salaSeleccionada);

  if (!tieneChatActivo) {
    return (
      <main style={styles.areaChat}>
        <div style={{ padding: 16 }}>
          Selecciona un usuario o una sala para chatear.
        </div>
      </main>
    );
  }

  return (
    <main style={styles.areaChat}>
      {/* Encabezado del chat */}
      <div style={styles.encabezadoChat}>
        {tipoChat === "user" && usuarioSeleccionado && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                ...styles.puntoEstado,
                backgroundColor: usuarioSeleccionado.online ? "green" : "gray"
              }}
            />
            <div>
              Chat con <strong>{usuarioSeleccionado.username}</strong>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                {usuarioSeleccionado.online ? "En línea" : "Desconectado"}
              </div>
            </div>
          </div>
        )}

        {tipoChat === "room" && salaSeleccionada && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              width: "100%",
              gap: 12
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ marginBottom: 4 }}>
                Sala <strong>#{salaSeleccionada.name}</strong>
              </div>
              <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>
                Integrantes ({miembrosSalaPorId[salaSeleccionada.id]?.length || 0}):
              </div>
              <div style={{ 
                display: "flex", 
                flexWrap: "wrap", 
                gap: 4,
                fontSize: 11,
                maxHeight: 40,
                overflowY: "auto",
                minHeight: 20
              }}>
                {miembrosSalaPorId[salaSeleccionada.id] && miembrosSalaPorId[salaSeleccionada.id].length > 0 ? (
                  miembrosSalaPorId[salaSeleccionada.id]
                    .map(memberId => {
                      const usuario = usuarios.find(u => u.id === memberId);
                      if (!usuario) return null;
                      return (
                        <span
                          key={memberId}
                          style={{
                            padding: "2px 6px",
                            background: "#e0f2ff",
                            borderRadius: 12,
                            border: "1px solid #93c5fd"
                          }}
                        >
                          {memberId === usuarioActual?.id ? "Tú" : usuario.username}
                        </span>
                      );
                    })
                    .filter(Boolean)
                ) : (
                  <span style={{ fontSize: 10, opacity: 0.6, fontStyle: "italic" }}>
                    Cargando integrantes...
                  </span>
                )}
              </div>
            </div>
            {onAbrirModalMiembrosSala && (
              <button
                type="button"
                onClick={onAbrirModalMiembrosSala}
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  borderRadius: 4,
                  border: "1px solid #d1d5db",
                  background: "white",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  alignSelf: "flex-start"
                }}
              >
                Gestionar
              </button>
            )}
          </div>
        )}
      </div>

      {/* Mensajes */}
      <div style={styles.mensajes}>
        {mensajesActuales.map((m) => {
          // Determinar si el mensaje es del usuario actual
          const esMiMensaje = usuarioActual && m.from_user_id === usuarioActual.id;
          
          // Obtener nombre del remitente
          let nombreRemitente = "Usuario";
          if (tipoChat === "user") {
            nombreRemitente = esMiMensaje ? "Tú" : (usuarioSeleccionado?.username || "Usuario");
          } else if (tipoChat === "room") {
            // Para salas, usar el from_username que viene del backend
            nombreRemitente = esMiMensaje ? "Tú" : (m.from_username || "Miembro");
          }

          return (
            <div
              key={m.id}
              style={{
                ...styles.mensaje,
                alignSelf: esMiMensaje ? "flex-end" : "flex-start",
                backgroundColor: esMiMensaje ? "#DCF8C6" : "#FFFFFF",
                marginLeft: esMiMensaje ? "auto" : 0,
                marginRight: esMiMensaje ? 0 : "auto"
              }}
            >
              <div style={{ 
                fontSize: 12, 
                opacity: 0.9, 
                marginBottom: 4,
                fontWeight: 500,
                color: esMiMensaje ? "#166534" : "#1e40af"
              }}>
                {nombreRemitente}
              </div>
              <div style={{ marginTop: 2 }}>{m.content}</div>
              <div
                style={{
                  marginTop: 4,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}
              >
                <span style={{ fontSize: 10, opacity: 0.5 }}>
                  {new Date(m.created_at).toLocaleTimeString()}
                </span>
                {renderEstadoMensaje(m)}
              </div>
            </div>
          );
        })}

        {visibleTypingPrivado && usuarioSeleccionado && (
          <div style={styles.escribiendo}>
            {usuarioSeleccionado.username} está escribiendo...
          </div>
        )}

        {visibleTypingSala && usuarioTypingSala && (
          <div style={styles.escribiendo}>
            {usuarioTypingSala.username} está escribiendo en la sala...
          </div>
        )}

        <div ref={finMensajesRef} />
      </div>

      {/* Barra de entrada */}
      <div style={styles.barraEntrada}>
        <input
          type="text"
          placeholder="Escribe un mensaje..."
          value={textoMensaje}
          onChange={onChangeMensaje}
          onKeyDown={(e) => e.key === "Enter" && onEnviarMensaje()}
          style={styles.inputFlex}
        />
        <button onClick={onEnviarMensaje} style={styles.botonPrimario}>
          Enviar
        </button>
      </div>
    </main>
  );
}
