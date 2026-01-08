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
  const pcIdRef = useRef(0); // Contador de PeerConnection ID para diagnóstico

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

  // Función para extraer ufrag del SDP
  const extractUfragFromSdp = (sdp) => {
    if (!sdp || typeof sdp !== 'string') return null;
    const match = sdp.match(/a=ice-ufrag:(\S+)/);
    return match ? match[1] : null;
  };

  // Función para verificar si un candidato coincide con el ufrag del SDP
  const validateCandidateUfrag = (candidate, sdpUfrag) => {
    if (!candidate || !candidate.candidate) return false;
    const candidateStr = candidate.candidate;
    const match = candidateStr.match(/ufrag\s+(\S+)/);
    const candidateUfrag = match ? match[1] : null;
    
    if (!candidateUfrag) {
      console.warn("⚠️ No se pudo extraer ufrag del candidato");
      return true; // Si no se puede extraer, asumimos que es válido
    }
    
    if (sdpUfrag && candidateUfrag !== sdpUfrag) {
      console.error(`❌ ERROR: ufrag no coincide! SDP: ${sdpUfrag}, Candidato: ${candidateUfrag}`);
      return false;
    }
    
    return true;
  };

  // Función de diagnóstico completo del SDP
  const diagnoseSdp = (sdp, label = "SDP") => {
    if (!sdp) {
      console.error(`❌ ${label}: No hay SDP disponible`);
      return null;
    }

    const sdpStr = typeof sdp === 'string' ? sdp : (sdp.sdp || '');
    if (!sdpStr) {
      console.error(`❌ ${label}: SDP está vacío`);
      return null;
    }

    console.log(`═══════════════════════════════════════════════════════════`);
    console.log(`🔍 DIAGNÓSTICO COMPLETO DEL ${label.toUpperCase()}`);
    console.log(`═══════════════════════════════════════════════════════════`);

    // Extraer ufrag
    const ufragMatch = sdpStr.match(/a=ice-ufrag:(\S+)/);
    const ufrag = ufragMatch ? ufragMatch[1] : null;
    console.log(`🔑 ufrag:`, ufrag ? `✅ ${ufrag}` : `❌ NO ENCONTRADO`);

    // Extraer pwd (password)
    const pwdMatch = sdpStr.match(/a=ice-pwd:(\S+)/);
    const pwd = pwdMatch ? pwdMatch[1] : null;
    console.log(`🔐 ice-pwd:`, pwd ? `✅ ${pwd.substring(0, 10)}...` : `❌ NO ENCONTRADO`);

    // Contar líneas m= (media lines: audio, video)
    const mediaLines = sdpStr.match(/^m=/gm);
    const mediaCount = mediaLines ? mediaLines.length : 0;
    console.log(`📹 Líneas de media (m=):`, mediaCount > 0 ? `✅ ${mediaCount}` : `❌ NINGUNA`);

    // Verificar líneas de media
    if (mediaLines) {
      mediaLines.forEach((line, index) => {
        const fullLine = sdpStr.substring(sdpStr.indexOf(line), sdpStr.indexOf('\n', sdpStr.indexOf(line)));
        console.log(`   ${index + 1}. ${fullLine.trim()}`);
      });
    }

    // Verificar fingerprint (seguridad)
    const fingerprintMatch = sdpStr.match(/a=fingerprint:(\S+)\s+(\S+)/);
    const fingerprint = fingerprintMatch ? fingerprintMatch[2] : null;
    console.log(`🔒 Fingerprint:`, fingerprint ? `✅ ${fingerprint.substring(0, 20)}...` : `❌ NO ENCONTRADO`);

    // Verificar servidores ICE en SDP
    const iceServers = sdpStr.match(/a=ice-server:([^\r\n]+)/g);
    console.log(`🌐 Servidores ICE en SDP:`, iceServers ? `✅ ${iceServers.length}` : `ℹ️ Usando configuración del PeerConnection`);

    // Verificar candidatos embebidos en SDP (si los hay)
    const embeddedCandidates = sdpStr.match(/a=candidate:/g);
    const embeddedCount = embeddedCandidates ? embeddedCandidates.length : 0;
    console.log(`📥 Candidatos embebidos en SDP:`, embeddedCount > 0 ? `✅ ${embeddedCount}` : `ℹ️ 0 (normal - se envían por separado)`);

    console.log(`═══════════════════════════════════════════════════════════`);

    return {
      ufrag,
      pwd,
      mediaCount,
      fingerprint: !!fingerprint,
      valid: !!(ufrag && pwd && mediaCount > 0 && fingerprint)
    };
  };

  // Función de diagnóstico completo de un candidato
  const diagnoseCandidate = (candidate, index, sdpUfrag = null) => {
    if (!candidate) {
      console.error(`❌ Candidato #${index}: No hay datos`);
      return null;
    }

    const candidateStr = candidate.candidate || '';
    if (!candidateStr) {
      console.error(`❌ Candidato #${index}: Campo 'candidate' vacío`);
      return null;
    }

    console.log(`═══════════════════════════════════════════════════════════`);
    console.log(`🔍 DIAGNÓSTICO DEL CANDIDATO #${index}`);
    console.log(`═══════════════════════════════════════════════════════════`);

    // Extraer ufrag del candidato
    const ufragMatch = candidateStr.match(/ufrag\s+(\S+)/);
    const candidateUfrag = ufragMatch ? ufragMatch[1] : null;
    console.log(`🔑 ufrag:`, candidateUfrag ? `✅ ${candidateUfrag}` : `❌ NO ENCONTRADO`);

    // Verificar coincidencia con SDP
    if (sdpUfrag && candidateUfrag) {
      if (candidateUfrag === sdpUfrag) {
        console.log(`✅ ufrag coincide con SDP`);
      } else {
        console.error(`❌ ufrag NO coincide con SDP! Esperado: ${sdpUfrag}, Encontrado: ${candidateUfrag}`);
      }
    }

    // Verificar sdpMLineIndex
    console.log(`📍 sdpMLineIndex:`, 
      candidate.sdpMLineIndex !== null && candidate.sdpMLineIndex !== undefined 
        ? `✅ ${candidate.sdpMLineIndex}` 
        : `❌ FALTA (null/undefined)`);

    // Verificar sdpMid
    console.log(`🏷️ sdpMid:`, 
      candidate.sdpMid ? `✅ ${candidate.sdpMid}` : `❌ FALTA (null/undefined)`);

    // Extraer tipo de candidato
    let candidateType = "unknown";
    let ip = "N/A";
    let port = "N/A";
    let isTurn = false;

    if (candidateStr.includes("typ host")) {
      candidateType = "HOST";
    } else if (candidateStr.includes("typ srflx")) {
      candidateType = "SRFLX";
    } else if (candidateStr.includes("typ relay")) {
      candidateType = "RELAY";
      isTurn = true;
    } else if (candidateStr.includes("typ prflx")) {
      candidateType = "PRFLX";
    }

    const ipMatch = candidateStr.match(/(\d+\.\d+\.\d+\.\d+)/);
    if (ipMatch) {
      ip = ipMatch[1];
    }

    const portMatch = candidateStr.match(/port (\d+)/);
    if (portMatch) {
      port = portMatch[1];
    }

    console.log(`📡 Tipo:`, candidateType);
    console.log(`🌐 IP:`, ip !== "N/A" ? `✅ ${ip}` : `❌ NO ENCONTRADA`);
    console.log(`🔌 Puerto:`, port !== "N/A" ? `✅ ${port}` : `❌ NO ENCONTRADO`);
    console.log(`🔀 Usando TURN:`, isTurn ? `✅ SÍ` : `❌ NO (P2P)`);

    // Validación completa
    const isValid = !!(
      candidate.candidate &&
      candidate.sdpMLineIndex !== null &&
      candidate.sdpMid &&
      candidateUfrag &&
      (!sdpUfrag || candidateUfrag === sdpUfrag)
    );

    console.log(`✅ Validación:`, isValid ? `✅ CANDIDATO VÁLIDO` : `❌ CANDIDATO INVÁLIDO`);
    console.log(`═══════════════════════════════════════════════════════════`);

    return {
      ufrag: candidateUfrag,
      sdpMLineIndex: candidate.sdpMLineIndex,
      sdpMid: candidate.sdpMid,
      type: candidateType,
      ip,
      port,
      isTurn,
      valid: isValid
    };
  };

  // Función de diagnóstico completo de getStats()
  const diagnoseGetStats = async (pc, label = "PeerConnection") => {
    if (!pc) {
      console.error(`❌ ${label}: No hay PeerConnection disponible`);
      return null;
    }

    try {
      const stats = await pc.getStats();
      console.log(`═══════════════════════════════════════════════════════════`);
      console.log(`📊 DIAGNÓSTICO COMPLETO DE GETSTATS() - ${label}`);
      console.log(`═══════════════════════════════════════════════════════════`);

      let localCandidates = [];
      let remoteCandidates = [];
      let candidatePairs = [];
      let localRelayCandidates = 0;
      let remoteRelayCandidates = 0;

      stats.forEach(report => {
        if (report.type === "local-candidate") {
          localCandidates.push({
            id: report.id,
            type: report.candidateType,
            ip: report.ip || report.address,
            port: report.port,
            protocol: report.protocol
          });
          if (report.candidateType === "relay") localRelayCandidates++;
        }

        if (report.type === "remote-candidate") {
          remoteCandidates.push({
            id: report.id,
            type: report.candidateType,
            ip: report.ip || report.address,
            port: report.port,
            protocol: report.protocol
          });
          if (report.candidateType === "relay") remoteRelayCandidates++;
        }

        if (report.type === "candidate-pair") {
          candidatePairs.push({
            id: report.id,
            state: report.state,
            localCandidateId: report.localCandidateId,
            remoteCandidateId: report.remoteCandidateId,
            bytesSent: report.bytesSent || 0,
            bytesReceived: report.bytesReceived || 0,
            nominated: report.nominated || false
          });
        }
      });

      console.log(`📤 Candidatos Locales:`, localCandidates.length > 0 ? `✅ ${localCandidates.length}` : `❌ 0`);
      localCandidates.forEach((c, i) => {
        console.log(`   ${i + 1}. ${c.type} - ${c.ip}:${c.port} (${c.protocol})`);
      });

      console.log(`📥 Candidatos Remotos:`, remoteCandidates.length > 0 ? `✅ ${remoteCandidates.length}` : `❌ 0`);
      if (remoteCandidates.length === 0) {
        console.error(`   ⚠️ PROBLEMA: No hay candidatos remotos en getStats() - Los candidatos no se añadieron o fueron rechazados`);
      } else {
        remoteCandidates.forEach((c, i) => {
          console.log(`   ${i + 1}. ${c.type} - ${c.ip}:${c.port} (${c.protocol})`);
        });
      }

      console.log(`🔗 Pares de Candidatos:`, candidatePairs.length > 0 ? `✅ ${candidatePairs.length}` : `❌ 0`);
      const succeededPairs = candidatePairs.filter(p => p.state === "succeeded");
      const failedPairs = candidatePairs.filter(p => p.state === "failed");
      const inProgressPairs = candidatePairs.filter(p => p.state === "in-progress");

      console.log(`   - Exitosos: ${succeededPairs.length}`);
      console.log(`   - En progreso: ${inProgressPairs.length}`);
      console.log(`   - Fallidos: ${failedPairs.length}`);

      if (succeededPairs.length > 0) {
        succeededPairs.forEach((p, i) => {
          console.log(`   ✅ Par exitoso ${i + 1}:`, {
            bytesEnviados: p.bytesSent,
            bytesRecibidos: p.bytesReceived,
            nominado: p.nominated ? "✅ SÍ" : "❌ NO"
          });
        });
      }

      console.log(`🔀 Candidatos TURN:`, {
        locales: localRelayCandidates > 0 ? `✅ ${localRelayCandidates}` : `❌ 0`,
        remotos: remoteRelayCandidates > 0 ? `✅ ${remoteRelayCandidates}` : `❌ 0`
      });

      // Diagnóstico del problema
      if (remoteCandidates.length === 0 && localCandidates.length > 0) {
        console.error(`❌ PROBLEMA IDENTIFICADO: Hay candidatos locales pero NO hay candidatos remotos`);
        console.error(`   Posibles causas:`);
        console.error(`   1. Los candidatos remotos nunca se añadieron al PeerConnection`);
        console.error(`   2. Los candidatos remotos fueron rechazados (ufrag incorrecto, formato inválido, etc.)`);
        console.error(`   3. Los candidatos remotos llegaron antes de setRemoteDescription`);
        console.error(`   4. Problema de sincronización/timing`);
      }

      if (candidatePairs.length === 0 && localCandidates.length > 0 && remoteCandidates.length > 0) {
        console.error(`❌ PROBLEMA IDENTIFICADO: Hay candidatos locales y remotos pero NO hay pares`);
        console.error(`   Posibles causas:`);
        console.error(`   1. Los candidatos no son compatibles (diferentes tipos, NAT simétrico, etc.)`);
        console.error(`   2. Problema con el servidor TURN`);
        console.error(`   3. Firewall bloqueando la conexión`);
      }

      console.log(`═══════════════════════════════════════════════════════════`);

      return {
        localCandidates: localCandidates.length,
        remoteCandidates: remoteCandidates.length,
        candidatePairs: candidatePairs.length,
        succeededPairs: succeededPairs.length,
        failedPairs: failedPairs.length,
        localRelayCandidates,
        remoteRelayCandidates,
        hasProblem: remoteCandidates.length === 0 || candidatePairs.length === 0
      };
    } catch (err) {
      console.error(`❌ Error obteniendo estadísticas de ${label}:`, err);
      return null;
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
      console.log(`2️⃣ [PC-${pcIdRef.current}] PeerConnection ya existe, reutilizando`);
      return pcRef.current;
    }

    // Incrementar ID del PeerConnection para diagnóstico
    pcIdRef.current++;
    const currentPcId = pcIdRef.current;
    console.log(`2️⃣ [PC-${currentPcId}] Creando nuevo PeerConnection`);
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
    console.log(`2️⃣ [PC-${pcIdRef.current}] PeerConnection asignado a pcRef.current`);
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
        
        try {
          const currentPcId = pcIdRef.current;
          
          // 2️⃣ LOG DIAGNÓSTICO: Candidato de la cola antes de añadir
          console.log(`2️⃣ ========== PROCESANDO CANDIDATO DE COLA ==========`);
          console.log(`2️⃣ [PC-${currentPcId}] [Cola ${processed + 1}/${queueLength}] Objeto completo:`, JSON.stringify({
            candidate: normalizedCandidate.candidate || null,
            sdpMLineIndex: normalizedCandidate.sdpMLineIndex,
            sdpMid: normalizedCandidate.sdpMid,
            tipoSdpMLineIndex: typeof normalizedCandidate.sdpMLineIndex,
            tipoSdpMid: typeof normalizedCandidate.sdpMid,
            tieneCandidate: !!normalizedCandidate.candidate,
            tieneSdpMLineIndex: normalizedCandidate.sdpMLineIndex !== null && normalizedCandidate.sdpMLineIndex !== undefined,
            tieneSdpMid: !!normalizedCandidate.sdpMid
          }, null, 2));
          console.log(`2️⃣ [PC-${currentPcId}] [Cola ${processed + 1}/${queueLength}] Validación de campos:`);
          console.log(`2️⃣   - candidate:`, normalizedCandidate.candidate ? `✅ "${normalizedCandidate.candidate.substring(0, 80)}..."` : "❌ FALTA");
          console.log(`2️⃣   - sdpMLineIndex:`, normalizedCandidate.sdpMLineIndex !== null && normalizedCandidate.sdpMLineIndex !== undefined ? `✅ ${normalizedCandidate.sdpMLineIndex} (${typeof normalizedCandidate.sdpMLineIndex})` : "❌ FALTA o null");
          console.log(`2️⃣   - sdpMid:`, normalizedCandidate.sdpMid ? `✅ "${normalizedCandidate.sdpMid}" (${typeof normalizedCandidate.sdpMid})` : "❌ FALTA o null");
          
          // Validar ufrag del candidato contra el SDP remoto si está disponible
          if (pcRef.current.remoteDescription) {
            const remoteSdpUfrag = extractUfragFromSdp(pcRef.current.remoteDescription.sdp);
            if (remoteSdpUfrag) {
              if (!validateCandidateUfrag(normalizedCandidate, remoteSdpUfrag)) {
                const candidateStr = normalizedCandidate.candidate || "N/A";
                const candidateUfrag = candidateStr.match(/ufrag\s+(\S+)/)?.[1] || "N/A";
                console.error(`❌ Candidato ${processed + 1} rechazado en cola: ufrag ${candidateUfrag} no coincide con SDP ${remoteSdpUfrag}`);
                failed++;
                continue; // Saltar este candidato
              }
            }
          }
          
          // 2️⃣ LOG DIAGNÓSTICO: Antes de addIceCandidate desde cola
          console.log(`2️⃣ [PC-${currentPcId}] [Cola ${processed + 1}/${queueLength}] Estado del PC antes de addIceCandidate:`);
          console.log(`2️⃣   - signalingState: ${pcRef.current.signalingState}`);
          console.log(`2️⃣   - iceConnectionState: ${pcRef.current.iceConnectionState}`);
          console.log(`2️⃣   - connectionState: ${pcRef.current.connectionState}`);
          console.log(`2️⃣   - hasRemoteDescription: ${!!pcRef.current.remoteDescription}`);
          console.log(`2️⃣   - hasLocalDescription: ${!!pcRef.current.localDescription}`);
          
          const iceCandidate = new RTCIceCandidate(normalizedCandidate);
          const addStartTime = Date.now();
          console.log(`2️⃣ [PC-${currentPcId}] [Cola ${processed + 1}/${queueLength}] Ejecutando: await pcRef.current.addIceCandidate(iceCandidate)...`);
          
          await pcRef.current.addIceCandidate(iceCandidate);
          
          const addDuration = Date.now() - addStartTime;
          processed++;
          console.log(`2️⃣ [PC-${currentPcId}] [Cola ${processed}/${queueLength}] ✅ addIceCandidate() EXITOSO`);
          console.log(`2️⃣   - Duración: ${addDuration}ms`);
          console.log(`2️⃣   - Estado después: iceConnectionState=${pcRef.current.iceConnectionState}`);
          console.log(`2️⃣ ==================================================`);
          
          console.log(`✅ ICE candidate ${processed}/${queueLength} añadido de la cola`);
          
          // Verificar que se añadió correctamente después de un breve delay
          setTimeout(async () => {
            try {
              const stats = await pcRef.current.getStats();
              let remoteCount = 0;
              stats.forEach(report => {
                if (report.type === "remote-candidate") remoteCount++;
              });
              if (processed <= 2) { // Solo loggear los primeros para no saturar
                console.log(`🔍 Verificación cola: ${remoteCount} candidatos remotos en PC después de añadir ${processed}`);
                if (remoteCount < processed) {
                  console.warn(`⚠️ ADVERTENCIA: Se añadieron ${processed} pero solo ${remoteCount} aparecen en getStats() - Algunos candidatos fueron rechazados`);
                }
              }
            } catch (e) {
              // Ignorar errores de verificación
            }
          }, 100); // Aumentar delay para dar tiempo al navegador
        } catch (queueError) {
          // 2️⃣ LOG DIAGNÓSTICO: Error en addIceCandidate desde cola
          const currentPcId = pcIdRef.current;
          console.error(`2️⃣ ========== ERROR EN addIceCandidate() DESDE COLA ==========`);
          console.error(`2️⃣ [PC-${currentPcId}] [Cola ${processed + 1}/${queueLength}] ❌ addIceCandidate() FALLÓ`);
          console.error(`2️⃣   - Error Name: ${queueError.name}`);
          console.error(`2️⃣   - Error Message: ${queueError.message}`);
          console.error(`2️⃣   - Error Code: ${queueError.code || "N/A"}`);
          console.error(`2️⃣   - Error Stack:`, queueError.stack);
          console.error(`2️⃣   - Candidato que falló:`, {
            candidate: normalizedCandidate.candidate?.substring(0, 80) || "N/A",
            sdpMLineIndex: normalizedCandidate.sdpMLineIndex,
            sdpMid: normalizedCandidate.sdpMid,
            tipoSdpMLineIndex: typeof normalizedCandidate.sdpMLineIndex,
            tipoSdpMid: typeof normalizedCandidate.sdpMid
          });
          console.error(`2️⃣   - Estado del PC:`, {
            signalingState: pcRef.current?.signalingState,
            iceConnectionState: pcRef.current?.iceConnectionState,
            connectionState: pcRef.current?.connectionState,
            hasRemoteDescription: !!pcRef.current?.remoteDescription,
            hasLocalDescription: !!pcRef.current?.localDescription
          });
          console.error("2️⃣ ========================================================");
          
          // Si falla al añadir, el candidato podría ser inválido
          failed++;
          logCriticalError(ErrorCodes.ICE_CANDIDATE_ERROR, "Error añadiendo ICE candidate de la cola", {
            errorName: queueError.name,
            errorMessage: queueError.message,
            errorCode: queueError.code,
            candidate: normalizedCandidate.candidate?.substring(0, 80) || "N/A",
            sdpMLineIndex: normalizedCandidate.sdpMLineIndex,
            sdpMid: normalizedCandidate.sdpMid,
            processed: processed,
            remaining: iceCandidatesQueue.current.length,
            note: "Este candidato será descartado y la conexión continuará con los demás"
          });
          // NO re-lanzar el error, continuar con los demás candidatos
        }
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
    
    // DIAGNÓSTICO: Verificar el SDP antes de establecerlo
    const sdpDiagnosis = diagnoseSdp(sdp, "OFFER RECIBIDO");
    
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log("✅ RemoteDescription establecido, signalingState:", pc.signalingState);
      
      // IMPORTANTE: Esperar un momento para que setRemoteDescription se procese completamente
      // Esto asegura que el navegador esté listo para recibir candidatos
      await new Promise(resolve => setTimeout(resolve, 50));
      console.log("⏳ Espera post-setRemoteDescription completada, listo para candidatos");
      
      // DIAGNÓSTICO: Verificar getStats() inmediatamente después de setRemoteDescription
      console.log("🔍 Diagnóstico inicial de getStats() después de setRemoteDescription...");
      await diagnoseGetStats(pc, "DESPUÉS DE SETREMOTEDESCRIPTION");
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
    
    // Extraer ufrag del SDP del offer para validar candidatos
    const sdpUfrag = extractUfragFromSdp(sdp?.sdp || (typeof sdp === 'string' ? sdp : sdp?.sdp));
    if (sdpUfrag) {
      console.log("🔑 ufrag extraído del SDP del offer:", sdpUfrag);
      console.log("🔍 Validando candidatos en cola contra ufrag del SDP...");
      
      // Filtrar candidatos que no coincidan con el ufrag del SDP
      const candidatosValidos = [];
      const candidatosInvalidos = [];
      
      iceCandidatesQueue.current.forEach((candidate, index) => {
        if (validateCandidateUfrag(candidate, sdpUfrag)) {
          candidatosValidos.push(candidate);
        } else {
          candidatosInvalidos.push({ index, candidate });
        }
      });
      
      if (candidatosInvalidos.length > 0) {
        console.error(`❌ ERROR: ${candidatosInvalidos.length} candidatos tienen ufrag incorrecto y serán descartados`);
        candidatosInvalidos.forEach(c => {
          const candidateStr = c.candidate?.candidate || "N/A";
          const candidateUfrag = candidateStr.match(/ufrag\s+(\S+)/)?.[1] || "N/A";
          console.error(`   - Candidato ${c.index + 1}: ufrag ${candidateUfrag} (esperado: ${sdpUfrag})`);
        });
      }
      
      if (candidatosValidos.length !== iceCandidatesQueue.current.length) {
        console.warn(`⚠️ Filtrando candidatos: ${iceCandidatesQueue.current.length} → ${candidatosValidos.length} válidos`);
        iceCandidatesQueue.current = candidatosValidos;
        console.log("✅ Cola filtrada:", iceCandidatesQueue.current.length, "candidatos válidos");
      } else {
        console.log("✅ Todos los candidatos en cola tienen ufrag válido");
      }
    } else {
      console.warn("⚠️ No se pudo extraer ufrag del SDP, no se validarán candidatos");
    }
    
    // Si la cola se perdió pero tenemos una copia preservada, restaurarla
    if (candidatosEnColaAntes > 0 && iceCandidatesQueue.current.length === 0) {
      console.error("❌ ERROR CRÍTICO: Se perdieron candidatos ICE de la cola! Había", candidatosEnColaAntes, "y ahora hay 0");
      if (colaPreservada.length > 0) {
        console.log("🔄 Restaurando cola desde copia preservada...");
        iceCandidatesQueue.current = [...colaPreservada];
        console.log("✅ Cola restaurada:", iceCandidatesQueue.current.length, "candidatos");
      }
    }
    
    // Procesar candidatos ANTES de añadir tracks y crear answer
    // Esto asegura que los candidatos remotos estén disponibles cuando creamos el answer
    await processIceQueue();
    console.log("📞 Candidatos procesados, cola restante:", iceCandidatesQueue.current.length);
    
    // DIAGNÓSTICO COMPLETO: Verificar getStats() después de procesar la cola
    console.log("🔍 Diagnóstico completo de getStats() después de procesar cola...");
    const statsDiagnosis = await diagnoseGetStats(pc, "DESPUÉS DE PROCESAR COLA");
    
    if (statsDiagnosis && statsDiagnosis.remoteCandidates === 0 && candidatosEnColaAntes > 0) {
      console.error(`❌ PROBLEMA CRÍTICO: Se procesaron ${candidatosEnColaAntes} candidatos pero 0 aparecen en getStats()`);
      console.error(`   Esto indica que los candidatos fueron rechazados silenciosamente`);
      console.error(`   Posibles causas:`);
      console.error(`   1. ufrag incorrecto (ya validado arriba)`);
      console.error(`   2. Formato de candidato inválido`);
      console.error(`   3. sdpMLineIndex o sdpMid incorrectos`);
      console.error(`   4. Candidatos de una sesión ICE anterior`);
    }

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
      
      // IMPORTANTE: Después de setLocalDescription, verificar si hay más candidatos en cola
      // (pueden haber llegado mientras creábamos el answer)
      // También re-procesar candidatos que pudieron haber fallado antes
      if (iceCandidatesQueue.current.length > 0) {
        console.log(`📞 Procesando ${iceCandidatesQueue.current.length} candidatos adicionales después de setLocalDescription...`);
        await processIceQueue();
      }
      
      // DIAGNÓSTICO COMPLETO: Verificar getStats() después de setLocalDescription
      console.log("🔍 Diagnóstico completo de getStats() después de setLocalDescription...");
      await diagnoseGetStats(pc, "DESPUÉS DE SETLOCALDESCRIPTION");

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
    
    // 2️⃣ LOG DIAGNÓSTICO: Objeto completo del candidato recibido
    console.log("2️⃣ ========== CANDIDATO RECIBIDO (OBJETO COMPLETO) ==========");
    console.log("2️⃣ [Candidato #" + receivedCandidatesCountRef.current + "] Objeto completo:", JSON.stringify({
      candidate: candidate.candidate || null,
      sdpMLineIndex: candidate.sdpMLineIndex,
      sdpMid: candidate.sdpMid,
      tipoSdpMLineIndex: typeof candidate.sdpMLineIndex,
      tipoSdpMid: typeof candidate.sdpMid,
      tieneCandidate: !!candidate.candidate,
      tieneSdpMLineIndex: candidate.sdpMLineIndex !== null && candidate.sdpMLineIndex !== undefined,
      tieneSdpMid: !!candidate.sdpMid,
      fromUserId: fromUserId
    }, null, 2));
    console.log("2️⃣ [Candidato #" + receivedCandidatesCountRef.current + "] Validación de campos:");
    console.log("2️⃣   - candidate:", candidate.candidate ? `✅ "${candidate.candidate.substring(0, 80)}..."` : "❌ FALTA");
    console.log("2️⃣   - sdpMLineIndex:", candidate.sdpMLineIndex !== null && candidate.sdpMLineIndex !== undefined ? `✅ ${candidate.sdpMLineIndex} (${typeof candidate.sdpMLineIndex})` : "❌ FALTA o null");
    console.log("2️⃣   - sdpMid:", candidate.sdpMid ? `✅ "${candidate.sdpMid}" (${typeof candidate.sdpMid})` : "❌ FALTA o null");
    console.log("2️⃣ ==========================================================");
    
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
    const currentPcId = pcIdRef.current;
    console.log(`2️⃣ [PC-${currentPcId}] PeerConnection actual:`, pc ? "✅ Existe" : "❌ No existe");
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
        
        // Validar ufrag del candidato contra el SDP remoto si está disponible
        if (pc.remoteDescription) {
          const remoteSdpUfrag = extractUfragFromSdp(pc.remoteDescription.sdp);
          if (remoteSdpUfrag) {
            // DIAGNÓSTICO: Diagnosticar candidato antes de validar (solo los primeros 3)
            if (receivedCandidatesCountRef.current <= 3) {
              diagnoseCandidate(normalizedCandidate, receivedCandidatesCountRef.current, remoteSdpUfrag);
            }
            
            if (!validateCandidateUfrag(normalizedCandidate, remoteSdpUfrag)) {
              logCriticalError(ErrorCodes.ICE_CANDIDATE_ERROR, "Candidato rechazado: ufrag no coincide con SDP remoto", {
                fromUserId: fromUserId,
                candidateNumber: receivedCandidatesCountRef.current,
                candidateUfrag: normalizedCandidate.candidate?.match(/ufrag\s+(\S+)/)?.[1] || "N/A",
                sdpUfrag: remoteSdpUfrag,
                candidate: normalizedCandidate.candidate?.substring(0, 80) || "N/A",
                note: "Este candidato será descartado - no pertenece a esta sesión ICE"
              });
              return; // Descartar candidato con ufrag incorrecto
            }
            console.log(`✅ ufrag del candidato coincide con SDP remoto: ${remoteSdpUfrag}`);
          }
        }
        
        try {
          const iceCandidate = new RTCIceCandidate(normalizedCandidate);
          const currentPcId = pcIdRef.current;
          
          // 2️⃣ LOG DIAGNÓSTICO: Antes de addIceCandidate
          console.log("2️⃣ ========== INTENTANDO addIceCandidate() ==========");
          console.log(`2️⃣ [PC-${currentPcId}] [Candidato #${receivedCandidatesCountRef.current}] Antes de addIceCandidate:`);
          console.log("2️⃣   - Objeto RTCIceCandidate creado:", {
            candidate: normalizedCandidate.candidate?.substring(0, 80) || "N/A",
            sdpMLineIndex: normalizedCandidate.sdpMLineIndex,
            sdpMid: normalizedCandidate.sdpMid,
            tipoSdpMLineIndex: typeof normalizedCandidate.sdpMLineIndex,
            tipoSdpMid: typeof normalizedCandidate.sdpMid
          });
          console.log(`2️⃣   - PeerConnection ID: ${currentPcId}`);
          console.log(`2️⃣   - signalingState: ${pc.signalingState}`);
          console.log(`2️⃣   - iceConnectionState: ${pc.iceConnectionState}`);
          console.log(`2️⃣   - connectionState: ${pc.connectionState}`);
          console.log(`2️⃣   - hasRemoteDescription: ${!!pc.remoteDescription}`);
          console.log(`2️⃣   - hasLocalDescription: ${!!pc.localDescription}`);
          
          // Verificar que el candidato sea válido antes de añadirlo
          console.log("📋 Candidato normalizado:", {
            candidate: normalizedCandidate.candidate?.substring(0, 80) || "N/A",
            sdpMLineIndex: normalizedCandidate.sdpMLineIndex,
            sdpMid: normalizedCandidate.sdpMid,
            iceConnectionState: pc.iceConnectionState,
            signalingState: pc.signalingState
          });
          
          // 2️⃣ LOG DIAGNÓSTICO: Ejecutando addIceCandidate con await
          const addStartTime = Date.now();
          console.log(`2️⃣ [PC-${currentPcId}] [Candidato #${receivedCandidatesCountRef.current}] Ejecutando: await pc.addIceCandidate(iceCandidate)...`);
          
          await pc.addIceCandidate(iceCandidate);
          
          const addDuration = Date.now() - addStartTime;
          console.log(`2️⃣ [PC-${currentPcId}] [Candidato #${receivedCandidatesCountRef.current}] ✅ addIceCandidate() EXITOSO`);
          console.log(`2️⃣   - Duración: ${addDuration}ms`);
          console.log(`2️⃣   - Estado después: iceConnectionState=${pc.iceConnectionState}, signalingState=${pc.signalingState}`);
          console.log("2️⃣ ==================================================");
          
          console.log(`✅ ICE candidate #${receivedCandidatesCountRef.current} añadido correctamente al PeerConnection`);
          console.log("📞 ICE Connection State después de añadir:", pc.iceConnectionState);
          
          // DIAGNÓSTICO: Verificar periódicamente getStats() después de añadir candidatos
          // Solo para los primeros 3 candidatos para no saturar
          if (receivedCandidatesCountRef.current <= 3 || receivedCandidatesCountRef.current % 5 === 0) {
            setTimeout(async () => {
              try {
                console.log(`🔍 Diagnóstico periódico de getStats() después de añadir candidato #${receivedCandidatesCountRef.current}...`);
                await diagnoseGetStats(pc, `DESPUÉS DE AÑADIR CANDIDATO #${receivedCandidatesCountRef.current}`);
              } catch (e) {
                console.warn("⚠️ Error en diagnóstico periódico:", e);
              }
            }, 200);
          }
          
        } catch (addError) {
          // 2️⃣ LOG DIAGNÓSTICO: Error en addIceCandidate
          const currentPcId = pcIdRef.current;
          console.error("2️⃣ ========== ERROR EN addIceCandidate() ==========");
          console.error(`2️⃣ [PC-${currentPcId}] [Candidato #${receivedCandidatesCountRef.current}] ❌ addIceCandidate() FALLÓ`);
          console.error(`2️⃣   - Error Name: ${addError.name}`);
          console.error(`2️⃣   - Error Message: ${addError.message}`);
          console.error(`2️⃣   - Error Code: ${addError.code || "N/A"}`);
          console.error(`2️⃣   - Error Stack:`, addError.stack);
          console.error(`2️⃣   - Candidato que falló:`, {
            candidate: normalizedCandidate.candidate?.substring(0, 80) || "N/A",
            sdpMLineIndex: normalizedCandidate.sdpMLineIndex,
            sdpMid: normalizedCandidate.sdpMid,
            tipoSdpMLineIndex: typeof normalizedCandidate.sdpMLineIndex,
            tipoSdpMid: typeof normalizedCandidate.sdpMid
          });
          console.error(`2️⃣   - Estado del PC:`, {
            signalingState: pc.signalingState,
            iceConnectionState: pc.iceConnectionState,
            connectionState: pc.connectionState,
            hasRemoteDescription: !!pc.remoteDescription,
            hasLocalDescription: !!pc.localDescription
          });
          console.error("2️⃣ ================================================");
          
          // El error podría ser silencioso, capturarlo explícitamente
          logCriticalError(ErrorCodes.ICE_CANDIDATE_ERROR, "Error añadiendo ICE candidate (puede ser rechazado silenciosamente)", {
            errorName: addError.name,
            errorMessage: addError.message,
            errorCode: addError.code,
            fromUserId: fromUserId,
            candidateNumber: receivedCandidatesCountRef.current,
            candidate: normalizedCandidate.candidate?.substring(0, 80) || "N/A",
            sdpMLineIndex: normalizedCandidate.sdpMLineIndex,
            sdpMid: normalizedCandidate.sdpMid,
            iceConnectionState: pc.iceConnectionState,
            signalingState: pc.signalingState,
            hasRemoteDescription: !!pc.remoteDescription,
            note: "Si el error es 'InvalidStateError', el candidato puede no ser válido para esta sesión ICE"
          });
          throw addError; // Re-lanzar para que se maneje en el catch externo
        }
        
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
