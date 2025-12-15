//const API_URL = "http://localhost:4000";
const API_URL = "https://backchat.hginet.com.co";

// Registramos usuarios
export async function register(username, password) {
  const res = await fetch(`${API_URL}/api/register`, {
    method: "POST",  // usamos POST para crear el usuario
    headers: { "Content-Type": "application/json" },   // indicamos que enviamos JSON
    body: JSON.stringify({ username, password })   // cuerpo con credenciales
  });
  // Si la respuesta NO es 2xx, lanzamos el error que venga en el JSON
  if (!res.ok) throw await res.json();
  return res.json();   // Si todo va bien, devolvemos el JSON (user + token, etc.)
}

// Inicia sesión de un usuario existente.
//  Envía usuario y contraseña al endpoint /api/login por POST.
export async function login(username, password) {
  const res = await fetch(`${API_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) throw await res.json();
  return res.json();
}

//  * Obtiene la lista de usuarios registrados en el sistema.
//  * Se usa para mostrar usuarios conectados / desconectados.
export async function getUsers(token) {
  const res = await fetch(`${API_URL}/api/users`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw await res.json();
  return res.json();
}
//  * Obtiene el historial de mensajes 1 a 1 entre el usuario autenticado
export async function getMessages(token, otherUserId) {
  const res = await fetch(`${API_URL}/api/messages/${otherUserId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw await res.json();
  return res.json();
}

// Obtiene la lista de salas (rooms) a las que el usuario tiene acceso.

export async function getRooms(token) {
  const res = await fetch(`${API_URL}/api/rooms`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw await res.json();
  return res.json();
}
// * Crea una nueva sala de chat (room).
export async function createRoom(token, name, memberIds) {
  const res = await fetch(`${API_URL}/api/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ name, memberIds })
  });
  if (!res.ok) throw await res.json();
  return res.json();
}

//  * Actualiza los integrantes (members) de una sala existente.
//  * Esta función debe apuntar a un endpoint que tú definas en el backend,
//  * por ejemplo: PUT /api/rooms/:roomId/members
export async function updateRoomMembers(token, roomId, memberIds) {
  console.log("updateRoomMembers llamado:", { roomId, memberIds, token: token ? "presente" : "ausente" });

  const url = `${API_URL}/api/rooms/${roomId}/members`;
  console.log("URL:", url);

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ memberIds })
  });

  console.log("Respuesta del servidor:", res.status, res.statusText);

  if (!res.ok) {
    const errorText = await res.text();
    console.error("Error response text:", errorText);
    let error;
    try {
      error = JSON.parse(errorText);
    } catch {
      error = { error: `Error ${res.status}: ${res.statusText}`, details: errorText };
    }
    throw error;
  }

  const result = await res.json();
  console.log("Resultado exitoso:", result);
  return result;
}

//  Obtiene el historial de mensajes de una sala específica.
export async function getRoomMessages(token, roomId) {
  const res = await fetch(`${API_URL}/api/rooms/${roomId}/messages`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw await res.json();
  return res.json();
}

// Obtiene los miembros de una sala
export async function getRoomMembers(token, roomId) {
  const res = await fetch(`${API_URL}/api/rooms/${roomId}/members`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `Error ${res.status}: ${res.statusText}` }));
    throw error;
  }
  return res.json();
}

// Elimina una sala
export async function deleteRoom(token, roomId) {
  const res = await fetch(`${API_URL}/api/rooms/${roomId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `Error ${res.status}: ${res.statusText}` }));
    throw error;
  }
  return res.json();
}

// Subir archivo
export async function uploadFile(token, file) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_URL}/api/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
      // No poner Content-Type, fetch lo pone automático con boundary para FormData
    },
    body: formData
  });

  if (!res.ok) throw await res.json();
  return res.json(); // { url, type, name }
}