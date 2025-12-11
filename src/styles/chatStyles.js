// src/styles/chatStyles.js

export const chatStyles = {
  contenedor: {
    minHeight: "100vh",
    width: "100%",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "#f3f4f6",
    padding: "20px"
  },
  app: {
    width: 1400,
    maxWidth: 1400,
    minWidth: 1400,
    height: "90vh", // altura fija del layout
    display: "flex",
    flexDirection: "column",
    background: "white",
    borderRadius: 8,
    boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
    overflow: "hidden",
    border: "1px solid #e5e7eb",
    boxSizing: "border-box"
  },
  encabezado: {
    height: 56,
    background: "#2563eb",
    color: "white",
    padding: "0 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    fontSize: 14,
    flexShrink: 0
  },
  cuerpo: {
    flex: 1,
    display: "flex",
    overflow: "hidden", // importante para que el scroll sea interno
    width: "100%",
    minWidth: 0, // permite que flex funcione correctamente
    minHeight: 0,
    boxSizing: "border-box"
  },
  barraLateral: {
    width: 300,
    minWidth: 300,
    maxWidth: 300,
    borderRight: "1px solid #e5e7eb",
    padding: 16,
    overflowY: "auto",
    maxHeight: "calc(90vh - 56px)",
    flexShrink: 0,
    boxSizing: "border-box",
    background: "#ffffff"
  },
  areaChat: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minHeight: 0,
    maxHeight: "calc(90vh - 56px)",
    minWidth: 0,
    boxSizing: "border-box",
    background: "#ffffff"
  },
  listaUsuarios: {
    listStyle: "none",
    padding: 0,
    margin: 0
  },
  itemUsuario: {
    padding: "8px 12px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 8,
    borderRadius: 4,
    fontSize: 14,
    border: "1px solid transparent",
    marginBottom: 2,
    transition: "background-color 0.2s, border-color 0.2s"
  },
  puntoEstado: {
    width: 10,
    height: 10,
    borderRadius: "50%"
  },
  encabezadoChat: {
    flexShrink: 0,
    padding: 12,
    borderBottom: "1px solid #e5e7eb",
    background: "#f9fafb"
  },
  mensajes: {
    flex: 1,
    minHeight: 0,
    maxHeight: "100%",
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    overflowY: "auto",
    overflowX: "hidden",
    background: "#f3f4f6"
  },
  mensaje: {
    maxWidth: 400, // ancho máximo fijo en píxeles
    minWidth: 100,
    padding: 8,
    borderRadius: 8,
    border: "1px solid #e5e7eb",
    background: "white",
    fontSize: 14,
    wordWrap: "break-word",
    overflowWrap: "break-word"
  },
  barraEntrada: {
    flexShrink: 0,
    padding: "12px 16px",
    borderTop: "1px solid #e5e7eb",
    display: "flex",
    gap: 12,
    background: "#f9fafb",
    alignItems: "center"
  },
  inputFlex: {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid #d1d5db",
    fontSize: 14,
    outline: "none"
  },
  tarjetaAuth: {
    width: 320,
    background: "white",
    padding: 24,
    borderRadius: 8,
    boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
  },
  formulario: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginTop: 12
  },
  input: {
    padding: 8,
    borderRadius: 4,
    border: "1px solid #d1d5db"
  },
  botonPrimario: {
    padding: "10px 20px",
    borderRadius: 6,
    border: "none",
    background: "#16a34a",
    color: "white",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 500,
    whiteSpace: "nowrap",
    minWidth: 80,
    transition: "background-color 0.2s"
  },
  botonSecundario: {
    marginTop: 0,
    padding: "6px 10px",
    borderRadius: 4,
    border: "1px solid #d1d5db",
    background: "white",
    cursor: "pointer",
    fontSize: 13
  },
  escribiendo: {
    fontSize: 12,
    opacity: 0.7,
    fontStyle: "italic",
    padding: "2px 8px"
  },
  // Pestañas
  barraPestanias: {
    display: "flex",
    alignItems: "stretch",
    borderBottom: "1px solid #e5e7eb",
    background: "#e5e7eb",
    minHeight: 32,
    overflowX: "auto",
    flexShrink: 0
  },
  itemPestania: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    cursor: "pointer",
    fontSize: 13,
    borderRight: "1px solid #d1d5db",
    position: "relative",
    whiteSpace: "nowrap"
  },
  botonCerrarPestania: {
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: 12,
    padding: 0,
    marginLeft: 4
  },
  badge: {
    background: "#ef4444",
    color: "white",
    borderRadius: 999,
    fontSize: 10,
    padding: "2px 6px"
  },
  badgePequeno: {
    background: "#ef4444",
    color: "white",
    borderRadius: 999,
    fontSize: 9,
    padding: "0 5px",
    marginLeft: 4
  },
  // Modal
  fondoModal: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.35)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 50
  },
  contenidoModal: {
    width: 380,
    maxHeight: "70vh",
    background: "white",
    borderRadius: 8,
    boxShadow: "0 8px 20px rgba(0,0,0,0.25)",
    padding: 16,
    display: "flex",
    flexDirection: "column"
  },
  listaModal: {
    flex: 1,
    border: "1px solid #e5e7eb",
    borderRadius: 4,
    padding: "6px 10px",
    overflowY: "auto",
    maxHeight: "40vh",
    marginBottom: 10,
    background: "#f9fafb"
  },
  pieModal: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4
  },
  contenedorLista: {
    maxHeight: 180,
    overflowY: "auto",
    paddingRight: 4
  }
};
