import { useRef, useState, useCallback, useEffect } from "react";

// Servidores STUN/TURN para WebRTC
// STUN: Descubre IP pública (gratis, Google)
// TURN: Relay cuando P2P directo falla (tu servidor)
const ICE_SERVERS = [
  // STUN servers (descubrimiento de IP pública)
  { urls: "stun:stun.l.google.com:19302" },
  // TURN server (relay cuando P2P directo no funciona)
  {
    urls: [
      "turn:turn.hginet.com.co:3478?transport=udp",
      "turn:turn.hginet.com.co:3478?transport=tcp"
    ],
    username: "chatHgi",
    credential: "Laverdad2026*"
  }
];

// ============================================
// SISTEMA DE MANEJO DE ERRORES CENTRALIZADO
// ============================================
const ErrorCodes = {
  // Errores de inicialización
  NO_USER_DESTINATION: "ERR_001",
  PEER_CONNECTION_FAILED: "ERR_002",
  DATA_CHANNEL_FAILED: "ERR_003",
  
  // Errores de media
  MEDIA_ACCESS_DENIED: "ERR_101",
  MEDIA_DEVICE_ERROR: "ERR_102",
  MEDIA_STREAM_ERROR: "ERR_103",
  
  // Errores de señalización
  OFFER_CREATION_FAILED: "ERR_201",
  ANSWER_CREATION_FAILED: "ERR_202",
  SET_LOCAL_DESCRIPTION_FAILED: "ERR_203",
  SET_REMOTE_DESCRIPTION_FAILED: "ERR_204",
  
  // Errores de ICE
  ICE_CANDIDATE_ERROR: "ERR_301",
  ICE_CONNECTION_FAILED: "ERR_302",
  ICE_GATHERING_FAILED: "ERR_303",
  
  // Errores de WebSocket
  WEBSOCKET_NOT_OPEN: "ERR_401",
  WEBSOCKET_SEND_FAILED: "ERR_402",
  
  // Errores de estado
  NO_PEER_CONNECTION: "ERR_501",
  INVALID_SDP: "ERR_502",
  INVALID_CANDIDATE: "ERR_503",
  
  // Errores de conexión
  CONNECTION_FAILED: "ERR_601",
  CONNECTION_TIMEOUT: "ERR_602"
};

/**
 * Función centralizada para loggear errores de manera consistente
 */
const logError = (code, message, details = {}, severity = "error") => {
  const errorInfo = {
    code,
    message,
    timestamp: new Date().toISOString(),
    ...details
  };
  
  const logMethod = severity === "error" ? console.error : console.warn;
  const emoji = severity === "error" ? "❌" : "⚠️";
  
  logMethod(`${emoji} [${code}] ${message}`, errorInfo);
  
  return errorInfo;
};

/**
 * Función para loggear errores críticos (que requieren acción inmediata)
 */
const logCriticalError = (code, message, details = {}) => {
  return logError(code, message, details, "error");
};

/**
 * Función para loggear advertencias (errores no críticos)
 */
const logWarning = (code, message, details = {}) => {
  return logError(code, message, details, "warning");
};
// Obtiene stream según modo. Para "screen" combinamos pantalla + micrófono (mejor compatibilidad)
async function getMediaStream(mode) {
  if (mode === "screen") {
    // pedir pantalla (video) y micrófono por separado para maximizar compatibilidad
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    // intentar obtener micrófono (si el usuario lo permite)
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (mic && mic.getAudioTracks().length > 0) {
        // añadir la pista de micrófono a la pantalla
        screenStream.addTrack(mic.getAudioTracks()[0]);
      }
    } catch (e) {
      // si no permite micrófono, seguimos solo con la pantalla
      console.warn("No se pudo obtener micrófono para compartir pantalla:", e);
    }
    return screenStream;
  }

  // modo "video" o "audio"
  return navigator.mediaDevices.getUserMedia({
    video: mode === "video",
    audio: true,
  });
}

/**
 * useRtc
 * - wsRef: ref del WebSocket (el mismo que usa useChat)
 * - localUser: { id, username } (opcional, se usa solo para enviar metadata)
 * - callbacks: { onIncomingCall, onCallStateChange } (opcionales)
 */
export function useRtc(wsRef, localUser, callbacks = {}) {
  const pcRef = useRef(null);
  const dataChannelRef = useRef(null);

  const localStreamRef = useRef(null);   // MediaStream local
  const remoteStreamRef = useRef(null);  // MediaStream remoto (MediaStream object)
  const incomingOfferRef = useRef(null); // almacenar offer entrante mientras el user decide
  const iceCandidatesQueue = useRef([]); // Cola de candidatos ICE
  const remoteUserIdRef = useRef(null);  // Ref para mantener el ID del usuario remoto

  const [inCall, setInCall] = useState(false);
  const [callMode, setCallMode] = useState(null); // "video"|"audio"|"screen"
  const [remoteUser, setRemoteUser] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null); // State para provocar re-render
  const [remoteMicMuted, setRemoteMicMuted] = useState(false); // Estado de mute remoto
  const [isVideoOff, setIsVideoOff] = useState(false); // Estado de video local apagado
  const [remoteVideoOff, setRemoteVideoOff] = useState(false); // Estado de video remoto apagado

  const { onIncomingCall, onCallStateChange } = callbacks;

  // enviar señal por WS (con chequeo)
  const sendSignal = (payload) => {
    if (!wsRef?.current || wsRef.current.readyState !== WebSocket.OPEN) {
      logWarning(ErrorCodes.WEBSOCKET_NOT_OPEN, "No se puede enviar señal, WebSocket no está abierto", {
        payloadType: payload?.type,
        readyState: wsRef?.current?.readyState
      });
      return;
    }
    
    try {
      console.log("📤 Enviando señal WebRTC:", payload.type, "a usuario:", payload.toUserId);
      wsRef.current.send(JSON.stringify(payload));
    } catch (err) {
      logCriticalError(ErrorCodes.WEBSOCKET_SEND_FAILED, "Error enviando señal por WebSocket", {
        error: err.message,
        payloadType: payload?.type,
        toUserId: payload?.toUserId
      });
    }
  };

  // crea (o retorna) RTCPeerConnection
  const createPeerConnection = () => {
    if (pcRef.current) {
      console.log("📞 PeerConnection ya existe, reutilizando");
      return pcRef.current;
    }

    console.log("📞 Creando nuevo RTCPeerConnection con ICE servers:", ICE_SERVERS);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    
    // Log de errores del PeerConnection
    pc.onerror = (error) => {
      logCriticalError(ErrorCodes.PEER_CONNECTION_FAILED, "Error en RTCPeerConnection", {
        error: error?.message || String(error),
        errorType: error?.type,
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState
      });
    };

    // ICE candidate local -> enviar al otro
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        const targetUserId = remoteUserIdRef.current;
        if (targetUserId) {
          console.log("📞 ICE candidate generado localmente, enviando a:", targetUserId);
          sendSignal({
            type: "RTC_ICE_CANDIDATE",
            toUserId: targetUserId,
            candidate: ev.candidate,
          });
        } else {
          logWarning(ErrorCodes.ICE_CANDIDATE_ERROR, "ICE candidate generado pero no hay remoteUserId aún", {
            candidate: ev.candidate?.candidate?.substring(0, 50) + "...",
            note: "Se perderá este candidato, pero los siguientes se enviarán correctamente"
          });
        }
      } else if (ev.candidate === null) {
        console.log("📞 ICE gathering completado");
      }
    };

    // Cuando llegan tracks remotos
    pc.ontrack = (event) => {
      const track = event.track;
      if (!track) return;
      
      console.log("📞 Track remoto recibido:", track.kind, track.id);

      setRemoteStream((prevStream) => {
        // Si ya tenemos un stream, le agregamos el track
        if (prevStream) {
          prevStream.addTrack(track);
          return prevStream; // Misma referencia, pero el video element lo detecta si ya está asignado
        } else {
          // Si no, creamos uno nuevo
          const newStream = new MediaStream();
          newStream.addTrack(track);
          return newStream;
        }
      });
    };

    // Data channel (si el peer crea uno)
    pc.ondatachannel = (ev) => {
      dataChannelRef.current = ev.channel;
      setupDataChannel(ev.channel);
    };

    // Estado de conexión
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      const iceState = pc.iceConnectionState;
      const iceGatheringState = pc.iceGatheringState;
      
      console.log("📞 RTC Connection State:", {
        connectionState: state,
        iceConnectionState: iceState,
        iceGatheringState: iceGatheringState
      });
      
      if (state === "connected") {
        console.log("✅✅✅ Conexión WebRTC establecida exitosamente!");
      } else if (state === "disconnected") {
        console.warn("⚠️ Conexión WebRTC desconectada");
      } else if (state === "failed") {
        logCriticalError(ErrorCodes.CONNECTION_FAILED, "Conexión WebRTC falló", {
          connectionState: state,
          iceConnectionState: iceState,
          iceGatheringState: iceGatheringState,
          signalingState: pcRef.current?.signalingState
        });
      } else if (state === "connecting") {
        console.log("🔄 Conectando WebRTC... Estado ICE:", iceState);
      } else if (state === "closed") {
        console.log("🔒 Conexión WebRTC cerrada");
      }
    };

    // Estado ICE (más detallado)
    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      console.log("📞 ICE Connection State:", iceState);
      
      if (iceState === "connected") {
        console.log("✅ ICE conectado");
      } else if (iceState === "failed") {
        logCriticalError(ErrorCodes.ICE_CONNECTION_FAILED, "ICE falló - Revisar STUN/TURN servers", {
          iceConnectionState: iceState,
          connectionState: pcRef.current?.connectionState,
          signalingState: pcRef.current?.signalingState,
          suggestion: "Verificar configuración de STUN/TURN servers y firewall"
        });
      } else if (iceState === "disconnected") {
        console.warn("⚠️ ICE desconectado");
      } else if (iceState === "checking") {
        console.log("🔍 ICE verificando conexión...");
      }
    };

    // Estado de gathering ICE
    pc.onicegatheringstatechange = () => {
      console.log("📞 ICE Gathering State:", pc.iceGatheringState);
    };

    pcRef.current = pc;
    return pc;
  };

  const setupDataChannel = (dc) => {
    dc.onopen = () => console.log("DataChannel abierto");
    dc.onclose = () => console.log("DataChannel cerrado");
    dc.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        console.log("RTC_DATA recibido", d);
        if (d.type === "MIC_STATUS") {
          setRemoteMicMuted(d.muted);
        }
        if (d.type === "VIDEO_STATUS") {
          setRemoteVideoOff(d.videoOff);
        }
      } catch (e) {
        console.warn("Mensaje no-JSON en datachannel", e);
      }
    };
  };

  const attachLocalTracks = (pc, stream) => {
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
  };

  // Procesar cola de candidatos ICE (para añadir candidatos recibidos)
  const processIceQueue = async () => {
    if (!pcRef.current || !pcRef.current.remoteDescription) return;
    console.log("📞 Procesando cola de ICE candidates, cantidad:", iceCandidatesQueue.current.length);
    while (iceCandidatesQueue.current.length > 0) {
      const candidate = iceCandidatesQueue.current.shift();
      try {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("📞 ICE candidate añadido de la cola");
      } catch (e) {
        logCriticalError(ErrorCodes.ICE_CANDIDATE_ERROR, "Error añadiendo ICE candidate de la cola", {
          error: e.message,
          errorName: e.name,
          candidate: candidate?.candidate?.substring(0, 50) + "..."
        });
      }
    }
  };


  // ---------------------------
  // Acción: iniciar llamada (emisor)
  // ---------------------------
  const startCall = async (toUser, mode = "video") => {
    console.log("🚀 ========== INICIANDO LLAMADA ==========");
    console.log("📞 Usuario destino:", toUser.username, "ID:", toUser.id);
    console.log("📞 Modo:", mode);
    
    if (!toUser) {
      logCriticalError(ErrorCodes.NO_USER_DESTINATION, "No se proporcionó usuario destino para iniciar llamada");
      return;
    }
    
    // si ya había una pc, cerrarla (recreate para evitar problemas entre modos)
    if (pcRef.current) {
      console.log("📞 Cerrando PeerConnection anterior...");
      pcRef.current.close();
      pcRef.current = null;
      dataChannelRef.current = null;
    }
    iceCandidatesQueue.current = []; // Limpiar cola

    setRemoteUser(toUser);
    remoteUserIdRef.current = toUser.id; // Guardar en ref para acceso en callbacks
    setCallMode(mode);
    console.log("📞 RemoteUserId establecido:", toUser.id);

    // crear pc y data channel
    console.log("📞 Creando PeerConnection...");
    const pc = createPeerConnection();
    console.log("📞 PeerConnection creado, ID:", pc ? "OK" : "ERROR");
    
    console.log("📞 Creando DataChannel...");
    const dc = pc.createDataChannel("data");
    dataChannelRef.current = dc;
    setupDataChannel(dc);
    console.log("📞 DataChannel creado");

    // obtener media local (puede pedir permisos)
    console.log("📞 Solicitando permisos de media (modo:", mode, ")...");
    try {
      const stream = await getMediaStream(mode);
      console.log("📞 Media local obtenido, tracks:", stream.getTracks().map(t => `${t.kind}:${t.id}`));
      localStreamRef.current = stream;
      attachLocalTracks(pc, stream);
      console.log("📞 Tracks locales añadidos al PeerConnection");
    } catch (err) {
      const errorCode = err.name === "NotAllowedError" || err.name === "PermissionDeniedError"
        ? ErrorCodes.MEDIA_ACCESS_DENIED
        : err.name === "NotFoundError" || err.name === "DevicesNotFoundError"
        ? ErrorCodes.MEDIA_DEVICE_ERROR
        : ErrorCodes.MEDIA_STREAM_ERROR;
      
      logCriticalError(errorCode, "Error obteniendo media local", {
        errorName: err.name,
        errorMessage: err.message,
        mode: mode,
        userMessage: err.name === "NotAllowedError" 
          ? "Permisos de cámara/micrófono denegados"
          : err.name === "NotFoundError"
          ? "Dispositivo de cámara/micrófono no encontrado"
          : "Error al acceder a los dispositivos multimedia"
      });
      
      alert(err.name === "NotAllowedError" 
        ? "No se pudo acceder a la cámara/micrófono. Por favor, permite el acceso en la configuración del navegador."
        : err.name === "NotFoundError"
        ? "No se encontró cámara/micrófono. Verifica que los dispositivos estén conectados."
        : "No se pudo acceder a la cámara/micrófono. Intenta nuevamente.");
      return;
    }

    // crear offer y setLocalDescription
    console.log("📞 Creando offer...");
    try {
      const offer = await pc.createOffer();
      console.log("📞 Offer creado:", {
        type: offer.type,
        sdp: offer.sdp ? offer.sdp.substring(0, 100) + "..." : "sin SDP"
      });
      
      await pc.setLocalDescription(offer);
      console.log("📞 LocalDescription establecido, estado:", pc.signalingState);
    } catch (err) {
      logCriticalError(ErrorCodes.OFFER_CREATION_FAILED, "Error creando offer", {
        errorName: err.name,
        errorMessage: err.message,
        signalingState: pc.signalingState,
        connectionState: pc.connectionState
      });
      endCall(false);
      return;
    }

    // enviar offer por WS (incluimos callMode)
    console.log("📞 Enviando offer a usuario:", toUser.id);
    sendSignal({
      type: "RTC_CALL_OFFER",
      toUserId: toUser.id,
      callMode: mode,
      sdp: offer,
    });

    setInCall(true);
    console.log("✅ Llamada iniciada, esperando answer...");
    console.log("📞 Estado actual - inCall:", true, "remoteUserId:", remoteUserIdRef.current);
    if (onCallStateChange) onCallStateChange({ inCall: true, role: "caller" });
  };

  // ---------------------------
  // Acción: colgar (notifyRemote=true por defecto, false si el remoto ya colgó)
  // ---------------------------
  const endCall = useCallback((notifyRemote = true) => {
    console.log("🔴 ========== FINALIZANDO LLAMADA ==========");
    console.log("📞 endCall ejecutado, notifyRemote:", notifyRemote);
    console.log("📞 Estado antes de limpiar - inCall:", inCall, "remoteUserId:", remoteUser?.id);
    
    // Guardar referencia al usuario remoto antes de limpiar
    const remoteUserId = remoteUser?.id;
    
    // cerrar pc si existe
    if (pcRef.current) {
      console.log("📞 Cerrando PeerConnection...");
      try {
        const senders = pcRef.current.getSenders();
        console.log("📞 Deteniendo", senders.length, "tracks locales");
        senders.forEach(s => {
          if (s.track) {
            console.log("📞 Deteniendo track:", s.track.kind, s.track.id);
            s.track.stop();
          }
        });
        console.log("📞 Cerrando PeerConnection, estado final:", pcRef.current.connectionState);
        pcRef.current.close();
      } catch (e) {
        logWarning(ErrorCodes.PEER_CONNECTION_FAILED, "Error cerrando PeerConnection", {
          error: e.message,
          note: "No crítico, continuando con limpieza"
        });
      }
      pcRef.current = null;
      console.log("✅ PeerConnection cerrado");
    } else {
      console.log("📞 No hay PeerConnection para cerrar");
    }

    // detener local stream
    if (localStreamRef.current) {
      console.log("📞 Deteniendo local stream...");
      const tracks = localStreamRef.current.getTracks();
      console.log("📞 Tracks a detener:", tracks.length);
      tracks.forEach(t => {
        console.log("📞 Deteniendo track:", t.kind, t.id, "estado:", t.readyState);
        t.stop();
      });
      localStreamRef.current = null;
      console.log("✅ Local stream detenido");
    }

    // limpiar remote stream
    console.log("📞 Limpiando remote stream...");
    remoteStreamRef.current = null;
    setRemoteStream(null);
    setRemoteMicMuted(false);
    setRemoteVideoOff(false);
    setIsVideoOff(false);
    iceCandidatesQueue.current = [];
    console.log("✅ Estados limpiados");

    // notificar al remoto que colgamos (solo si nosotros iniciamos el colgado)
    if (notifyRemote && remoteUserId) {
      console.log("📞 Notificando al usuario remoto que colgamos:", remoteUserId);
      sendSignal({ type: "RTC_CALL_END", toUserId: remoteUserId });
    } else {
      console.log("📞 No se notifica al remoto (notifyRemote:", notifyRemote, "remoteUserId:", remoteUserId, ")");
    }

    setInCall(false);
    setCallMode(null);
    setRemoteUser(null);
    remoteUserIdRef.current = null; // Limpiar ref
    console.log("✅✅✅ Llamada finalizada completamente");
    if (onCallStateChange) onCallStateChange({ inCall: false });
  }, [remoteUser, onCallStateChange, inCall]); // Añadido inCall a dependencias

  // Cleanup al desmontar
  useEffect(() => {
    return () => {
      if (inCall) {
        endCall();
      }
    };
  }, [inCall, endCall]);

  // ---------------------------
  // Manejar offer entrante (callee) — llamada aceptada (respuesta)
  // ---------------------------
  const acceptOffer = async (offerData) => {
    console.log("🚀 ========== ACEPTANDO LLAMADA ==========");
    // offerData: { fromUserId, callMode, sdp }
    const { fromUserId, callMode: mode, sdp } = offerData;
    console.log("📞 acceptOffer iniciado - fromUserId:", fromUserId, "mode:", mode);
    console.log("📞 Offer SDP recibido:", sdp ? "OK" : "ERROR", sdp?.type);
    
    setRemoteUser({ id: fromUserId });
    remoteUserIdRef.current = fromUserId; // Guardar en ref para acceso en callbacks
    setCallMode(mode);
    setRemoteMicMuted(false); // Resetear estado
    setRemoteVideoOff(false);
    setIsVideoOff(false);
    iceCandidatesQueue.current = []; // Limpiar cola
    console.log("📞 Estados inicializados, remoteUserId:", fromUserId);

    // crear o recrear pc
    if (pcRef.current) {
      console.log("📞 Cerrando PeerConnection anterior...");
      pcRef.current.close();
      pcRef.current = null;
      dataChannelRef.current = null;
    }
    const pc = createPeerConnection();
    console.log("📞 PeerConnection creado");

    // crear data channel estará en ondatachannel si el otro lo creó
    // primero setRemoteDescription (IMPORTANTE para no romper negociación)
    console.log("📞 Estableciendo RemoteDescription...");
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log("✅ RemoteDescription establecido, signalingState:", pc.signalingState);
    } catch (err) {
      logCriticalError(ErrorCodes.SET_REMOTE_DESCRIPTION_FAILED, "Error estableciendo RemoteDescription en acceptOffer", {
        errorName: err.name,
        errorMessage: err.message,
        sdpType: sdp?.type,
        signalingState: pc.signalingState,
        fromUserId: fromUserId
      });
      return;
    }

    // Procesar candidatos en cola ahora que tenemos remoteDescription
    console.log("📞 Procesando candidatos ICE en cola...");
    await processIceQueue();

    // obtener media local (según modo) y añadir tracks
    try {
      // FIX: Si me llaman para compartir pantalla ("screen"), yo solo envío audio (viewer)
      // Si es video o audio, respondo con lo mismo (video/audio)
      const myMode = mode === "screen" ? "audio" : mode;
      console.log("📞 Obteniendo media local, modo:", myMode);

      const stream = await getMediaStream(myMode);
      console.log("📞 Media local obtenido, tracks:", stream.getTracks().map(t => `${t.kind}:${t.id}`));
      localStreamRef.current = stream;
      attachLocalTracks(pc, stream);
      console.log("✅ Tracks locales añadidos al PeerConnection");
    } catch (err) {
      const errorCode = err.name === "NotAllowedError" || err.name === "PermissionDeniedError"
        ? ErrorCodes.MEDIA_ACCESS_DENIED
        : err.name === "NotFoundError" || err.name === "DevicesNotFoundError"
        ? ErrorCodes.MEDIA_DEVICE_ERROR
        : ErrorCodes.MEDIA_STREAM_ERROR;
      
      logWarning(errorCode, "Error obteniendo media local en acceptOffer", {
        errorName: err.name,
        errorMessage: err.message,
        mode: myMode,
        note: "Continuando sin media local - el otro usuario verá/escuchará, pero no al revés"
      });
      // Continuar sin media local si falla (el otro usuario verá/escuchará, pero no al revés)
    }

    // crear answer y enviarla
    console.log("📞 Creando answer...");
    try {
      const answer = await pc.createAnswer();
      console.log("📞 Answer creado:", {
        type: answer.type,
        sdp: answer.sdp ? answer.sdp.substring(0, 100) + "..." : "sin SDP"
      });
      
      await pc.setLocalDescription(answer);
      console.log("✅ LocalDescription establecido, signalingState:", pc.signalingState);

      console.log("📞 Enviando answer a usuario:", fromUserId);
      sendSignal({
        type: "RTC_CALL_ANSWER",
        toUserId: fromUserId,
        sdp: answer,
      });
      console.log("✅ Answer enviado exitosamente");
    } catch (err) {
      logCriticalError(ErrorCodes.ANSWER_CREATION_FAILED, "Error creando/enviando answer", {
        errorName: err.name,
        errorMessage: err.message,
        signalingState: pc.signalingState,
        fromUserId: fromUserId,
        stack: err.stack
      });
      return;
    }

    setInCall(true);
    console.log("✅✅✅ Llamada aceptada exitosamente, inCall = true");
    console.log("📞 Estado actual - inCall:", true, "remoteUserId:", remoteUserIdRef.current);
    if (onCallStateChange) onCallStateChange({ inCall: true, role: "callee" });
  };

  // ---------------------------
  // Manejar answer (caller recibe answer)
  // ---------------------------
  const handleAnswer = async (data) => {
    console.log("🚀 ========== RECIBIENDO ANSWER ==========");
    console.log("📞 handleAnswer recibido - data completa:", data);
    const { sdp, fromUserId } = data;
    console.log("📞 Answer de usuario:", fromUserId, "SDP type:", sdp?.type);
    
    // Si ya existe la conexión (renegociación o respuesta inicial), usamos la existente
    // Si no, creamos una nueva (flujo inicial raro si no hay pcRef)
    const pc = pcRef.current;
    
    if (!pc) {
      logCriticalError(ErrorCodes.NO_PEER_CONNECTION, "No hay PeerConnection cuando se recibe answer", {
        fromUserId: fromUserId,
        note: "Esto no debería pasar - el PC debería existir desde startCall",
        suggestion: "Verificar que startCall se haya ejecutado correctamente"
      });
      return;
    }
    
    console.log("📞 PeerConnection encontrado, signalingState actual:", pc.signalingState);
    console.log("📞 Estableciendo RemoteDescription con answer...");
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log("✅ RemoteDescription establecido correctamente");
      console.log("📞 Nuevo signalingState:", pc.signalingState);
      console.log("📞 ICE Connection State:", pc.iceConnectionState);
      
      // Procesar candidatos en cola
      console.log("📞 Procesando candidatos ICE en cola...");
      await processIceQueue();
      console.log("✅ ICE candidates procesados");
    } catch (err) {
      logCriticalError(ErrorCodes.SET_REMOTE_DESCRIPTION_FAILED, "Error en handleAnswer al establecer RemoteDescription", {
        errorName: err.name,
        errorMessage: err.message,
        signalingState: pc.signalingState,
        sdpType: sdp?.type,
        fromUserId: fromUserId,
        iceConnectionState: pc.iceConnectionState
      });
    }
  };

  // ---------------------------
  // Manejar ICE candidate entrante
  // ---------------------------
  const handleIceCandidate = async (data) => {
    const { candidate, fromUserId } = data;
    console.log("📞 ICE candidate recibido de:", fromUserId);
    console.log("📞 Candidate details:", {
      candidate: candidate.candidate?.substring(0, 50) + "...",
      sdpMLineIndex: candidate.sdpMLineIndex,
      sdpMid: candidate.sdpMid
    });
    
    const pc = pcRef.current;
    if (!pc) {
      logWarning(ErrorCodes.NO_PEER_CONNECTION, "No hay PeerConnection, ignorando ICE candidate", {
        fromUserId: fromUserId,
        candidate: candidate?.candidate?.substring(0, 50) + "..."
      });
      return;
    }

    console.log("📞 Estado actual PC - remoteDescription:", pc.remoteDescription ? "OK" : "NO", 
                "signalingState:", pc.signalingState);

    if (!pc.remoteDescription) {
      // Si no hay descripción remota, encolar
      console.log("📞 Encolando ICE candidate (remoteDescription no lista)");
      iceCandidatesQueue.current.push(candidate);
      console.log("📞 Candidatos en cola:", iceCandidatesQueue.current.length);
    } else {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("✅ ICE candidate añadido correctamente");
        console.log("📞 ICE Connection State después de añadir:", pc.iceConnectionState);
      } catch (e) {
        logCriticalError(ErrorCodes.ICE_CANDIDATE_ERROR, "Error añadiendo ICE candidate", {
          errorName: e.name,
          errorMessage: e.message,
          fromUserId: fromUserId,
          candidate: candidate?.candidate?.substring(0, 50) + "...",
          sdpMLineIndex: candidate?.sdpMLineIndex,
          sdpMid: candidate?.sdpMid,
          signalingState: pc.signalingState,
          remoteDescription: pc.remoteDescription ? "OK" : "NO"
        });
      }
    }
  };

  // ---------------------------
  // Exponer handler para mensajes WS
  // ---------------------------
  const handleWsMessage = useCallback(async (data) => {
    // data ya parseado por quien llama
    console.log("📥 Mensaje WebRTC recibido:", data.type, "de usuario:", data.fromUserId);
    
    switch (data.type) {
      case "RTC_CALL_OFFER":
        console.log("📥 ========== RTC_CALL_OFFER RECIBIDO ==========");
        console.log("📥 Detalles:", {
          fromUserId: data.fromUserId,
          callMode: data.callMode,
          sdpType: data.sdp?.type,
          inCall: inCall,
          currentRemoteUserId: remoteUser?.id
        });
        
        // RENEGOCIACIÓN: Si ya estamos en llamada con este usuario, aceptamos directo
        // Usamos == para evitar problemas de tipos (string vs number)
        if (inCall && remoteUser && remoteUser.id == data.fromUserId) {
          console.log("🔄 Renegociación detectada (cambio de modo), aceptando automáticamente...");
          await acceptOffer(data);
          return;
        } else {
          console.log("📥 Oferta recibida pero NO es renegociación automática:", {
            inCall,
            remoteUserId: remoteUser?.id,
            offerFromId: data.fromUserId
          });
        }

        // Guardar oferta y notificar UI para mostrar modal
        incomingOfferRef.current = data;
        if (onIncomingCall) {
          console.log("📥 Mostrando modal de llamada entrante...");
          onIncomingCall({
            fromUserId: data.fromUserId,
            callMode: data.callMode,
            accept: () => acceptOffer(data),
            reject: () => {
              console.log("📥 Llamada rechazada por usuario");
              // enviar rechazo (fin de llamada)
              sendSignal({ type: "RTC_CALL_END", toUserId: data.fromUserId });
              incomingOfferRef.current = null;
            },
            raw: data,
          });
        } else {
          console.log("📥 No hay callback onIncomingCall, aceptando automáticamente...");
          // Si no hay callback definido, aceptamos automáticamente (fallback)
          await acceptOffer(data);
        }
        break;

      case "RTC_CALL_ANSWER":
        console.log("📥 ========== RTC_CALL_ANSWER RECIBIDO ==========");
        console.log("📥 Data completa:", data);
        try {
          await handleAnswer(data);
        } catch (err) {
          logCriticalError(ErrorCodes.SET_REMOTE_DESCRIPTION_FAILED, "Error procesando RTC_CALL_ANSWER", {
            errorName: err.name,
            errorMessage: err.message,
            fromUserId: data.fromUserId,
            stack: err.stack
          });
        }
        break;

      case "RTC_ICE_CANDIDATE":
        console.log("📥 ========== RTC_ICE_CANDIDATE RECIBIDO ==========");
        try {
          await handleIceCandidate(data);
        } catch (err) {
          logCriticalError(ErrorCodes.ICE_CANDIDATE_ERROR, "Error procesando RTC_ICE_CANDIDATE", {
            errorName: err.name,
            errorMessage: err.message,
            fromUserId: data.fromUserId
          });
        }
        break;

      case "RTC_CALL_END":
        console.log("📥 ========== RTC_CALL_END RECIBIDO ==========");
        console.log("📥 Remoto colgó, finalizando llamada local");
        // remoto colgó -> limpiar sin notificar de vuelta (evitar loop)
        endCall(false); // false = no notificar al remoto (él ya sabe que colgó)
        break;

      default:
        console.log("📥 Mensaje WebRTC desconocido:", data.type);
        // ignorar
        break;
    }
  }, [onIncomingCall, endCall, inCall, remoteUser]); // Añadido inCall y remoteUser a dependencias

  // ---------------------------
  // Acción: mutear/desmutear micrófono
  // ---------------------------
  const [isMicMuted, setIsMicMuted] = useState(false);

  const toggleMic = useCallback(() => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      if (audioTracks.length > 0) {
        // Invertir estado del track
        const enabled = !audioTracks[0].enabled;
        audioTracks.forEach(track => track.enabled = enabled);
        setIsMicMuted(!enabled);

        // Enviar estado por Data Channel
        if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
          dataChannelRef.current.send(JSON.stringify({ type: "MIC_STATUS", muted: !enabled }));
        }
      }
    }
  }, []);

  // ---------------------------
  // Acción: apagar/encender cámara
  // ---------------------------
  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      if (videoTracks.length > 0) {
        // Invertir estado del track
        const enabled = !videoTracks[0].enabled;
        videoTracks.forEach(track => track.enabled = enabled);
        setIsVideoOff(!enabled);

        // Enviar estado por Data Channel
        if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
          dataChannelRef.current.send(JSON.stringify({ type: "VIDEO_STATUS", videoOff: !enabled }));
        }
      }
    }
  }, []);

  // ---------------------------
  // Retorno del hook
  // ---------------------------
  return {
    // estados / refs
    inCall,
    callMode,
    localStream: localStreamRef.current,
    remoteStream, // Usar el estado, no el ref
    remoteUser,
    isMicMuted,
    remoteMicMuted, // NUEVO
    isVideoOff,
    remoteVideoOff,

    // acciones
    startCall,
    endCall,
    toggleMic,
    toggleVideo,
    acceptOffer,      // opcional, para que UI pueda llamar directamente
    handleWsMessage,  // debe ser usado por el layer WS para enrutar mensajes RTC_*
  };
}
