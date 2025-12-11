import React from "react";

// ======================================================
// MODAL DE LLAMADA ENTRANTE
// ======================================================
export function IncomingCallModal({ incomingCall, usuarios }) {
    if (!incomingCall) return null;

    const user =
        usuarios.find((u) => u.id === incomingCall.fromUserId) || {
            username: "Usuario",
        };

    return (
        <div className="fondo-modal">
            <div
                style={{
                    background: "white",
                    padding: 20,
                    borderRadius: 10,
                    boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
                    minWidth: 260,
                    textAlign: "center",
                }}
            >
                <div style={{ marginBottom: 12, fontSize: 16 }}>
                    <strong>{user.username}</strong> te está llamando
                    <br />
                    <span style={{ fontSize: 13, opacity: 0.7 }}>
                        ({incomingCall.callMode === "video"
                            ? "videollamada"
                            : incomingCall.callMode === "audio"
                                ? "llamada de audio"
                                : "pantalla"})
                    </span>
                </div>

                <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
                    <button
                        onClick={() => incomingCall.accept()}
                        style={{
                            padding: "6px 14px",
                            background: "#16a34a",
                            color: "white",
                            border: "none",
                            borderRadius: 6,
                            cursor: "pointer",
                        }}
                    >
                        Aceptar
                    </button>

                    <button
                        onClick={() => incomingCall.reject()}
                        style={{
                            padding: "6px 14px",
                            background: "#dc2626",
                            color: "white",
                            border: "none",
                            borderRadius: 6,
                            cursor: "pointer",
                        }}
                    >
                        Rechazar
                    </button>
                </div>
            </div>
        </div>
    );
}
