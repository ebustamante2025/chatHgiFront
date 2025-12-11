import { useRef, useState, useCallback, useEffect } from "react";

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

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
    if (!wsRef?.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify(payload));
  };

  // crea (o retorna) RTCPeerConnection
  const createPeerConnection = () => {
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // ICE candidate local -> enviar al otro
    pc.onicecandidate = (ev) => {
      if (ev.candidate && remoteUser) {
        sendSignal({
          type: "RTC_ICE_CANDIDATE",
          toUserId: remoteUser.id,
          candidate: ev.candidate,
        });
      }
    };

    // Cuando llegan tracks remotos
    pc.ontrack = (event) => {
      const track = event.track;
      if (!track) return;

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
      console.log("RTC Connection State:", pc.connectionState);
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        // Opcional: manejar desconexión automática
      }
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

  // Procesar cola de candidatos ICE
  const processIceQueue = async () => {
    if (!pcRef.current || !pcRef.current.remoteDescription) return;
    while (iceCandidatesQueue.current.length > 0) {
      const candidate = iceCandidatesQueue.current.shift();
      try {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("ICE candidate añadido de la cola");
      } catch (e) {
        console.error("Error añadiendo ICE candidate de la cola:", e);
      }
    }
  };

  // ---------------------------
  // Acción: iniciar llamada (emisor)
  // ---------------------------
  const startCall = async (toUser, mode = "video") => {
    if (!toUser) return;
    // si ya había una pc, cerrarla (recreate para evitar problemas entre modos)
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
      dataChannelRef.current = null;
    }
    iceCandidatesQueue.current = []; // Limpiar cola

    setRemoteUser(toUser);
    setCallMode(mode);

    // crear pc y data channel
    const pc = createPeerConnection();
    const dc = pc.createDataChannel("data");
    dataChannelRef.current = dc;
    setupDataChannel(dc);

    // obtener media local (puede pedir permisos)
    try {
      const stream = await getMediaStream(mode);
      localStreamRef.current = stream;
      attachLocalTracks(pc, stream);
    } catch (err) {
      console.error("Error obteniendo media local:", err);
      alert("No se pudo acceder a la cámara/micrófono");
      return;
    }

    // crear offer y setLocalDescription
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // enviar offer por WS (incluimos callMode)
    sendSignal({
      type: "RTC_CALL_OFFER",
      toUserId: toUser.id,
      callMode: mode,
      sdp: offer,
    });

    setInCall(true);
    if (onCallStateChange) onCallStateChange({ inCall: true, role: "caller" });
  };

  // ---------------------------
  // Acción: colgar
  // ---------------------------
  const endCall = useCallback(() => {
    // cerrar pc si existe
    if (pcRef.current) {
      try {
        pcRef.current.getSenders().forEach(s => s.track && s.track.stop());
        pcRef.current.close();
      } catch (e) {
        console.warn("Error cerrando pc:", e);
      }
      pcRef.current = null;
    }

    // detener local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }

    // limpiar remote stream
    remoteStreamRef.current = null;
    setRemoteStream(null);
    setRemoteMicMuted(false);
    setRemoteVideoOff(false);
    setIsVideoOff(false);
    iceCandidatesQueue.current = [];

    // notificar al remoto que colgamos
    if (remoteUser) {
      sendSignal({ type: "RTC_CALL_END", toUserId: remoteUser.id });
    }

    setInCall(false);
    setCallMode(null);
    setRemoteUser(null);
    if (onCallStateChange) onCallStateChange({ inCall: false });
  }, [remoteUser, onCallStateChange]); // Dependencias para useCallback

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
    // offerData: { fromUserId, callMode, sdp }
    const { fromUserId, callMode: mode, sdp } = offerData;
    setRemoteUser({ id: fromUserId });
    setCallMode(mode);
    setRemoteMicMuted(false); // Resetear estado
    setRemoteVideoOff(false);
    setIsVideoOff(false);
    iceCandidatesQueue.current = []; // Limpiar cola

    // crear o recrear pc
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; dataChannelRef.current = null; }
    const pc = createPeerConnection();

    // crear data channel estará en ondatachannel si el otro lo creó
    // primero setRemoteDescription (IMPORTANTE para no romper negociación)
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));

    // Procesar candidatos en cola ahora que tenemos remoteDescription
    await processIceQueue();

    // obtener media local (según modo) y añadir tracks
    try {
      // FIX: Si me llaman para compartir pantalla ("screen"), yo solo envío audio (viewer)
      // Si es video o audio, respondo con lo mismo (video/audio)
      const myMode = mode === "screen" ? "audio" : mode;

      const stream = await getMediaStream(myMode);
      localStreamRef.current = stream;
      attachLocalTracks(pc, stream);
    } catch (err) {
      console.error("Error obteniendo media local:", err);
      // Podríamos rechazar la llamada aquí si falla
    }

    // crear answer y enviarla
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    sendSignal({
      type: "RTC_CALL_ANSWER",
      toUserId: fromUserId,
      sdp: answer,
    });

    setInCall(true);
    if (onCallStateChange) onCallStateChange({ inCall: true, role: "callee" });
  };

  // ---------------------------
  // Manejar answer (caller recibe answer)
  // ---------------------------
  const handleAnswer = async (data) => {
    const { sdp } = data;
    // Si ya existe la conexión (renegociación o respuesta inicial), usamos la existente
    // Si no, creamos una nueva (flujo inicial raro si no hay pcRef)
    const pc = pcRef.current || createPeerConnection();

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    // Procesar candidatos en cola
    await processIceQueue();
  };

  // ---------------------------
  // Manejar ICE candidate entrante
  // ---------------------------
  const handleIceCandidate = async (data) => {
    const { candidate } = data;
    const pc = pcRef.current || createPeerConnection();

    if (!pc.remoteDescription) {
      // Si no hay descripción remota, encolar
      console.log("Encolando ICE candidate (remoteDescription no lista)");
      iceCandidatesQueue.current.push(candidate);
    } else {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error("Error addIceCandidate:", e);
      }
    }
  };

  // ---------------------------
  // Exponer handler para mensajes WS
  // ---------------------------
  const handleWsMessage = useCallback(async (data) => {
    // data ya parseado por quien llama
    switch (data.type) {
      case "RTC_CALL_OFFER":
        // RENEGOCIACIÓN: Si ya estamos en llamada con este usuario, aceptamos directo
        // Usamos == para evitar problemas de tipos (string vs number)
        if (inCall && remoteUser && remoteUser.id == data.fromUserId) {
          console.log("Renegociación detectada (cambio de modo), aceptando automáticamente...");
          await acceptOffer(data);
          return;
        } else {
          console.log("Oferta recibida pero NO es renegociación automática:", {
            inCall,
            remoteUserId: remoteUser?.id,
            offerFromId: data.fromUserId
          });
        }

        // Guardar oferta y notificar UI para mostrar modal
        incomingOfferRef.current = data;
        if (onIncomingCall) {
          onIncomingCall({
            fromUserId: data.fromUserId,
            callMode: data.callMode,
            accept: () => acceptOffer(data),
            reject: () => {
              // enviar rechazo (fin de llamada)
              sendSignal({ type: "RTC_CALL_END", toUserId: data.fromUserId });
              incomingOfferRef.current = null;
            },
            raw: data,
          });
        } else {
          // Si no hay callback definido, aceptamos automáticamente (fallback)
          await acceptOffer(data);
        }
        break;

      case "RTC_CALL_ANSWER":
        await handleAnswer(data);
        break;

      case "RTC_ICE_CANDIDATE":
        await handleIceCandidate(data);
        break;

      case "RTC_CALL_END":
        // remoto colgó -> limpiar
        endCall();
        break;

      default:
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
