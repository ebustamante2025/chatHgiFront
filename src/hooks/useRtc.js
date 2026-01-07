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
  const receivedCandidatesCountRef = useRef(0); // Contador de candidatos recibidos
  const sentCandidatesCountRef = useRef(0); // Contador de candidatos enviados

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
      
      // Log detallado para candidatos ICE
      if (payload.type === "RTC_ICE_CANDIDATE") {
        const candidateStr = payload.candidate?.candidate || "";
        console.log("📤 Detalles del candidato a enviar:", {
          hasCandidate: !!payload.candidate,
          candidatePreview: candidateStr.substring(0, 80),
          toUserId: payload.toUserId,
          wsReadyState: wsRef.current?.readyState
        });
      }
      
      const messageStr = JSON.stringify(payload);
      console.log("📤 Mensaje WebSocket (tamaño):", messageStr.length, "bytes");
      wsRef.current.send(messageStr);
      console.log("✅ Mensaje enviado exitosamente por WebSocket");
    } catch (err) {
      logCriticalError(ErrorCodes.WEBSOCKET_SEND_FAILED, "Error enviando señal por WebSocket", {
        error: err.message,
        payloadType: payload?.type,
        toUserId: payload?.toUserId,
        wsReadyState: wsRef.current?.readyState,
        errorStack: err.stack
      });
    }
  };

  // Función para obtener información de red del usuario
  const getNetworkInfo = async (pc, role = "unknown") => {
    if (!pc) return null;
    
    try {
      const stats = await pc.getStats();
      const networkInfo = {
        role: role, // "caller" o "callee"
        localUser: localUser ? { id: localUser.id, username: localUser.username } : null,
        remoteUser: remoteUser ? { id: remoteUser.id } : null,
        localIPs: {
          private: [],
          public: [],
          turn: []
        },
        remoteIPs: {
          private: [],
          public: [],
          turn: []
        },
        connectionInfo: {
          signalingState: pc.signalingState,
          iceConnectionState: pc.iceConnectionState,
          connectionState: pc.connectionState,
          iceGatheringState: pc.iceGatheringState
        },
        candidates: {
          local: { host: 0, srflx: 0, relay: 0, total: 0 },
          remote: { host: 0, srflx: 0, relay: 0, total: 0 },
          pairs: 0,
          activePairs: 0
        }
      };
      
      stats.forEach(report => {
        // Candidatos locales
        if (report.type === "local-candidate") {
          networkInfo.candidates.local.total++;
          const ip = report.ip || report.address;
          if (report.candidateType === "host") {
            networkInfo.candidates.local.host++;
            if (ip && !networkInfo.localIPs.private.includes(ip)) {
              networkInfo.localIPs.private.push(ip);
            }
          } else if (report.candidateType === "srflx") {
            networkInfo.candidates.local.srflx++;
            if (ip && !networkInfo.localIPs.public.includes(ip)) {
              networkInfo.localIPs.public.push(ip);
            }
          } else if (report.candidateType === "relay") {
            networkInfo.candidates.local.relay++;
            if (ip && !networkInfo.localIPs.turn.includes(ip)) {
              networkInfo.localIPs.turn.push(ip);
            }
          }
        }
        
        // Candidatos remotos
        if (report.type === "remote-candidate") {
          networkInfo.candidates.remote.total++;
          const ip = report.ip || report.address;
          if (report.candidateType === "host") {
            networkInfo.candidates.remote.host++;
            if (ip && !networkInfo.remoteIPs.private.includes(ip)) {
              networkInfo.remoteIPs.private.push(ip);
            }
          } else if (report.candidateType === "srflx") {
            networkInfo.candidates.remote.srflx++;
            if (ip && !networkInfo.remoteIPs.public.includes(ip)) {
              networkInfo.remoteIPs.public.push(ip);
            }
          } else if (report.candidateType === "relay") {
            networkInfo.candidates.remote.relay++;
            if (ip && !networkInfo.remoteIPs.turn.includes(ip)) {
              networkInfo.remoteIPs.turn.push(ip);
            }
          }
        }
        
        // Pares de candidatos
        if (report.type === "candidate-pair") {
          networkInfo.candidates.pairs++;
          if (report.state === "succeeded" || report.state === "in-progress") {
            networkInfo.candidates.activePairs++;
          }
        }
      });
      
      return networkInfo;
    } catch (err) {
      console.warn("⚠️ Error obteniendo información de red:", err);
      return null;
    }
  };

  // Función para mostrar información completa de la llamada
  const logCallInfo = async (pc, role, mode, otherUser) => {
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`📞 ${role === "caller" ? "INICIANDO LLAMADA" : "RECIBIENDO LLAMADA"}`);
    console.log("═══════════════════════════════════════════════════════════");
    
    // Información de usuarios
    console.log("👤 USUARIO LOCAL (YO):");
    console.log("   - ID:", localUser?.id || "N/A");
    console.log("   - Usuario:", localUser?.username || "N/A");
    
    console.log("👤 USUARIO REMOTO:");
    console.log("   - ID:", otherUser?.id || remoteUser?.id || "N/A");
    console.log("   - Usuario:", otherUser?.username || "N/A");
    
    console.log("📞 MODO DE LLAMADA:", mode);
    console.log("   - Video:", mode === "video" ? "✅" : "❌");
    console.log("   - Audio:", "✅");
    console.log("   - Pantalla:", mode === "screen" ? "✅" : "❌");
    
    // Información de red
    const networkInfo = await getNetworkInfo(pc, role);
    if (networkInfo) {
      console.log("🌐 INFORMACIÓN DE RED LOCAL:");
      console.log("   - IPs Privadas:", networkInfo.localIPs.private.length > 0 ? networkInfo.localIPs.private.join(", ") : "N/A");
      console.log("   - IP Pública:", networkInfo.localIPs.public.length > 0 ? networkInfo.localIPs.public[0] : "N/A (aún no descubierta)");
      console.log("   - IP TURN:", networkInfo.localIPs.turn.length > 0 ? networkInfo.localIPs.turn[0] : "N/A (aún no generada)");
      
      console.log("🌐 INFORMACIÓN DE RED REMOTA:");
      console.log("   - IPs Privadas:", networkInfo.remoteIPs.private.length > 0 ? networkInfo.remoteIPs.private.join(", ") : "Aún no recibidas");
      console.log("   - IP Pública:", networkInfo.remoteIPs.public.length > 0 ? networkInfo.remoteIPs.public[0] : "Aún no recibida");
      console.log("   - IP TURN:", networkInfo.remoteIPs.turn.length > 0 ? networkInfo.remoteIPs.turn[0] : "Aún no recibida");
      
      console.log("📊 ESTADO DE CANDIDATOS ICE:");
      console.log("   - Candidatos Locales:", networkInfo.candidates.local.total, 
                  `(Host: ${networkInfo.candidates.local.host}, STUN: ${networkInfo.candidates.local.srflx}, TURN: ${networkInfo.candidates.local.relay})`);
      console.log("   - Candidatos Remotos:", networkInfo.candidates.remote.total,
                  `(Host: ${networkInfo.candidates.remote.host}, STUN: ${networkInfo.candidates.remote.srflx}, TURN: ${networkInfo.candidates.remote.relay})`);
      console.log("   - Pares de Candidatos:", networkInfo.candidates.pairs);
      console.log("   - Pares Activos:", networkInfo.candidates.activePairs);
      
      console.log("🔌 ESTADO DE CONEXIÓN:");
      console.log("   - Signaling State:", networkInfo.connectionInfo.signalingState);
      console.log("   - ICE Connection State:", networkInfo.connectionInfo.iceConnectionState);
      console.log("   - Connection State:", networkInfo.connectionInfo.connectionState);
      console.log("   - ICE Gathering State:", networkInfo.connectionInfo.iceGatheringState);
    }
    
    console.log("📋 DATOS NECESARIOS PARA LA LLAMADA:");
    console.log("   ✅ PeerConnection creado");
    console.log("   ✅ Servidores STUN/TURN configurados");
    console.log("   ✅ WebSocket conectado:", wsRef.current?.readyState === WebSocket.OPEN ? "Sí" : "No");
    console.log("   ✅ Permisos de media:", mode === "audio" ? "Micrófono" : mode === "screen" ? "Pantalla + Micrófono" : "Cámara + Micrófono");
    console.log("   ⏳ Esperando intercambio de candidatos ICE...");
    console.log("═══════════════════════════════════════════════════════════");
  };

  // crea (o retorna) RTCPeerConnection
  const createPeerConnection = () => {
    if (pcRef.current) {
      console.log("📞 PeerConnection ya existe, reutilizando");
      return pcRef.current;
    }

    console.log("📞 Creando nuevo RTCPeerConnection con ICE servers:", ICE_SERVERS);
    console.log("🌐 ========== CONFIGURACIÓN DE SERVIDORES ICE ==========");
    ICE_SERVERS.forEach((server, index) => {
      if (Array.isArray(server.urls)) {
        console.log(`   ${index + 1}. TURN Server (Relay):`);
        server.urls.forEach(url => {
          console.log(`      - ${url}`);
        });
        console.log(`      - Username: ${server.username || "N/A"}`);
        console.log(`      - Credential: ${server.credential ? "***" : "N/A"}`);
      } else {
        console.log(`   ${index + 1}. STUN Server (Descubrimiento):`);
        console.log(`      - ${server.urls}`);
      }
    });
    console.log("================================================");
    
    // Configuración de PeerConnection con timeout más largo para ICE
    const pc = new RTCPeerConnection({ 
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 10, // Pre-generar más candidatos
      bundlePolicy: "max-bundle", // Optimizar para mejor rendimiento
      rtcpMuxPolicy: "require" // Requerir RTCP muxing
    });
    
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
        const candidate = ev.candidate;
        const candidateString = candidate.candidate || "";
        
        // Analizar tipo de candidato ICE
        let candidateType = "unknown";
        let ip = "N/A";
        let port = "N/A";
        let isTurn = false;
        
        // Extraer información del candidato
        if (candidateString.includes("typ host")) {
          candidateType = "host"; // IP local
        } else if (candidateString.includes("typ srflx")) {
          candidateType = "srflx"; // STUN (IP pública descubierta)
        } else if (candidateString.includes("typ relay")) {
          candidateType = "relay"; // TURN (relay)
          isTurn = true;
        } else if (candidateString.includes("typ prflx")) {
          candidateType = "prflx"; // Peer reflexive
        }
        
        // Extraer IP y puerto del candidato
        const ipMatch = candidateString.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (ipMatch) {
          ip = ipMatch[1];
        }
        const portMatch = candidateString.match(/port (\d+)/);
        if (portMatch) {
          port = portMatch[1];
        }
        
        // Log detallado del candidato
        console.log("🌐 ========== ICE CANDIDATO GENERADO ==========");
        console.log("📡 Tipo:", candidateType.toUpperCase(), isTurn ? "🔀 (TURN RELAY)" : "");
        console.log("📍 IP:", ip);
        console.log("🔌 Puerto:", port);
        console.log("📋 Candidato completo:", candidateString.substring(0, 150) + "...");
        console.log("📊 Protocolo:", candidate.protocol || "N/A");
        console.log("🔢 Priority:", candidate.priority || "N/A");
        
        if (isTurn) {
          console.log("✅✅✅ USANDO TURN SERVER - Conexión por relay");
        } else if (candidateType === "srflx") {
          console.log("🔍 Usando STUN - IP pública descubierta (intentando P2P directo)");
        } else if (candidateType === "host") {
          console.log("🏠 Candidato local (host) - IP privada");
        }
        
        const targetUserId = remoteUserIdRef.current;
        if (targetUserId) {
          sentCandidatesCountRef.current++;
          console.log(`📤 Enviando candidato #${sentCandidatesCountRef.current} a usuario:`, targetUserId);
          
          // Validar candidato antes de enviar
          if (!candidate || !candidate.candidate) {
            logWarning(ErrorCodes.ICE_CANDIDATE_ERROR, "Candidato inválido generado, no se enviará", {
              candidateType: candidateType,
              ip: ip,
              port: port
            });
            return;
          }
          
          // Asegurar que todos los campos necesarios estén presentes
          const candidateToSend = {
            candidate: candidate.candidate,
            sdpMLineIndex: candidate.sdpMLineIndex !== null && candidate.sdpMLineIndex !== undefined 
              ? candidate.sdpMLineIndex 
              : null,
            sdpMid: candidate.sdpMid || null,
          };
          
          // Log de validación antes de enviar
          console.log("📋 Validación del candidato a enviar:", {
            hasCandidate: !!candidateToSend.candidate,
            hasSdpMLineIndex: candidateToSend.sdpMLineIndex !== null,
            hasSdpMid: !!candidateToSend.sdpMid,
            sdpMLineIndex: candidateToSend.sdpMLineIndex,
            sdpMid: candidateToSend.sdpMid,
            candidatePreview: candidateToSend.candidate.substring(0, 80)
          });
          
          sendSignal({
            type: "RTC_ICE_CANDIDATE",
            toUserId: targetUserId,
            candidate: candidateToSend,
          });
          console.log(`✅ Candidato #${sentCandidatesCountRef.current} enviado exitosamente`);
        } else {
          logWarning(ErrorCodes.ICE_CANDIDATE_ERROR, "ICE candidate generado pero no hay remoteUserId aún", {
            candidateType: candidateType,
            ip: ip,
            port: port,
            isTurn: isTurn,
            note: "Se perderá este candidato, pero los siguientes se enviarán correctamente"
          });
        }
      } else if (ev.candidate === null) {
        console.log("✅ ICE gathering completado - Todos los candidatos generados");
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
        
        // Mostrar información completa de la conexión establecida
        setTimeout(async () => {
          // Determinar el rol basado en si tenemos remoteUser establecido desde startCall
          const role = remoteUserIdRef.current && remoteUser ? "caller" : "callee";
          const networkInfo = await getNetworkInfo(pcRef.current, role);
          if (networkInfo) {
            console.log("═══════════════════════════════════════════════════════════");
            console.log("✅✅✅ CONEXIÓN ESTABLECIDA - INFORMACIÓN COMPLETA");
            console.log("═══════════════════════════════════════════════════════════");
            console.log("👤 USUARIO LOCAL:");
            console.log("   - ID:", networkInfo.localUser?.id || "N/A");
            console.log("   - Usuario:", networkInfo.localUser?.username || "N/A");
            console.log("   - IP Privada:", networkInfo.localIPs.private.length > 0 ? networkInfo.localIPs.private.join(", ") : "N/A");
            console.log("   - IP Pública:", networkInfo.localIPs.public.length > 0 ? networkInfo.localIPs.public[0] : "N/A");
            console.log("   - IP TURN:", networkInfo.localIPs.turn.length > 0 ? networkInfo.localIPs.turn[0] : "N/A");
            
            console.log("👤 USUARIO REMOTO:");
            console.log("   - ID:", networkInfo.remoteUser?.id || "N/A");
            console.log("   - IP Privada:", networkInfo.remoteIPs.private.length > 0 ? networkInfo.remoteIPs.private.join(", ") : "N/A");
            console.log("   - IP Pública:", networkInfo.remoteIPs.public.length > 0 ? networkInfo.remoteIPs.public[0] : "N/A");
            console.log("   - IP TURN:", networkInfo.remoteIPs.turn.length > 0 ? networkInfo.remoteIPs.turn[0] : "N/A");
            
            console.log("📊 ESTADO FINAL:");
            console.log("   - Pares de Candidatos:", networkInfo.candidates.pairs);
            console.log("   - Pares Activos:", networkInfo.candidates.activePairs);
            console.log("   - Connection State:", networkInfo.connectionInfo.connectionState);
            console.log("   - ICE Connection State:", networkInfo.connectionInfo.iceConnectionState);
            console.log("═══════════════════════════════════════════════════════════");
          }
        }, 1000);
      } else if (state === "disconnected") {
        console.warn("⚠️ Conexión WebRTC desconectada");
      } else if (state === "failed") {
        // Obtener información detallada del fallo
        const pc = pcRef.current;
        let diagnosticInfo = {
          connectionState: state,
          iceConnectionState: iceState,
          iceGatheringState: iceGatheringState,
          signalingState: pc?.signalingState,
          localDescription: pc?.localDescription ? "OK" : "NO",
          remoteDescription: pc?.remoteDescription ? "OK" : "NO"
        };
        
        // Intentar obtener estadísticas para diagnóstico
        if (pc) {
          pc.getStats().then(stats => {
            let candidateInfo = {
              localCandidates: 0,
              remoteCandidates: 0,
              relayCandidates: 0,
              hostCandidates: 0,
              srflxCandidates: 0
            };
            
            stats.forEach(report => {
              if (report.type === "local-candidate") {
                candidateInfo.localCandidates++;
                if (report.candidateType === "relay") candidateInfo.relayCandidates++;
                if (report.candidateType === "host") candidateInfo.hostCandidates++;
                if (report.candidateType === "srflx") candidateInfo.srflxCandidates++;
              }
              if (report.type === "remote-candidate") {
                candidateInfo.remoteCandidates++;
              }
            });
            
            console.error("🔍 DIAGNÓSTICO DE FALLO:", {
              ...diagnosticInfo,
              candidatos: candidateInfo,
              estadisticas: {
                candidatosEnviados: sentCandidatesCountRef.current,
                candidatosRecibidos: receivedCandidatesCountRef.current,
                candidatosEnCola: iceCandidatesQueue.current.length,
                candidatosRemotosEnPC: candidateInfo.remoteCandidates,
                nota: "getStats() puede no reflejar candidatos añadidos recientemente. Verificar logs de signaling para confirmar recepción."
              },
              problema: candidateInfo.relayCandidates === 0 
                ? "No se generaron candidatos TURN - Servidor TURN no accesible"
                : candidateInfo.remoteCandidates === 0 && receivedCandidatesCountRef.current === 0
                ? `❌ CRÍTICO: No se recibieron candidatos del remoto por signaling - Verificar WebSocket y que el remoto esté enviando candidatos`
                : candidateInfo.remoteCandidates === 0 && receivedCandidatesCountRef.current > 0
                ? `⚠️ Candidatos recibidos por signaling (${receivedCandidatesCountRef.current}) pero no añadidos al PC - Verificar formato de candidatos o timing`
                : "Candidatos generados pero conexión falló - Problema de firewall/NAT o servidor TURN no puede hacer relay"
            });
          }).catch(err => {
            console.warn("⚠️ No se pudieron obtener estadísticas para diagnóstico:", err);
          });
        }
        
        logCriticalError(ErrorCodes.CONNECTION_FAILED, "Conexión WebRTC falló", diagnosticInfo);
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
        console.log("✅✅✅ ICE conectado exitosamente");
        
        // Obtener información de la conexión establecida
        pc.getStats().then(stats => {
          stats.forEach(report => {
            if (report.type === "candidate-pair" && report.state === "succeeded") {
              const localCandidateId = report.localCandidateId;
              const remoteCandidateId = report.remoteCandidateId;
              
              // Buscar información de los candidatos locales y remotos
              stats.forEach(candidateReport => {
                if (candidateReport.type === "local-candidate" && candidateReport.id === localCandidateId) {
                  console.log("🌐 ========== CONEXIÓN ESTABLECIDA ==========");
                  console.log("📍 Candidato Local:");
                  console.log("   - Tipo:", candidateReport.candidateType || "N/A");
                  console.log("   - IP:", candidateReport.ip || candidateReport.address || "N/A");
                  console.log("   - Puerto:", candidateReport.port || "N/A");
                  console.log("   - Protocolo:", candidateReport.protocol || "N/A");
                  
                  if (candidateReport.candidateType === "relay") {
                    console.log("   ✅✅✅ USANDO TURN RELAY - Conexión por servidor TURN");
                    console.log("   🔀 IP del TURN:", candidateReport.ip || candidateReport.address);
                  } else if (candidateReport.candidateType === "srflx") {
                    console.log("   🔍 Usando STUN - Conexión P2P directa con IP pública");
                  } else if (candidateReport.candidateType === "host") {
                    console.log("   🏠 Conexión local (misma red)");
                  }
                }
                
                if (candidateReport.type === "remote-candidate" && candidateReport.id === remoteCandidateId) {
                  console.log("📍 Candidato Remoto:");
                  console.log("   - Tipo:", candidateReport.candidateType || "N/A");
                  console.log("   - IP:", candidateReport.ip || candidateReport.address || "N/A");
                  console.log("   - Puerto:", candidateReport.port || "N/A");
                  console.log("   - Protocolo:", candidateReport.protocol || "N/A");
                }
              });
              
              // Información del par de candidatos
              console.log("📊 Estadísticas de conexión:");
              console.log("   - Bytes enviados:", report.bytesSent || 0);
              console.log("   - Bytes recibidos:", report.bytesReceived || 0);
              console.log("   - Packets enviados:", report.packetsSent || 0);
              console.log("   - Packets recibidos:", report.packetsReceived || 0);
            }
          });
        }).catch(err => {
          console.warn("⚠️ No se pudieron obtener estadísticas de conexión:", err);
        });
      } else if (iceState === "failed") {
        logCriticalError(ErrorCodes.ICE_CONNECTION_FAILED, "ICE falló - Revisar STUN/TURN servers", {
          iceConnectionState: iceState,
          connectionState: pcRef.current?.connectionState,
          signalingState: pcRef.current?.signalingState,
          suggestion: "Verificar configuración de STUN/TURN servers y firewall"
        });
      } else if (iceState === "disconnected") {
        console.warn("⚠️ ICE desconectado - Intentando diagnóstico...");
        
        // Diagnóstico cuando ICE se desconecta
        if (pcRef.current) {
          pcRef.current.getStats().then(stats => {
            let diagnostic = {
              candidatePairs: [],
              localCandidates: [],
              remoteCandidates: [],
              failedPairs: []
            };
            
            stats.forEach(report => {
              if (report.type === "candidate-pair") {
                diagnostic.candidatePairs.push({
                  state: report.state,
                  priority: report.priority,
                  nominated: report.nominated,
                  bytesSent: report.bytesSent || 0,
                  bytesReceived: report.bytesReceived || 0
                });
                
                if (report.state === "failed") {
                  diagnostic.failedPairs.push({
                    localCandidateId: report.localCandidateId,
                    remoteCandidateId: report.remoteCandidateId,
                    priority: report.priority
                  });
                }
              }
              
              if (report.type === "local-candidate") {
                diagnostic.localCandidates.push({
                  type: report.candidateType,
                  ip: report.ip || report.address,
                  port: report.port,
                  protocol: report.protocol
                });
              }
              
              if (report.type === "remote-candidate") {
                diagnostic.remoteCandidates.push({
                  type: report.candidateType,
                  ip: report.ip || report.address,
                  port: report.port,
                  protocol: report.protocol
                });
              }
            });
            
            console.error("🔍 DIAGNÓSTICO ICE DESCONECTADO:", {
              totalCandidatePairs: diagnostic.candidatePairs.length,
              failedPairs: diagnostic.failedPairs.length,
              localCandidates: diagnostic.localCandidates.length,
              remoteCandidates: diagnostic.remoteCandidates.length,
              localRelayCandidates: diagnostic.localCandidates.filter(c => c.type === "relay").length,
              remoteRelayCandidates: diagnostic.remoteCandidates.filter(c => c.type === "relay").length,
              candidatePairs: diagnostic.candidatePairs,
              failedPairs: diagnostic.failedPairs,
              localCandidates: diagnostic.localCandidates,
              remoteCandidates: diagnostic.remoteCandidates,
              problema: diagnostic.failedPairs.length > 0
                ? "Pares de candidatos fallaron - Posible problema de conectividad con TURN"
                : diagnostic.localCandidates.filter(c => c.type === "relay").length === 0
                ? "No se generaron candidatos TURN locales"
                : diagnostic.remoteCandidates.filter(c => c.type === "relay").length === 0
                ? "No se recibieron candidatos TURN remotos"
                : "Candidatos TURN presentes pero conexión falló - Verificar servidor TURN"
            });
          }).catch(err => {
            console.warn("⚠️ Error obteniendo estadísticas:", err);
          });
        }
      } else if (iceState === "checking") {
        console.log("🔍 ICE verificando conexión...");
      } else if (iceState === "completed") {
        console.log("✅ ICE completado - Negociación finalizada");
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
    if (!pcRef.current) {
      console.warn("⚠️ No hay PeerConnection para procesar cola de candidatos");
      return;
    }
    
    if (!pcRef.current.remoteDescription) {
      console.warn("⚠️ No hay remoteDescription, no se pueden procesar candidatos aún");
      return;
    }
    
    const queueLength = iceCandidatesQueue.current.length;
    console.log("📞 Procesando cola de ICE candidates, cantidad:", queueLength);
    
    if (queueLength === 0) {
      console.log("📞 Cola vacía, no hay candidatos para procesar");
      return;
    }
    
    let processed = 0;
    let failed = 0;
    
    while (iceCandidatesQueue.current.length > 0) {
      const candidate = iceCandidatesQueue.current.shift();
      try {
        // Validar y normalizar el candidato antes de añadirlo
        const normalizedCandidate = {
          candidate: candidate.candidate,
          sdpMLineIndex: candidate.sdpMLineIndex !== null && candidate.sdpMLineIndex !== undefined 
            ? candidate.sdpMLineIndex 
            : null,
          sdpMid: candidate.sdpMid || null,
        };
        
        // Log de validación
        if (processed === 0) { // Solo loggear el primero para no saturar
          console.log("📋 Validando candidato de la cola:", {
            hasCandidate: !!normalizedCandidate.candidate,
            hasSdpMLineIndex: normalizedCandidate.sdpMLineIndex !== null,
            hasSdpMid: !!normalizedCandidate.sdpMid,
            sdpMLineIndex: normalizedCandidate.sdpMLineIndex,
            sdpMid: normalizedCandidate.sdpMid
          });
        }
        
        await pcRef.current.addIceCandidate(new RTCIceCandidate(normalizedCandidate));
        processed++;
        console.log(`✅ ICE candidate ${processed}/${queueLength} añadido de la cola`);
      } catch (e) {
        failed++;
        logCriticalError(ErrorCodes.ICE_CANDIDATE_ERROR, "Error añadiendo ICE candidate de la cola", {
          error: e.message,
          errorName: e.name,
          candidate: candidate?.candidate?.substring(0, 50) + "...",
          hasSdpMLineIndex: candidate?.sdpMLineIndex !== undefined,
          hasSdpMid: !!candidate?.sdpMid,
          processed: processed,
          failed: failed,
          remaining: iceCandidatesQueue.current.length
        });
      }
    }
    
    console.log(`📞 Cola procesada: ${processed} exitosos, ${failed} fallidos, ${iceCandidatesQueue.current.length} restantes`);
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
    
    // Mostrar información de la llamada
    setTimeout(async () => {
      await logCallInfo(pc, "caller", mode, toUser);
    }, 500); // Esperar un poco para que se generen algunos candidatos
    
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
    let offer;
    try {
      offer = await pc.createOffer();
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

    // Verificar que offer se creó correctamente antes de enviarlo
    if (!offer) {
      logCriticalError(ErrorCodes.OFFER_CREATION_FAILED, "Offer no se creó correctamente", {
        signalingState: pc.signalingState
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
    // Validar que notifyRemote sea un booleano (evitar que se pase un evento de React)
    // Si se pasa un evento (objeto con propiedades como _reactName, type: 'click', etc.), lo convertimos a true
    if (typeof notifyRemote !== "boolean") {
      const isReactEvent = notifyRemote && 
        (notifyRemote._reactName || notifyRemote.type === 'click' || notifyRemote.nativeEvent);
      
      if (isReactEvent) {
        logWarning(ErrorCodes.NO_PEER_CONNECTION, "endCall recibió evento de React en lugar de booleano, corrigiendo a true", {
          receivedType: typeof notifyRemote,
          isReactEvent: true,
          fixingTo: true,
          note: "Esto ocurre cuando onClick pasa directamente la función sin envolver en arrow function"
        });
        notifyRemote = true;
      } else {
        logWarning(ErrorCodes.NO_PEER_CONNECTION, "endCall recibió argumento inválido, usando valor por defecto", {
          receivedType: typeof notifyRemote,
          receivedValue: notifyRemote,
          fixingTo: true
        });
        notifyRemote = true;
      }
    }
    
    // Protección contra llamadas duplicadas cuando no hay llamada activa
    if (!inCall && !pcRef.current) {
      console.log("📞 endCall llamado pero no hay llamada activa, ignorando");
      return;
    }
    
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
    receivedCandidatesCountRef.current = 0; // Resetear contador
    sentCandidatesCountRef.current = 0; // Resetear contador
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
  const acceptOffer = useCallback(async (offerData) => {
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
    
    // IMPORTANTE: Preservar la cola de candidatos ICE recibidos antes de aceptar
    // NO limpiar aquí - los candidatos que llegaron antes de aceptar deben procesarse
    const candidatosEnColaAntes = iceCandidatesQueue.current.length;
    console.log("📞 Estados inicializados, remoteUserId:", fromUserId);
    console.log("📞 Candidatos ICE en cola antes de aceptar:", candidatosEnColaAntes);
    
    // Hacer una copia de la cola ANTES de cualquier operación que pueda afectarla
    const colaPreservada = [...iceCandidatesQueue.current];
    console.log("📞 Cola preservada (copia):", colaPreservada.length, "candidatos");

    // crear o recrear pc
    if (pcRef.current) {
      console.log("📞 Cerrando PeerConnection anterior...");
      pcRef.current.close();
      pcRef.current = null;
      dataChannelRef.current = null;
    }
    
    // Verificar que la cola no se haya perdido después de cerrar PC anterior
    console.log("📞 Cola después de cerrar PC anterior:", iceCandidatesQueue.current.length);
    if (candidatosEnColaAntes > 0 && iceCandidatesQueue.current.length === 0) {
      console.error("❌ ERROR: Cola se perdió después de cerrar PC anterior! Restaurando...");
      iceCandidatesQueue.current = [...colaPreservada];
      console.log("✅ Cola restaurada:", iceCandidatesQueue.current.length, "candidatos");
    }
    
    const pc = createPeerConnection();
    console.log("📞 PeerConnection creado");
    console.log("📞 Cola después de crear PC:", iceCandidatesQueue.current.length);
    
    // Mostrar información de la llamada entrante
    setTimeout(async () => {
      await logCallInfo(pc, "callee", mode, { id: fromUserId });
    }, 500); // Esperar un poco para que se procesen algunos candidatos

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
    // IMPORTANTE: Los candidatos que llegaron ANTES de crear el PeerConnection
    // ya están en la cola y se procesarán aquí
    console.log("📞 Procesando candidatos ICE en cola (pueden incluir candidatos recibidos antes de crear PC)...");
    console.log("📞 Candidatos en cola antes de procesar:", iceCandidatesQueue.current.length);
    
    // Si la cola se perdió pero tenemos una copia preservada, restaurarla
    if (candidatosEnColaAntes > 0 && iceCandidatesQueue.current.length === 0) {
      console.error("❌ ERROR CRÍTICO: Se perdieron candidatos ICE de la cola! Había", candidatosEnColaAntes, "y ahora hay 0");
      if (colaPreservada.length > 0) {
        console.log("🔄 Restaurando cola desde copia preservada...");
        iceCandidatesQueue.current = [...colaPreservada];
        console.log("✅ Cola restaurada:", iceCandidatesQueue.current.length, "candidatos");
      }
    }
    
    await processIceQueue();
    console.log("📞 Candidatos procesados, cola restante:", iceCandidatesQueue.current.length);

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
  }, [onCallStateChange, sendSignal]);

  // ---------------------------
  // Manejar answer (caller recibe answer)
  // ---------------------------
  const handleAnswer = useCallback(async (data) => {
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
      
      // Procesar candidatos en cola ahora que tenemos remoteDescription
      // IMPORTANTE: Los candidatos que llegaron ANTES de recibir el answer
      // ya están en la cola y se procesarán aquí
      console.log("📞 Procesando candidatos ICE en cola (pueden incluir candidatos recibidos antes del answer)...");
      console.log("📞 Candidatos en cola antes de procesar:", iceCandidatesQueue.current.length);
      await processIceQueue();
      console.log("✅ ICE candidates procesados, cola restante:", iceCandidatesQueue.current.length);
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
  }, []);

  // ---------------------------
  // Manejar ICE candidate entrante
  // ---------------------------
  const handleIceCandidate = useCallback(async (data) => {
    const { candidate, fromUserId } = data;
    const candidateString = candidate.candidate || "";
    
    // Analizar tipo de candidato recibido
    let candidateType = "unknown";
    let ip = "N/A";
    let port = "N/A";
    let isTurn = false;
    
    if (candidateString.includes("typ host")) {
      candidateType = "host";
    } else if (candidateString.includes("typ srflx")) {
      candidateType = "srflx";
    } else if (candidateString.includes("typ relay")) {
      candidateType = "relay";
      isTurn = true;
    } else if (candidateString.includes("typ prflx")) {
      candidateType = "prflx";
    }
    
    // Extraer IP y puerto
    const ipMatch = candidateString.match(/(\d+\.\d+\.\d+\.\d+)/);
    if (ipMatch) {
      ip = ipMatch[1];
    }
    const portMatch = candidateString.match(/port (\d+)/);
    if (portMatch) {
      port = portMatch[1];
    }
    
    receivedCandidatesCountRef.current++;
    console.log("🌐 ========== ICE CANDIDATO RECIBIDO ==========");
    console.log(`📥 Candidato remoto #${receivedCandidatesCountRef.current} recibido`);
    console.log("👤 De usuario:", fromUserId);
    console.log("📡 Tipo:", candidateType.toUpperCase(), isTurn ? "🔀 (TURN RELAY)" : "");
    console.log("📍 IP remota:", ip);
    console.log("🔌 Puerto remoto:", port);
    console.log("📋 Candidato:", candidateString.substring(0, 150) + "...");
    console.log("📊 Estadísticas - Enviados:", sentCandidatesCountRef.current, "Recibidos:", receivedCandidatesCountRef.current);
    
    if (isTurn) {
      console.log("✅ El remoto está usando TURN SERVER");
    }
    
    const pc = pcRef.current;
    if (!pc) {
      // Si no hay PeerConnection, puede ser porque:
      // 1. La llamada ya terminó (normal - candidatos tardíos)
      // 2. Aún no se ha creado el PeerConnection (en acceptOffer) - ENCOLAR
      // 3. Hay una oferta entrante pendiente - ENCOLAR
      // 4. Error - debería haber PeerConnection pero no existe
      
      if (!inCall && !incomingOfferRef.current) {
        // Llamada ya terminó y no hay oferta pendiente - candidatos tardíos, ignorar silenciosamente
        console.log("📞 Candidato ICE recibido después de que la llamada terminó, ignorando (normal)");
        return;
      } else {
        // Estamos esperando crear PeerConnection (acceptOffer) o hay oferta pendiente
        // ENCOLAR el candidato para procesarlo después
        console.log("📞 PeerConnection aún no creado, encolando candidato ICE para procesar después");
        console.log("📞 Candidato será procesado cuando se cree PeerConnection y se establezca remoteDescription");
        
        // Normalizar el candidato antes de encolarlo para asegurar que tenga todos los campos
        const normalizedCandidate = {
          candidate: candidate.candidate,
          sdpMLineIndex: candidate.sdpMLineIndex !== null && candidate.sdpMLineIndex !== undefined 
            ? candidate.sdpMLineIndex 
            : null,
          sdpMid: candidate.sdpMid || null,
        };
        
        iceCandidatesQueue.current.push(normalizedCandidate);
        console.log("📞 Candidatos en cola:", iceCandidatesQueue.current.length);
        return;
      }
    }
    
    // Verificar que el PeerConnection no esté cerrado
    if (pc.connectionState === "closed") {
      console.log("📞 Candidato ICE recibido pero PeerConnection está cerrado, ignorando");
      return;
    }

    console.log("📞 Estado actual PC - remoteDescription:", pc.remoteDescription ? "OK" : "NO", 
                "signalingState:", pc.signalingState);

    if (!pc.remoteDescription) {
      // Si no hay descripción remota, encolar
      console.log("📞 Encolando ICE candidate (remoteDescription no lista)");
      
      // Normalizar el candidato antes de encolarlo
      const normalizedCandidate = {
        candidate: candidate.candidate,
        sdpMLineIndex: candidate.sdpMLineIndex !== null && candidate.sdpMLineIndex !== undefined 
          ? candidate.sdpMLineIndex 
          : null,
        sdpMid: candidate.sdpMid || null,
      };
      
      iceCandidatesQueue.current.push(normalizedCandidate);
      console.log("📞 Candidatos en cola:", iceCandidatesQueue.current.length);
    } else {
      try {
        // Validar candidato antes de añadirlo
        if (!candidate || !candidate.candidate) {
          logWarning(ErrorCodes.ICE_CANDIDATE_ERROR, "Candidato inválido recibido, ignorando", {
            fromUserId: fromUserId,
            candidateType: candidateType,
            receivedCount: receivedCandidatesCountRef.current
          });
          return;
        }
        
        // Validar y normalizar el candidato antes de añadirlo
        // Asegurar que todos los campos estén presentes (pueden ser null pero deben estar definidos)
        const normalizedCandidate = {
          candidate: candidate.candidate,
          sdpMLineIndex: candidate.sdpMLineIndex !== null && candidate.sdpMLineIndex !== undefined 
            ? candidate.sdpMLineIndex 
            : null,
          sdpMid: candidate.sdpMid || null,
        };
        
        // Log detallado del candidato antes de añadirlo
        console.log("📋 Detalles del candidato a añadir:", {
          candidate: normalizedCandidate.candidate?.substring(0, 100) || "N/A",
          sdpMLineIndex: normalizedCandidate.sdpMLineIndex,
          sdpMid: normalizedCandidate.sdpMid,
          hasSdpMLineIndex: normalizedCandidate.sdpMLineIndex !== null,
          hasSdpMid: !!normalizedCandidate.sdpMid,
          originalSdpMLineIndex: candidate.sdpMLineIndex,
          originalSdpMid: candidate.sdpMid,
          signalingState: pc.signalingState,
          iceConnectionState: pc.iceConnectionState,
          hasLocalDescription: !!pc.localDescription,
          hasRemoteDescription: !!pc.remoteDescription
        });
        
        // Validar que el candidato tenga al menos el campo candidate
        if (!normalizedCandidate.candidate) {
          logWarning(ErrorCodes.ICE_CANDIDATE_ERROR, "Candidato sin campo 'candidate', ignorando", {
            fromUserId: fromUserId,
            receivedCount: receivedCandidatesCountRef.current
          });
          return;
        }
        
        const iceCandidate = new RTCIceCandidate(normalizedCandidate);
        await pc.addIceCandidate(iceCandidate);
        console.log(`✅ ICE candidate #${receivedCandidatesCountRef.current} añadido correctamente al PeerConnection`);
        console.log("📞 ICE Connection State después de añadir:", pc.iceConnectionState);
        
        // Verificar cuántos candidatos remotos tenemos ahora y pares de candidatos
        if (pc.getStats) {
          pc.getStats().then(stats => {
            let remoteCount = 0;
            let candidatePairs = 0;
            let activePairs = 0;
            
            stats.forEach(report => {
              if (report.type === "remote-candidate") {
                remoteCount++;
              }
              if (report.type === "candidate-pair") {
                candidatePairs++;
                if (report.state === "succeeded" || report.state === "in-progress") {
                  activePairs++;
                }
              }
            });
            
            console.log(`📊 Estadísticas ICE:`, {
              candidatosRemotos: remoteCount,
              candidatosRecibidosPorSignaling: receivedCandidatesCountRef.current,
              paresDeCandidatos: candidatePairs,
              paresActivos: activePairs,
              iceConnectionState: pc.iceConnectionState,
              connectionState: pc.connectionState
            });
            
            if (remoteCount === 0 && receivedCandidatesCountRef.current > 0) {
              console.warn("⚠️ Candidatos recibidos pero no se añadieron al PeerConnection - Verificar formato de candidatos");
            }
            
            if (candidatePairs === 0 && remoteCount > 0) {
              console.error("❌ CRÍTICO: Hay candidatos remotos pero no se formaron pares de candidatos - Posible problema de ufrag/pwd o timing");
            }
            
            // Mostrar información del usuario remoto cuando recibimos suficientes candidatos
            if (receivedCandidatesCountRef.current >= 3 && remoteCount > 0) {
              console.log("═══════════════════════════════════════════════════════════");
              console.log("📥 INFORMACIÓN DEL USUARIO REMOTO (RECIBIENDO LLAMADA)");
              console.log("═══════════════════════════════════════════════════════════");
              console.log("👤 Usuario Remoto:");
              console.log("   - ID:", fromUserId);
              console.log("   - Candidatos Recibidos:", receivedCandidatesCountRef.current);
              console.log("   - Candidatos en PeerConnection:", remoteCount);
              console.log("   - IP Privada:", ip && candidateType === "host" ? ip : "Aún no detectada");
              console.log("   - IP Pública:", ip && candidateType === "srflx" ? ip : "Aún no detectada");
              console.log("   - Usando TURN:", isTurn ? "✅ Sí" : "❌ No (intentando P2P)");
              console.log("═══════════════════════════════════════════════════════════");
            }
          }).catch((err) => {
            console.warn("⚠️ Error obteniendo estadísticas:", err);
          });
        }
      } catch (e) {
        logCriticalError(ErrorCodes.ICE_CANDIDATE_ERROR, "Error añadiendo ICE candidate", {
          errorName: e.name,
          errorMessage: e.message,
          fromUserId: fromUserId,
          candidateType: candidateType,
          ip: ip,
          isTurn: isTurn,
          sdpMLineIndex: candidate?.sdpMLineIndex,
          sdpMid: candidate?.sdpMid,
          signalingState: pc.signalingState,
          remoteDescription: pc.remoteDescription ? "OK" : "NO"
        });
      }
    }
  }, [inCall]);

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
        console.log("📥 Mensaje completo recibido:", {
          type: data.type,
          fromUserId: data.fromUserId,
          toUserId: data.toUserId,
          hasCandidate: !!data.candidate,
          candidateKeys: data.candidate ? Object.keys(data.candidate) : [],
          candidatePreview: data.candidate?.candidate?.substring(0, 100) || "N/A",
          inCall: inCall,
          hasPeerConnection: !!pcRef.current,
          remoteUserId: remoteUser?.id,
          wsReadyState: wsRef?.current?.readyState
        });
        
        if (!data.candidate) {
          logWarning(ErrorCodes.ICE_CANDIDATE_ERROR, "RTC_ICE_CANDIDATE recibido sin candidato", {
            fromUserId: data.fromUserId,
            dataKeys: Object.keys(data || {}),
            fullData: JSON.stringify(data).substring(0, 200)
          });
          break;
        }
        
        if (!data.candidate.candidate) {
          logWarning(ErrorCodes.ICE_CANDIDATE_ERROR, "RTC_ICE_CANDIDATE recibido con candidato inválido (sin campo candidate)", {
            fromUserId: data.fromUserId,
            candidateKeys: Object.keys(data.candidate || {})
          });
          break;
        }
        
        try {
          console.log("📥 Llamando a handleIceCandidate...");
          await handleIceCandidate(data);
          console.log("✅ RTC_ICE_CANDIDATE procesado exitosamente");
        } catch (err) {
          logCriticalError(ErrorCodes.ICE_CANDIDATE_ERROR, "Error procesando RTC_ICE_CANDIDATE", {
            errorName: err.name,
            errorMessage: err.message,
            errorStack: err.stack,
            fromUserId: data.fromUserId,
            candidate: data.candidate?.candidate?.substring(0, 100) || "N/A"
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
  }, [onIncomingCall, endCall, inCall, remoteUser, acceptOffer, handleAnswer, handleIceCandidate, sendSignal]); // Funciones usadas dentro del callback

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
