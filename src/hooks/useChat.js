// useChat.js
import { useEffect, useRef, useState } from "react";
import {
  getUsers,
  getRooms,
  getMessages,
  getRoomMessages,
  createRoom,
  getRoomMembers,
  updateRoomMembers,
  deleteRoom,
} from "../api";

// URL del WebSocket
//const WS_URL = "ws://localhost:4000/ws";
//const WS_URL = "ws://chat.hginet.com.co:4000/ws";
const WS_URL = "wss://backchat.hginet.com.co/ws";


// Helper: genera una clave única por conversación
export const getConversationKey = (type, id) => `${type}:${id}`;

/**
 * Hook principal de chat.
 * Recibe el token y el usuario logueado desde App.jsx
 */
export function useChat(token, usuarioActual) {
  // -----------------------------
  // ESTADO BASE
  // -----------------------------
  const [usuarios, setUsuarios] = useState([]);
  const [salas, setSalas] = useState([]);

  // Conversación activa
  const [tipoChat, setTipoChat] = useState(null); // "user" | "room"
  const [usuarioSeleccionado, setUsuarioSeleccionado] = useState(null);
  const [salaSeleccionada, setSalaSeleccionada] = useState(null);
  const [claveActiva, setClaveActiva] = useState(null); // ej: "user:2" o "room:3"

  // Pestañas abiertas: { key, type, id, label }
  const [pestanasAbiertas, setPestanasAbiertas] = useState([]);

  // Mensajes por conversación { [key]: Message[] }
  const [mensajesPorClave, setMensajesPorClave] = useState({});
  // No leídos por conversación { [key]: number }
  const [noLeidosPorClave, setNoLeidosPorClave] = useState({});

  // WebSocket
  const [estadoWS, setEstadoWS] = useState("disconnected"); // "disconnected" | "connecting" | "connected"

  // Entrada de texto
  const [textoMensaje, setTextoMensaje] = useState("");

  // Creación / edición de salas
  const [nombreNuevaSala, setNombreNuevaSala] = useState("");
  const [miembrosSeleccionadosSala, setMiembrosSeleccionadosSala] = useState(
    []
  ); // ids usuarios
  const [modalElegirMiembrosAbierto, setModalElegirMiembrosAbierto] =
    useState(false);
  const [modalEditarMiembrosSalaAbierto, setModalEditarMiembrosSalaAbierto] =
    useState(false);

  // Mapa de miembros de salas { [roomId]: number[] }
  const [miembrosSalaPorId, setMiembrosSalaPorId] = useState({});

  // Indicadores "escribiendo..."
  const [escribiendoPrivadoDesde, setEscribiendoPrivadoDesde] = useState(null); // userId
  const [infoEscribiendoSala, setInfoEscribiendoSala] = useState(null); // { fromUserId, roomId }

  // Refs
  const wsRef = useRef(null);
  const cierreManualRef = useRef(false); // para saber si el cierre es intencional
  const mensajesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null); // timeout para limpiar indicador "escribiendo"

  // -----------------------------
  // SCROLL AUTOMÁTICO AL FINAL
  // -----------------------------
  useEffect(() => {
    if (mensajesEndRef.current) {
      mensajesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [mensajesPorClave, claveActiva]);

  // -----------------------------
  // CARGAR USUARIOS Y SALAS
  // -----------------------------
  useEffect(() => {
    if (!token) return;

    getUsers(token)
      .then((u) => setUsuarios(u || []))
      .catch(console.error);

    getRooms(token)
      .then((rs) => {
        setSalas(rs || []);
        const mapa = {};
        (rs || []).forEach((r) => {
          if (Array.isArray(r.members)) {
            mapa[r.id] = r.members;
          }
        });
        setMiembrosSalaPorId(mapa);
      })
      .catch(console.error);
  }, [token]);

  // -----------------------------
  // CONEXIÓN WEBSOCKET (+ REINTENTOS)
  // -----------------------------
  useEffect(() => {
    if (!token) return;

    let retryTimeout = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;
    const RECONNECT_DELAY = 3000;

    const conectar = () => {
      // Si ya hay una conexión abierta, no crear otra
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        console.log("WS ya está conectado");
        return;
      }

      cierreManualRef.current = false;
      setEstadoWS("connecting");

      try {
        const socket = new WebSocket(`${WS_URL}?token=${token}`);
        wsRef.current = socket;

        socket.onopen = () => {
          console.log("WS conectado");
          setEstadoWS("connected");
          reconnectAttempts = 0; // Resetear contador al conectar exitosamente
        };

        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data || "{}");

            if (data.type === "USER_LIST") {
              setUsuarios(data.users || []);
            }

            if (data.type === "MESSAGE") {
              const m = data.message;
              if (!m) return;

              const otroId =
                m.from_user_id === usuarioActual?.id ? m.to_user_id : m.from_user_id;
              const key = getConversationKey("user", otroId);

              setMensajesPorClave((prev) => ({
                ...prev,
                [key]: [...(prev[key] || []), m],
              }));

              // Solo sumar no leídos si NO es la conversación activa y el mensaje no es del usuario actual
              setNoLeidosPorClave((prev) => {
                if (key !== claveActiva && m.from_user_id !== usuarioActual?.id) {
                  return { ...prev, [key]: (prev[key] || 0) + 1 };
                }
                return prev;
              });
            }

            if (data.type === "ROOM_MESSAGE") {
              const m = data.message;
              if (!m) return;
              const key = getConversationKey("room", m.room_id);

              setMensajesPorClave((prev) => ({
                ...prev,
                [key]: [...(prev[key] || []), m],
              }));

              // Solo sumar no leídos si NO es la conversación activa y el mensaje no es del usuario actual
              setNoLeidosPorClave((prev) => {
                if (key !== claveActiva && m.from_user_id !== usuarioActual?.id) {
                  return { ...prev, [key]: (prev[key] || 0) + 1 };
                }
                return prev;
              });
            }

            if (data.type === "TYPING") {
              // Solo mostrar el indicador si el que está escribiendo NO es el usuario actual
              if (data.fromUserId !== usuarioActual?.id) {
                if (data.isTyping) {
                  setEscribiendoPrivadoDesde(data.fromUserId);
                  // Limpiar el indicador después de 3 segundos de inactividad
                  if (typingTimeoutRef.current) {
                    clearTimeout(typingTimeoutRef.current);
                  }
                  typingTimeoutRef.current = setTimeout(() => {
                    setEscribiendoPrivadoDesde(null);
                  }, 3000);
                } else {
                  setEscribiendoPrivadoDesde(null);
                  if (typingTimeoutRef.current) {
                    clearTimeout(typingTimeoutRef.current);
                  }
                }
              } else {
                // Si es el usuario actual escribiendo, no mostrar nada
                setEscribiendoPrivadoDesde(null);
              }
            }

            if (data.type === "TYPING_ROOM") {
              // Solo mostrar el indicador si el que está escribiendo NO es el usuario actual
              if (data.fromUserId !== usuarioActual?.id) {
                if (data.isTyping) {
                  setInfoEscribiendoSala({
                    fromUserId: data.fromUserId,
                    roomId: data.roomId
                  });
                  // Limpiar el indicador después de 3 segundos de inactividad
                  if (typingTimeoutRef.current) {
                    clearTimeout(typingTimeoutRef.current);
                  }
                  typingTimeoutRef.current = setTimeout(() => {
                    setInfoEscribiendoSala(null);
                  }, 3000);
                } else {
                  setInfoEscribiendoSala(null);
                  if (typingTimeoutRef.current) {
                    clearTimeout(typingTimeoutRef.current);
                  }
                }
              } else {
                // Si es el usuario actual escribiendo, no mostrar nada
                setInfoEscribiendoSala(null);
              }
            }

            // Estado de mensaje (opcional)
            if (data.type === "MESSAGE_STATUS") {
              const { messageId, status, scope } = data; // scope: { type, id }
              if (!messageId || !status || !scope) return;
              const key = getConversationKey(scope.type, scope.id);

              setMensajesPorClave((prev) => {
                const actual = prev[key] || [];
                const actualizado = actual.map((msg) =>
                  msg.id === messageId ? { ...msg, status } : msg
                );
                return { ...prev, [key]: actualizado };
              });
            }

            // Actualización de miembros de sala (opcional)
            if (data.type === "ROOM_MEMBERS_UPDATED") {
              const { roomId, members } = data;
              setMiembrosSalaPorId((prev) => ({
                ...prev,
                [roomId]: members || [],
              }));
            }
          } catch (parseError) {
            console.error("Error parseando mensaje WS:", parseError);
          }
        };

        socket.onerror = (err) => {
          console.error("WS error", err);
          // No cerrar la conexión automáticamente en caso de error
          // El onclose se encargará de la reconexión si es necesario
        };

        socket.onclose = (event) => {
          console.log("WS cerrado", event.code, event.reason);
          setEstadoWS("disconnected");
          wsRef.current = null;

          // Reintentar SOLO si no fue un cierre manual y no excedimos los intentos
          if (!cierreManualRef.current && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            console.log(`WS cerrado, reintentando... (intento ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
            retryTimeout = setTimeout(conectar, RECONNECT_DELAY);
          } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.error("Máximo de intentos de reconexión alcanzado");
            setEstadoWS("disconnected");
          }
        };
      } catch (error) {
        console.error("Error creando WebSocket:", error);
        setEstadoWS("disconnected");
        // Reintentar después de un delay
        if (!cierreManualRef.current && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          retryTimeout = setTimeout(conectar, RECONNECT_DELAY);
        }
      }
    };

    conectar();

    // Cleanup del efecto
    return () => {
      cierreManualRef.current = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (wsRef.current) {
        try {
          if (wsRef.current.readyState === WebSocket.OPEN || 
              wsRef.current.readyState === WebSocket.CONNECTING) {
            wsRef.current.close();
          }
        } catch (error) {
          console.error("Error cerrando WebSocket:", error);
        }
        wsRef.current = null;
      }
    };
  }, [token, usuarioActual?.id]); // Removido claveActiva de las dependencias para evitar reconexiones innecesarias

  // -----------------------------
  // FUNCIONES DE CONVERSACIONES
  // -----------------------------
  const marcarConversacionLeida = (type, id, key) => {
    const convKey = key || getConversationKey(type, id);

    setNoLeidosPorClave((prev) => ({ ...prev, [convKey]: 0 }));

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "READ_CONVERSATION",
          scope: { type, id },
        })
      );
    }
  };

  const abrirPestanaConversacion = (type, entidad) => {
    const id = entidad.id;
    const etiqueta = type === "user" ? entidad.username : `# ${entidad.name}`;
    const key = getConversationKey(type, id);

    setTipoChat(type);
    if (type === "user") {
      setUsuarioSeleccionado(entidad);
      setSalaSeleccionada(null);
      setInfoEscribiendoSala(null);
    } else {
      setSalaSeleccionada(entidad);
      setUsuarioSeleccionado(null);
      setEscribiendoPrivadoDesde(null);
    }

    setClaveActiva(key);
    setPestanasAbiertas((prev) => {
      if (prev.some((t) => t.key === key)) return prev;
      return [...prev, { key, type, id, label: etiqueta }];
    });

    // Siempre marcar como leída cuando se abre o cambia a esta conversación
    marcarConversacionLeida(type, id, key);
  };

  const seleccionarUsuario = async (u) => {
    abrirPestanaConversacion("user", u);
    if (!token) return;
    const key = getConversationKey("user", u.id);
    if (mensajesPorClave[key] && mensajesPorClave[key].length > 0) return;

    try {
      const msgs = await getMessages(token, u.id);
      setMensajesPorClave((prev) => ({ ...prev, [key]: msgs || [] }));
    } catch (err) {
      console.error(err);
    }
  };

  const seleccionarSala = async (room) => {
    abrirPestanaConversacion("room", room);
    if (!token) return;
    const key = getConversationKey("room", room.id);
    
    // Cargar mensajes si no están cargados
    if (!mensajesPorClave[key] || mensajesPorClave[key].length === 0) {
      try {
        const msgs = await getRoomMessages(token, room.id);
        setMensajesPorClave((prev) => ({ ...prev, [key]: msgs || [] }));
      } catch (err) {
        console.error(err);
      }
    }

    // Cargar miembros de la sala
    try {
      const members = await getRoomMembers(token, room.id);
      const memberIds = members.map(m => m.id);
      setMiembrosSalaPorId((prev) => ({ ...prev, [room.id]: memberIds }));
    } catch (err) {
      console.error("Error cargando miembros de sala:", err);
    }
  };

  const cerrarPestana = (keyCerrar) => {
    setPestanasAbiertas((prev) => prev.filter((t) => t.key !== keyCerrar));

    if (keyCerrar === claveActiva) {
      setTimeout(() => {
        setPestanasAbiertas((prevTabs) => {
          if (prevTabs.length === 0) {
            setClaveActiva(null);
            setTipoChat(null);
            setUsuarioSeleccionado(null);
            setSalaSeleccionada(null);
            return prevTabs;
          }
          const last = prevTabs[prevTabs.length - 1];
          setClaveActiva(last.key);
          if (last.type === "user") {
            const u = usuarios.find((x) => x.id === last.id);
            if (u) {
              setTipoChat("user");
              setUsuarioSeleccionado(u);
              setSalaSeleccionada(null);
            }
          } else {
            const r = salas.find((x) => x.id === last.id);
            if (r) {
              setTipoChat("room");
              setSalaSeleccionada(r);
              setUsuarioSeleccionado(null);
            }
          }
          return prevTabs;
        });
      }, 0);
    }
  };

  // -----------------------------
  // ESCRIBIENDO / ENVÍO DE MENSAJES
  // -----------------------------
  const enviarTyping = (isTyping) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    if (tipoChat === "user" && usuarioSeleccionado) {
      wsRef.current.send(
        JSON.stringify({
          type: "TYPING",
          toUserId: usuarioSeleccionado.id,
          isTyping,
        })
      );
    }

    if (tipoChat === "room" && salaSeleccionada) {
      wsRef.current.send(
        JSON.stringify({
          type: "TYPING_ROOM",
          roomId: salaSeleccionada.id,
          isTyping,
        })
      );
    }
  };

  const manejarCambioInput = (e) => {
    const value = e.target.value;
    setTextoMensaje(value);
    enviarTyping(value.length > 0);
  };

  const enviarMensaje = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (!textoMensaje.trim()) return;
    if (!tipoChat || !claveActiva) return;

    const contenido = textoMensaje.trim();

    if (tipoChat === "user" && usuarioSeleccionado) {
      wsRef.current.send(
        JSON.stringify({
          type: "MESSAGE",
          toUserId: usuarioSeleccionado.id,
          content: contenido,
        })
      );
    }

    if (tipoChat === "room" && salaSeleccionada) {
      wsRef.current.send(
        JSON.stringify({
          type: "ROOM_MESSAGE",
          roomId: salaSeleccionada.id,
          content: contenido,
        })
      );
    }

    setTextoMensaje("");
    enviarTyping(false);
  };

  // -----------------------------
  // SALAS: CREAR / EDITAR MIEMBROS
  // -----------------------------
  const alternarMiembroSala = (userId) => {
    setMiembrosSeleccionadosSala((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  const crearSala = async () => {
    if (!nombreNuevaSala.trim()) {
      alert("Escribe un nombre para la sala");
      return;
    }
    if (!token) return;

    try {
      await createRoom(token, nombreNuevaSala.trim(), miembrosSeleccionadosSala);
      setNombreNuevaSala("");
      setMiembrosSeleccionadosSala([]);
      const roomsRes = await getRooms(token);
      setSalas(roomsRes || []);
      return true; // éxito
    } catch (err) {
      console.error(err);
      alert(err.error || "Error creando sala");
      return false; // error
    }
  };

  const eliminarSala = async (roomId) => {
    if (!token) {
      console.error("No hay token para eliminar sala");
      return;
    }
    if (!confirm("¿Estás seguro de que quieres eliminar esta sala? Esta acción no se puede deshacer.")) {
      return;
    }

    console.log("Eliminando sala:", roomId);

    try {
      const result = await deleteRoom(token, roomId);
      console.log("Sala eliminada exitosamente:", result);
      
      // Cerrar la pestaña si está abierta
      const key = getConversationKey("room", roomId);
      cerrarPestana(key);
      
      // Recargar lista de salas
      const roomsRes = await getRooms(token);
      setSalas(roomsRes || []);
      
      // Limpiar mensajes de la sala eliminada
      setMensajesPorClave((prev) => {
        const nuevo = { ...prev };
        delete nuevo[key];
        return nuevo;
      });
      
      // Limpiar miembros de la sala
      setMiembrosSalaPorId((prev) => {
        const nuevo = { ...prev };
        delete nuevo[roomId];
        return nuevo;
      });
    } catch (err) {
      console.error("Error eliminando sala:", err);
      console.error("Detalles del error:", JSON.stringify(err, null, 2));
      const errorMsg = err.error || err.message || "Error eliminando sala";
      alert(`Error: ${errorMsg}`);
    }
  };

  const abrirModalElegirMiembros = () => setModalElegirMiembrosAbierto(true);
  const cerrarModalElegirMiembros = () => setModalElegirMiembrosAbierto(false);

  const abrirModalEditarMiembrosSala = async () => {
    if (!salaSeleccionada || !token) return;
    
    // Cargar miembros actuales de la sala desde el servidor
    try {
      const members = await getRoomMembers(token, salaSeleccionada.id);
      const memberIds = members.map(m => m.id);
      setMiembrosSeleccionadosSala(memberIds);
      setMiembrosSalaPorId((prev) => ({ ...prev, [salaSeleccionada.id]: memberIds }));
    } catch (err) {
      console.error("Error cargando miembros:", err);
      // Si falla, usar los que ya tenemos en el estado
      const actuales = miembrosSalaPorId[salaSeleccionada.id] || [];
      setMiembrosSeleccionadosSala(actuales);
    }
    
    setModalEditarMiembrosSalaAbierto(true);
  };

  const cerrarModalEditarMiembrosSala = () =>
    setModalEditarMiembrosSalaAbierto(false);

  const guardarCambiosMiembrosSala = async () => {
    if (!salaSeleccionada || !token) {
      console.error("No hay sala seleccionada o token");
      return;
    }
    const roomId = salaSeleccionada.id;
    const miembros = miembrosSeleccionadosSala.slice();

    console.log("Guardando cambios de miembros:", { roomId, miembros });

    try {
      // Actualizar en el servidor
      console.log("Llamando a updateRoomMembers...");
      const result = await updateRoomMembers(token, roomId, miembros);
      console.log("Resultado de updateRoomMembers:", result);
      
      // Recargar miembros desde el servidor para asegurar sincronización
      try {
        console.log("Recargando miembros desde servidor...");
        const members = await getRoomMembers(token, roomId);
        console.log("Miembros recargados:", members);
        const memberIds = members.map(m => m.id);
        setMiembrosSalaPorId((prev) => ({ ...prev, [roomId]: memberIds }));
      } catch (reloadErr) {
        console.error("Error recargando miembros:", reloadErr);
        // Si falla, usar los que enviamos
        setMiembrosSalaPorId((prev) => ({ ...prev, [roomId]: miembros }));
      }
      
      setModalEditarMiembrosSalaAbierto(false);

      // Notificar a otros usuarios vía WebSocket (opcional)
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "UPDATE_ROOM_MEMBERS",
            roomId,
            members: miembros,
          })
        );
      }
    } catch (err) {
      console.error("Error actualizando miembros:", err);
      console.error("Detalles del error:", JSON.stringify(err, null, 2));
      const errorMsg = err.error || err.message || "Error actualizando miembros de la sala";
      alert(`Error: ${errorMsg}`);
    }
  };

  // -----------------------------
  // DERIVADOS / CÁLCULOS
  // -----------------------------
  const escribiendoPrivadoVisible =
    tipoChat === "user" &&
    usuarioSeleccionado &&
    escribiendoPrivadoDesde === usuarioSeleccionado.id;

  const escribiendoSalaVisible =
    tipoChat === "room" &&
    salaSeleccionada &&
    infoEscribiendoSala &&
    infoEscribiendoSala.roomId === salaSeleccionada.id;

  const usuarioQueEscribeEnSala =
    escribiendoSalaVisible && infoEscribiendoSala
      ? usuarios.find((u) => u.id === infoEscribiendoSala.fromUserId)
      : null;

  const usuariosConectados = usuarios.filter(
    (u) => u.id !== usuarioActual?.id && u.online
  );
  const usuariosOffline = usuarios.filter(
    (u) => u.id !== usuarioActual?.id && !u.online
  );

  const mensajesActuales = claveActiva
    ? mensajesPorClave[claveActiva] || []
    : [];

  // -----------------------------
  // API PÚBLICA DEL HOOK
  // -----------------------------
  return {
    // Estado WS
    estadoWS,

    // Datos base
    usuarios,
    salas,
    miembrosSalaPorId,

    // Conversación actual
    tipoChat,
    usuarioSeleccionado,
    salaSeleccionada,
    claveActiva,

    // Pestañas
    pestanasAbiertas,
    cerrarPestana,
    abrirPestanaConversacion,

    // Mensajes
    mensajesPorClave,
    mensajesActuales,
    noLeidosPorClave,
    mensajesEndRef,
    marcarConversacionLeida,

    // Listas de usuarios
    usuariosConectados,
    usuariosOffline,

    // Selección
    seleccionarUsuario,
    seleccionarSala,

    // Escritura / envío
    textoMensaje,
    setTextoMensaje,
    manejarCambioInput,
    enviarMensaje,

    // Indicadores escribiendo
    escribiendoPrivadoVisible,
    escribiendoSalaVisible,
    usuarioQueEscribeEnSala,

    // Salas / miembros
    nombreNuevaSala,
    setNombreNuevaSala,
    miembrosSeleccionadosSala,
    alternarMiembroSala,
    crearSala,
    eliminarSala,

    // Modales
    modalElegirMiembrosAbierto,
    abrirModalElegirMiembros,
    cerrarModalElegirMiembros,
    modalEditarMiembrosSalaAbierto,
    abrirModalEditarMiembrosSala,
    cerrarModalEditarMiembrosSala,
    guardarCambiosMiembrosSala,

    // Helper
    getConversationKey,
  };
}
