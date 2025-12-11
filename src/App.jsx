// src/App.jsx
import React, { useState } from "react";
import { useChat } from "./hooks/useChat";
import "./styles/chat.css"; // Importar CSS
import { BarraEncabezado } from "./componentes/BarraEncabezado";
import { PanelLateral } from "./componentes/PanelLateral";
import { BarraPestanias } from "./componentes/BarraPestanias";
import { AreaChat } from "./componentes/AreaChat";
import { ModalCrearSala } from "./componentes/ModalCrearSala";
import { ModalMiembrosSala } from "./componentes/ModalMiembrosSala";
import { IncomingCallModal } from "./componentes/IncomingCallModal"; // NUEVO
import { login, register } from "./api";

function App() {
  // Estado de autenticación
  const [token, setToken] = useState(() => localStorage.getItem("token") || null);
  const [usuario, setUsuario] = useState(() => {
    const userStr = localStorage.getItem("usuario");
    return userStr ? JSON.parse(userStr) : null;
  });
  const [modoAuth, setModoAuth] = useState("login");
  const [formularioAuth, setFormularioAuth] = useState({ username: "", password: "" });

  // Manejar autenticación
  const manejarAuth = async (e) => {
    e.preventDefault();
    try {
      const res = modoAuth === "login"
        ? await login(formularioAuth.username, formularioAuth.password)
        : await register(formularioAuth.username, formularioAuth.password);

      setToken(res.token);
      setUsuario(res.user);
      localStorage.setItem("token", res.token);
      localStorage.setItem("usuario", JSON.stringify(res.user));
      setFormularioAuth({ username: "", password: "" });
    } catch (err) {
      alert(err.error || "Error en autenticación");
    }
  };

  const cerrarSesion = () => {
    setToken(null);
    setUsuario(null);
    localStorage.removeItem("token");
    localStorage.removeItem("usuario");
  };

  // Hook de chat
  const {
    // conexión
    estadoWS,

    // listas
    usuarios,
    salas,
    usuariosConectados,
    usuariosOffline,

    // conversación / pestañas
    tipoChat,
    usuarioSeleccionado,
    salaSeleccionada,
    claveActiva,
    pestanasAbiertas,
    noLeidosPorClave,
    seleccionarUsuario,
    seleccionarSala,
    cerrarPestana,
    abrirPestanaConversacion,

    // mensajes
    mensajesActuales,
    textoMensaje,
    setTextoMensaje,
    manejarCambioInput,
    enviarMensaje,

    // salas / miembros
    nombreNuevaSala,
    setNombreNuevaSala,
    miembrosSeleccionadosSala,
    alternarMiembroSala,
    crearSala,
    eliminarSala,
    miembrosSalaPorId,

    // modales
    modalElegirMiembrosAbierto,
    abrirModalElegirMiembros,
    cerrarModalElegirMiembros,
    modalEditarMiembrosSalaAbierto,
    abrirModalEditarMiembrosSala,
    cerrarModalEditarMiembrosSala,
    guardarCambiosMiembrosSala,

    // typing
    escribiendoPrivadoVisible,
    escribiendoSalaVisible,
    usuarioQueEscribeEnSala,

    // helper
    getConversationKey,

    // RTC
    rtcInCall,
    rtcCallMode,
    rtcLocalStream,
    rtcRemoteStream,
    rtcStartCall,
    rtcEndCall,
    rtcToggleMic,
    rtcIsMicMuted,
    rtcToggleVideo,
    rtcIsVideoOff,
    rtcRemoteVideoOff,
    rtcRemoteMicMuted,
    incomingCall,
  } = useChat(token, usuario);

  // Función para volver atrás en móvil (limpiar selección)
  const handleBack = () => {
    // Podríamos limpiar la selección o simplemente cerrar la pestaña activa si queremos
    // Para este caso, vamos a simular cerrar la selección visualmente
    // pero useChat no tiene un "deseleccionar" explícito que limpie todo,
    // así que usaremos cerrarPestana de la clave activa si queremos salir totalmente,
    // o simplemente podríamos implementar un estado local de "vista móvil" si fuera necesario.
    // Sin embargo, cerrarPestana ya maneja la lógica de selección.
    if (claveActiva) {
      cerrarPestana(claveActiva);
    }
  };

  // Determinar si hay un chat activo para la clase CSS
  const hasActiveChat = !!(tipoChat && (usuarioSeleccionado || salaSeleccionada));

  // SI NO ESTÁ AUTENTICADO → login/registro
  if (!token || !usuario) {
    return (
      <div className="contenedor">
        <div className="tarjeta-auth">
          <h2>{modoAuth === "login" ? "Iniciar sesión" : "Registrarse"}</h2>
          <form onSubmit={manejarAuth} className="formulario">
            <input
              type="text"
              placeholder="Usuario"
              value={formularioAuth.username}
              onChange={(e) =>
                setFormularioAuth({
                  ...formularioAuth,
                  username: e.target.value
                })
              }
              className="input"
            />
            <input
              type="password"
              placeholder="Contraseña"
              value={formularioAuth.password}
              onChange={(e) =>
                setFormularioAuth({
                  ...formularioAuth,
                  password: e.target.value
                })
              }
              className="input"
            />
            <button type="submit" className="boton-primario">
              {modoAuth === "login" ? "Entrar" : "Crear cuenta"}
            </button>
          </form>
          <button
            className="boton-secundario"
            style={{ marginTop: 8 }}
            onClick={() =>
              setModoAuth(modoAuth === "login" ? "register" : "login")
            }
          >
            {modoAuth === "login"
              ? "¿No tienes cuenta? Regístrate"
              : "¿Ya tienes cuenta? Inicia sesión"}
          </button>
        </div>
      </div>
    );
  }

  // APP PRINCIPAL
  return (
    <div className="contenedor">
      <div className={`app ${hasActiveChat ? "has-active-chat" : ""}`}>
        {/* Modal de llamada entrante GLOBAL */}
        {incomingCall && (
          <IncomingCallModal incomingCall={incomingCall} usuarios={usuarios} />
        )}

        {/* Barra superior */}
        <BarraEncabezado
          usuario={usuario}
          estadoWs={estadoWS}
          onLogout={cerrarSesion}
        />

        <div className="cuerpo">
          {/* Panel lateral (usuarios + salas) */}
          <PanelLateral
            usuariosConectados={usuariosConectados}
            usuariosDesconectados={usuariosOffline}
            salas={salas}
            noLeidosPorLlave={noLeidosPorClave}
            onSeleccionarUsuario={seleccionarUsuario}
            onSeleccionarSala={seleccionarSala}
            tipoChat={tipoChat}
            usuarioSeleccionado={usuarioSeleccionado}
            salaSeleccionada={salaSeleccionada}
            onAbrirModalSeleccion={abrirModalElegirMiembros}
            onEliminarSala={eliminarSala}
            getConversationKey={getConversationKey}
          />

          {/* Área central: pestañas + chat */}
          <div className="area-chat">
            <BarraPestanias
              pestaniasAbiertas={pestanasAbiertas}
              llaveActiva={claveActiva}
              noLeidosPorLlave={noLeidosPorClave}
              onClickPestania={(tab) => {
                const entidad = tab.type === "user"
                  ? usuarios.find(u => u.id === tab.id)
                  : salas.find(s => s.id === tab.id);
                if (entidad) {
                  abrirPestanaConversacion(tab.type, entidad);
                }
              }}
              onCerrarPestania={cerrarPestana}
            />

            <AreaChat
              tipoChat={tipoChat}
              usuarioSeleccionado={usuarioSeleccionado}
              salaSeleccionada={salaSeleccionada}
              mensajesActuales={mensajesActuales}
              miembrosSalaPorId={miembrosSalaPorId}
              visibleTypingPrivado={escribiendoPrivadoVisible}
              visibleTypingSala={escribiendoSalaVisible}
              usuarioTypingSala={usuarioQueEscribeEnSala}
              textoMensaje={textoMensaje}
              onChangeMensaje={manejarCambioInput}
              onEnviarMensaje={enviarMensaje}
              usuarioActual={usuario}
              onAbrirModalMiembrosSala={abrirModalEditarMiembrosSala}
              usuarios={usuarios}

              // RTC props
              rtcInCall={rtcInCall}
              rtcCallMode={rtcCallMode}
              rtcLocalStream={rtcLocalStream}
              rtcRemoteStream={rtcRemoteStream}
              rtcStartCall={rtcStartCall}
              rtcEndCall={rtcEndCall}
              rtcToggleMic={rtcToggleMic}
              rtcIsMicMuted={rtcIsMicMuted}
              rtcToggleVideo={rtcToggleVideo}
              rtcIsVideoOff={rtcIsVideoOff}
              rtcRemoteVideoOff={rtcRemoteVideoOff}
              rtcRemoteMicMuted={rtcRemoteMicMuted}
              incomingCall={incomingCall}

              // Mobile nav
              onBack={handleBack}
            />
          </div>
        </div>

        {/* MODAL: Crear nueva sala */}
        <ModalCrearSala
          abierto={modalElegirMiembrosAbierto}
          usuarios={usuarios}
          idUsuarioActual={usuario.id}
          nombreSala={nombreNuevaSala}
          setNombreSala={setNombreNuevaSala}
          miembrosSalaSeleccionados={miembrosSeleccionadosSala}
          onAlternarMiembro={alternarMiembroSala}
          onCerrar={() => {
            cerrarModalElegirMiembros();
            setNombreNuevaSala("");
          }}
          onCrearSala={async () => {
            const exito = await crearSala();
            if (exito) {
              cerrarModalElegirMiembros();
            }
          }}
        />

        {/* MODAL: Editar integrantes de la sala actual */}
        <ModalMiembrosSala
          abierto={modalEditarMiembrosSalaAbierto}
          salaSeleccionada={salaSeleccionada}
          usuarios={usuarios}
          idUsuarioActual={usuario.id}
          miembrosSalaSeleccionados={miembrosSeleccionadosSala}
          onAlternarMiembro={alternarMiembroSala}
          onCerrar={cerrarModalEditarMiembrosSala}
          onGuardar={guardarCambiosMiembrosSala}
        />
      </div>
    </div>
  );
}

export default App;
