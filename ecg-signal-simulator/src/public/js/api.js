// Cliente mínimo para la API REST (cookies de sesión incluidas)
const API = {
    async request(method, url, body) {
        const opciones = { method, credentials: 'same-origin', headers: {} };
        if (body !== undefined) {
            opciones.headers['Content-Type'] = 'application/json';
            opciones.body = JSON.stringify(body);
        }
        const res = await fetch(url, opciones);
        let datos = null;
        try { datos = await res.json(); } catch { /* respuesta sin cuerpo */ }
        if (!res.ok) {
            const mensaje = res.status === 405
                ? 'La API no está disponible en esta dirección. Inicia el servidor con "npm start" dentro de la carpeta ecg-signal-simulator y abre http://localhost:3000 (no uses Live Server).'
                : (datos && datos.error) || `Error ${res.status}`;
            const err = new Error(mensaje);
            err.status = res.status;
            err.data = datos;
            throw err;
        }
        return datos;
    },
    get(url) { return this.request('GET', url); },
    post(url, body = {}) { return this.request('POST', url, body); },
    patch(url, body = {}) { return this.request('PATCH', url, body); },
    del(url) { return this.request('DELETE', url); },
};
