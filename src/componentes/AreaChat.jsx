// src/components/AreaChat.jsx
import React, { useEffect, useRef } from "react";
// import { chatStyles as styles } from "../styles/chatStyles"; // YA NO SE USA

// ======================================================
// COMPONENTE PRINCIPAL AreaChat
// ======================================================
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
  usuarios,

  // --- WebRTC / llamadas ---
  rtcInCall,
  rtcCallMode,
  rtcLocalStream,
  rtcRemoteStream,
  rtcStartCall,
  rtcEndCall,
  rtcToggleMic,
  rtcIsMicMuted,
  rtcRemoteMicMuted,
  rtcToggleVideo,
  rtcIsVideoOff,
  rtcRemoteVideoOff,

  // --- NUEVO: llamada entrante ---
  incomingCall, // (Ya no se usa aquí para el modal, pero se recibe)

  // --- Mobile ---
  onBack
}) {
  const finMensajesRef = useRef(null);
  const fileInputRef = useRef(null); // Ref para input de archivos
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [isRemoteMuted, setIsRemoteMuted] = React.useState(false);

  // Scroll al final
  useEffect(() => {
    if (finMensajesRef.current) {
      finMensajesRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [mensajesActuales, tipoChat, usuarioSeleccionado?.id, salaSeleccionada?.id]);

  // Asignar streams
  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = rtcLocalStream || null;
    }
  }, [rtcLocalStream]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = rtcRemoteStream || null;
    }
  }, [rtcRemoteStream]);

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

  // ======================================================
  // SI NO HAY CHAT SELECCIONADO
  // ======================================================
  if (!tieneChatActivo) {
    return (
      <main className="area-chat">
        <div style={{ padding: 16 }}>
          Selecciona un usuario o una sala para chatear.
        </div>
      </main>
    );
  }

  // ======================================================
  // VISTA PRINCIPAL
  // ======================================================
  return (
    <>
      <main className="area-chat">
        {/* Encabezado */}
        <div className="encabezado-chat">
          {tipoChat === "user" && usuarioSeleccionado && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* Botón atrás (solo móvil) */}
                <button className="boton-atras" onClick={onBack}>
                  ←
                </button>

                <span
                  className="punto-estado"
                  style={{
                    backgroundColor: usuarioSeleccionado.online
                      ? "green"
                      : "gray",
                  }}
                />
                <div>
                  Chat con <strong>{usuarioSeleccionado.username}</strong>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    {usuarioSeleccionado.online ? "En línea" : "Desconectado"}
                  </div>
                </div>
              </div>

              {/* BOTONES: video / audio / pantalla / archivo */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  className="boton-icono"
                  title="Videollamada"
                  disabled={rtcInCall}
                  style={{ opacity: rtcInCall ? 0.5 : 1, cursor: rtcInCall ? "not-allowed" : "pointer" }}
                  onClick={() =>
                    !rtcInCall && rtcStartCall && usuarioSeleccionado
                      ? rtcStartCall(usuarioSeleccionado, "video")
                      : null
                  }
                >
                  📹
                </button>
                <button
                  type="button"
                  className="boton-icono"
                  title="Llamada de audio"
                  disabled={rtcInCall}
                  style={{ opacity: rtcInCall ? 0.5 : 1, cursor: rtcInCall ? "not-allowed" : "pointer" }}
                  onClick={() => {
                    if (!rtcInCall && rtcStartCall && usuarioSeleccionado) {
                      console.log(
                        `📞 Llamando a ${usuarioSeleccionado.username} (modo: audio)...`
                      );
                      rtcStartCall(usuarioSeleccionado, "audio");
                    }
                  }}
                >
                  🎧
                </button>
                <button
                  type="button"
                  className="boton-icono"
                  title="Compartir pantalla"
                  disabled={rtcInCall}
                  style={{ opacity: rtcInCall ? 0.5 : 1, cursor: rtcInCall ? "not-allowed" : "pointer" }}
                  onClick={() => {
                    if (!rtcInCall && rtcStartCall && usuarioSeleccionado) {
                      rtcStartCall(usuarioSeleccionado, "screen");
                    }
                  }}
                >
                  🖥️
                </button>
              </div>
            </div>
          )}

          {/* Encabezado de sala */}
          {tipoChat === "room" && salaSeleccionada && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                width: "100%",
                gap: 12,
              }}
            >
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                {/* Botón atrás (solo móvil) */}
                <button className="boton-atras" onClick={onBack}>
                  ←
                </button>
                <div>
                  <div style={{ marginBottom: 4 }}>
                    Sala <strong>#{salaSeleccionada.name}</strong>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>
                    Integrantes (
                    {miembrosSalaPorId[salaSeleccionada.id]?.length || 0}):
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 4,
                      fontSize: 11,
                      maxHeight: 40,
                      overflowY: "auto",
                      minHeight: 20,
                    }}
                  >
                    {(miembrosSalaPorId[salaSeleccionada.id] || []).map(
                      (memberId) => {
                        const usuario = usuarios.find((u) => u.id === memberId);
                        if (!usuario) return null;

                        return (
                          <span
                            key={memberId}
                            style={{
                              padding: "2px 6px",
                              background: "#e0f2ff",
                              borderRadius: 12,
                              border: "1px solid #93c5fd",
                            }}
                          >
                            {memberId === usuarioActual?.id
                              ? "Tú"
                              : usuario.username}
                          </span>
                        );
                      }
                    )}
                  </div>
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
                  }}
                >
                  Gestionar
                </button>
              )}
            </div>
          )}
        </div>

        {/* Panel de llamada en curso (MINIMALISTA) */}
        {rtcInCall && (
          <div
            style={{
              padding: "10px 16px",
              borderBottom: "1px solid #e5e7eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: "#f9fafb",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {/* Indicador visual (Punto rojo parpadeante o Parlante) */}
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <div
                  className="parpadeo-rojo"
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    backgroundColor: "#ef4444",
                    marginRight: 8,
                  }}
                />
                <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                  {rtcCallMode === "video"
                    ? "Videollamada en curso"
                    : rtcCallMode === "screen"
                      ? "Compartiendo pantalla"
                      : "Llamada en curso"}
                </span>
              </div>

              <div style={{ fontSize: 12, opacity: 0.7 }}>
                ({rtcCallMode === "screen"
                  ? "Compartiendo pantalla"
                  : rtcCallMode === "audio"
                    ? "Audio"
                    : "Video"})
              </div>
            </div>

            {/* ÁREA DE VIDEO (Visible solo en video/screen) */}
            {(rtcCallMode === "video" || rtcCallMode === "screen") && (
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: 300, // Altura fija o flexible según prefieras
                  backgroundColor: "black",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  overflow: "hidden",
                }}
              >
                {/* Video Remoto (Grande / Fondo) */}
                {/* Video Remoto (Grande / Fondo) */}
                <div style={{ position: "relative", width: "100%", height: "100%", background: "#000" }}>
                  {!rtcRemoteVideoOff ? (
                    <video
                      ref={remoteVideoRef}
                      autoPlay
                      playsInline
                      muted={isRemoteMuted}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#6b7280",
                        flexDirection: "column",
                      }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="64"
                        height="64"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path>
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                      </svg>
                      <span style={{ marginTop: 8 }}>Cámara apagada</span>
                    </div>
                  )}

                  {/* Indicador Mute Remoto */}
                  {rtcRemoteMicMuted && (
                    <div
                      style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        background: "rgba(0,0,0,0.6)",
                        padding: 12,
                        borderRadius: "50%",
                        color: "#ef4444",
                        zIndex: 5, // Encima del video/placeholder
                      }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="32"
                        height="32"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                        <line x1="12" y1="19" x2="12" y2="23"></line>
                        <line x1="8" y1="23" x2="16" y2="23"></line>
                      </svg>
                    </div>
                  )}
                </div>

                {/* Video Local (PIP - Pequeño en la esquina) */}
                <div
                  style={{
                    position: "absolute",
                    bottom: 10,
                    right: 10,
                    width: 100,
                    height: 75,
                    zIndex: 10,
                    backgroundColor: "#333",
                    borderRadius: 8,
                    border: "2px solid white",
                    overflow: "hidden",
                  }}
                >
                  {!rtcIsVideoOff ? (
                    <video
                      ref={localVideoRef}
                      autoPlay
                      muted
                      playsInline
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#9ca3af",
                      }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path>
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                      </svg>
                    </div>
                  )}

                  {/* Indicador Mute Local */}
                  {rtcIsMicMuted && (
                    <div
                      style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        background: "rgba(0,0,0,0.6)",
                        padding: 6,
                        borderRadius: "50%",
                        color: "#ef4444",
                      }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                        <line x1="12" y1="19" x2="12" y2="23"></line>
                        <line x1="8" y1="23" x2="16" y2="23"></line>
                      </svg>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Elementos ocultos SOLO si es audio (para mantener el stream activo) */}
            {rtcCallMode === "audio" && (
              <div style={{ display: "none" }}>
                <video ref={remoteVideoRef} autoPlay playsInline muted={isRemoteMuted} />
                <video ref={localVideoRef} autoPlay muted playsInline />
              </div>
            )}

            {/* Controles: Mute Mic, Mute Sound, Colgar */}
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {/* Mute Micrófono */}
              <button
                type="button"
                onClick={rtcToggleMic}
                title={rtcIsMicMuted ? "Activar micrófono" : "Silenciar micrófono"}
                style={{
                  padding: "8px",
                  borderRadius: "50%",
                  border: "1px solid #d1d5db",
                  background: rtcIsMicMuted ? "#fee2e2" : "white",
                  color: rtcIsMicMuted ? "#dc2626" : "#374151",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 36,
                  height: 36,
                }}
              >
                {rtcIsMicMuted ? (
                  // Icono Micrófono Tachado
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                  </svg>
                ) : (
                  // Icono Micrófono Normal
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                  </svg>
                )}
              </button>

              {/* Mute Sonido (Remoto) */}
              <button
                type="button"
                onClick={() => setIsRemoteMuted(!isRemoteMuted)}
                title={isRemoteMuted ? "Activar sonido" : "Silenciar sonido"}
                style={{
                  padding: "8px",
                  borderRadius: "50%",
                  border: "1px solid #d1d5db",
                  background: isRemoteMuted ? "#fee2e2" : "white",
                  color: isRemoteMuted ? "#dc2626" : "#374151",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 36,
                  height: 36,
                }}
              >
                {isRemoteMuted ? (
                  // Icono Altavoz Tachado
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
                    <line x1="23" y1="9" x2="17" y2="15"></line>
                    <line x1="17" y1="9" x2="23" y2="15"></line>
                  </svg>
                ) : (
                  // Icono Altavoz Normal
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                  </svg>
                )}
              </button>

              {/* Compartir Pantalla (NUEVO BOTÓN EN LLAMADA) */}
              {rtcCallMode !== "screen" && (
                <button
                  type="button"
                  onClick={() => {
                    if (rtcStartCall && usuarioSeleccionado) {
                      rtcStartCall(usuarioSeleccionado, "screen");
                    }
                  }}
                  title="Compartir pantalla"
                  style={{
                    padding: "8px",
                    borderRadius: "50%",
                    border: "1px solid #d1d5db",
                    background: "white",
                    color: "#374151",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 36,
                    height: 36,
                  }}
                >
                  🖥️
                </button>
              )}

              {/* Colgar */}
              <button
                type="button"
                onClick={rtcEndCall}
                title="Colgar llamada"
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 20,
                  border: "none",
                  background: "#dc2626",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                Colgar
              </button>
            </div>
          </div>
        )}

        {/* Mensajes */}
        <div className="mensajes">
          {mensajesActuales.map((m) => {
            const esMiMensaje =
              usuarioActual && m.from_user_id === usuarioActual.id;

            const nombreRemitente =
              tipoChat === "user"
                ? esMiMensaje
                  ? "Tú"
                  : usuarioSeleccionado?.username || "Usuario"
                : esMiMensaje
                  ? "Tú"
                  : m.from_username || "Miembro";

            return (
              <div
                key={m.id}
                className={`mensaje ${esMiMensaje ? "propio" : "ajeno"}`}
              >
                <div
                  style={{
                    fontSize: 12,
                    opacity: 0.9,
                    marginBottom: 4,
                    fontWeight: 500,
                    color: esMiMensaje ? "#166534" : "#1e40af",
                  }}
                >
                  {nombreRemitente}
                </div>

                {/* Archivo adjunto */}
                {m.file_url && (
                  <div style={{ marginBottom: m.content ? 8 : 0 }}>
                    {m.file_type && m.file_type.startsWith("image/") ? (
                      <img
                        src={`http://localhost:4000${m.file_url}`}
                        alt="Adjunto"
                        style={{
                          maxWidth: "100%",
                          borderRadius: 8,
                          cursor: "pointer",
                          maxHeight: 200,
                          objectFit: "contain"
                        }}
                        onClick={() => window.open(`http://localhost:4000${m.file_url}`, "_blank")}
                      />
                    ) : (
                      <a
                        href={`http://localhost:4000${m.file_url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          color: esMiMensaje ? "white" : "#2563eb",
                          textDecoration: "none",
                          background: "rgba(0,0,0,0.1)",
                          padding: 8,
                          borderRadius: 8,
                        }}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                          <line x1="16" y1="13" x2="8" y2="13"></line>
                          <line x1="16" y1="17" x2="8" y2="17"></line>
                          <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                        <span style={{ fontSize: 13, textDecoration: "underline" }}>
                          Descargar archivo
                        </span>
                      </a>
                    )}
                  </div>
                )}

                <div style={{ marginTop: 2 }}>{m.content}</div>

                <div
                  style={{
                    marginTop: 4,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
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
            <div className="escribiendo">
              {usuarioSeleccionado.username} está escribiendo...
            </div>
          )}

          {visibleTypingSala && usuarioTypingSala && (
            <div className="escribiendo">
              {usuarioTypingSala.username} está escribiendo en la sala...
            </div>
          )}

          <div ref={finMensajesRef} />
        </div>

        {/* Input */}
        {/* Input */}
        <div className="barra-entrada" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Input oculto para archivos */}
          <input
            type="file"
            ref={(el) => (fileInputRef.current = el)}
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files[0];
              if (file) {
                onEnviarMensaje(file); // Enviar archivo inmediatamente
                e.target.value = null; // Reset input
              }
            }}
          />

          {/* Botón Clip */}
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#6b7280",
              padding: 8,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Adjuntar archivo"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>

          <input
            type="text"
            placeholder="Escribe un mensaje..."
            value={textoMensaje}
            onChange={onChangeMensaje}
            onKeyDown={(e) => e.key === "Enter" && onEnviarMensaje()}
            className="input-flex"
          />
          <button onClick={() => onEnviarMensaje()} className="boton-primario">
            Enviar
          </button>
        </div>
      </main>
    </>
  );
}
