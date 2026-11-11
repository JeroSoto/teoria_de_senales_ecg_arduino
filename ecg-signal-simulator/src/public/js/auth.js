// Inicio de sesión / registro. Emite el evento "auth:change" con el usuario (o null).
const Auth = {
    user: null,
    modo: 'login',

    init() {
        this.dlg = document.getElementById('authDialog');
        this.form = document.getElementById('authForm');
        this.error = document.getElementById('authError');
        this.btnSwitch = document.getElementById('authSwitch');

        document.getElementById('btnLogin').addEventListener('click', () => this.abrir('login'));
        document.getElementById('btnRegister').addEventListener('click', () => this.abrir('registro'));
        document.getElementById('btnLogout').addEventListener('click', () => this.salir());
        document.getElementById('authCancel').addEventListener('click', () => this.dlg.close());
        this.btnSwitch.addEventListener('click', () => this.cambiarModo(this.modo === 'login' ? 'registro' : 'login'));
        this.form.addEventListener('submit', (e) => { e.preventDefault(); this.enviar(); });

        this.detectarModo();
    },

    /**
     * ¿Dónde se está ejecutando la página?
     *   servidor → npm start con MySQL: sesión, historial y Arduino por el servidor.
     *   sin-bd   → npm start con MySQL apagado: simulador + Arduino por USB desde el navegador.
     *   web      → sitio estático (Vercel, Live Server, archivo local): simulador + Arduino por USB.
     */
    async detectarModo() {
        let config = null;
        try { config = await API.get('/api/config'); } catch { /* sin servidor */ }
        const modo = !config || !config.servidor ? 'web' : config.baseDeDatos === false ? 'sin-bd' : 'servidor';
        window.ECGModo = { modo, arduino: config && config.arduino ? config.arduino.modo : 'ninguno' };
        document.body.dataset.modo = modo;
        document.dispatchEvent(new CustomEvent('modo:listo', { detail: window.ECGModo }));

        if (modo !== 'servidor') {
            this.mostrarAviso(modo);
            this.fijarUsuario(null);
            return;
        }
        // Restaura la sesión si la cookie sigue vigente (sin sesión el servidor responde 401)
        API.get('/api/auth/yo')
            .then((r) => this.fijarUsuario(r.usuario))
            .catch(() => this.fijarUsuario(null));
    },

    mostrarAviso(modo) {
        const textos = {
            web: ['Versión web.', 'Simulador, filtros y análisis funcionan en cualquier celular. Para ver tu Arduino en vivo, conéctalo por USB a este computador y usa «Conectar Arduino» (Chrome o Edge). Sesión e historial solo con npm start.'],
            'sin-bd': ['MySQL está apagado.', 'Abre XAMPP, pulsa «Start» en MySQL y recarga para usar sesión e historial. Mientras tanto puedes conectar el Arduino por USB desde el navegador.'],
        };
        const [titulo, texto] = textos[modo];
        document.getElementById('demoTitle').textContent = titulo;
        document.getElementById('demoText').textContent = texto;
        document.getElementById('demoBanner').hidden = false;
    },

    abrir(modo) {
        this.cambiarModo(modo);
        this.form.reset();
        this.mostrarError('');
        this.dlg.showModal();
        document.getElementById(modo === 'registro' ? 'authName' : 'authEmail').focus();
    },

    cambiarModo(modo) {
        this.modo = modo;
        const registro = modo === 'registro';
        document.getElementById('authTitle').textContent = registro ? 'Crear cuenta' : 'Iniciar sesión';
        document.getElementById('authNameRow').hidden = !registro;
        document.getElementById('authPwHint').hidden = !registro;
        document.getElementById('authSubmit').textContent = registro ? 'Crear cuenta' : 'Entrar';
        document.getElementById('authPassword').autocomplete = registro ? 'new-password' : 'current-password';
        this.btnSwitch.textContent = registro ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Crear una';
        this.mostrarError('');
    },

    mostrarError(msg) {
        this.error.textContent = msg;
        this.error.hidden = !msg;
    },

    async enviar() {
        const email = document.getElementById('authEmail').value.trim();
        const password = document.getElementById('authPassword').value;
        const nombre = document.getElementById('authName').value.trim();
        const boton = document.getElementById('authSubmit');
        boton.disabled = true;
        try {
            const r = this.modo === 'registro'
                ? await API.post('/api/auth/registro', { nombre, email, password })
                : await API.post('/api/auth/login', { email, password });
            this.dlg.close();
            this.fijarUsuario(r.usuario);
        } catch (err) {
            this.mostrarError(err.message);
        } finally {
            boton.disabled = false;
        }
    },

    async salir() {
        try { await API.post('/api/auth/logout'); } catch { /* da igual: se limpia el estado local */ }
        this.fijarUsuario(null);
    },

    fijarUsuario(usuario) {
        this.user = usuario;
        const nombre = document.getElementById('authUser');
        nombre.hidden = !usuario;
        nombre.textContent = usuario ? `${usuario.nombre}${usuario.rol === 'admin' ? ' (admin)' : ''}` : '';
        document.getElementById('btnLogin').hidden = !!usuario;
        document.getElementById('btnRegister').hidden = !!usuario;
        document.getElementById('btnLogout').hidden = !usuario;
        document.dispatchEvent(new CustomEvent('auth:change', { detail: usuario }));
    },
};

document.addEventListener('DOMContentLoaded', () => Auth.init());
