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

        // Restaura la sesión si la cookie sigue vigente
        API.get('/api/auth/yo')
            .then((r) => this.fijarUsuario(r.usuario))
            .catch(() => this.fijarUsuario(null));
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
