// Historial de mediciones (MySQL) y administración de usuarios
const History = {
    timer: null,

    init() {
        const $ = (id) => document.getElementById(id);
        this.el = {
            lock: $('historyLock'), panel: $('historyPanel'), msg: $('historyMsg'),
            chk: $('chkSaveBpm'), summary: $('historySummary'), rows: $('historyRows'),
            refresh: $('btnHistoryRefresh'), clear: $('btnHistoryClear'),
            adminCard: $('adminCard'), adminRows: $('adminRows'),
        };
        this.el.refresh.addEventListener('click', () => this.cargar());
        this.el.clear.addEventListener('click', () => this.borrar());
        this.el.chk.addEventListener('change', () => this.programarGuardado());
        document.addEventListener('auth:change', (e) => this.alCambiarSesion(e.detail));
    },

    alCambiarSesion(usuario) {
        this.el.lock.hidden = !!usuario;
        this.el.panel.hidden = !usuario;
        this.el.adminCard.hidden = !(usuario && usuario.rol === 'admin');
        clearInterval(this.timer);
        this.el.chk.checked = false;
        if (usuario) {
            this.cargar();
            if (usuario.rol === 'admin') this.cargarUsuarios();
        }
    },

    programarGuardado() {
        clearInterval(this.timer);
        if (!this.el.chk.checked) return;
        this.guardarAhora();
        this.timer = setInterval(() => this.guardarAhora(), 10000);
    },

    async guardarAhora() {
        const { bpm, fuente } = window.ECGApp.getState();
        try {
            await API.post('/api/mediciones', { bpm, fuente });
            this.mensaje(`Guardado: ${bpm} lpm (${fuente}).`);
            this.cargar();
        } catch (err) {
            this.mensaje(err.message, true);
            if (err.status === 401) this.el.chk.checked = false;
        }
    },

    mensaje(texto, error = false) {
        this.el.msg.textContent = texto;
        this.el.msg.classList.toggle('error', error);
    },

    async cargar() {
        try {
            const [lista, resumen] = await Promise.all([
                API.get('/api/mediciones?limite=10'),
                API.get('/api/mediciones/resumen'),
            ]);
            this.pintarFilas(lista.mediciones);
            this.pintarResumen(resumen.resumen);
        } catch (err) {
            this.mensaje(err.message, true);
        }
    },

    pintarFilas(mediciones) {
        this.el.rows.replaceChildren();
        if (!mediciones.length) {
            const tr = this.el.rows.insertRow();
            const td = tr.insertCell();
            td.colSpan = 3;
            td.textContent = 'Sin mediciones guardadas.';
            return;
        }
        for (const m of mediciones) {
            const tr = this.el.rows.insertRow();
            tr.insertCell().textContent = new Date(m.createdAt).toLocaleString();
            tr.insertCell().textContent = m.bpm;
            tr.insertCell().textContent = m.fuente;
        }
    },

    pintarResumen(resumen) {
        this.el.summary.replaceChildren();
        for (const r of resumen) {
            const p = document.createElement('p');
            p.textContent = `${r.fuente}: ${r.total} mediciones · promedio ${r.promedio} lpm (mín. ${r.minimo}, máx. ${r.maximo})`;
            this.el.summary.append(p);
        }
    },

    async borrar() {
        if (!confirm('¿Borrar todo tu historial de mediciones?')) return;
        try {
            const r = await API.del('/api/mediciones');
            this.mensaje(`Se borraron ${r.borradas} mediciones.`);
            this.cargar();
        } catch (err) {
            this.mensaje(err.message, true);
        }
    },

    async cargarUsuarios() {
        try {
            const { usuarios } = await API.get('/api/admin/usuarios');
            this.el.adminRows.replaceChildren();
            for (const u of usuarios) {
                const tr = this.el.adminRows.insertRow();
                tr.insertCell().textContent = u.nombre;
                tr.insertCell().textContent = u.email;
                tr.insertCell().textContent = u.rol;
                const celda = tr.insertCell();
                if (u.id === Auth.user.id) {
                    celda.textContent = 'Tú';
                } else {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'btn btn-small ' + (u.activo ? 'btn-disconnect' : 'btn-connect');
                    b.textContent = u.activo ? 'Desactivar' : 'Activar';
                    b.addEventListener('click', async () => {
                        await API.patch(`/api/admin/usuarios/${u.id}`, { activo: !u.activo });
                        this.cargarUsuarios();
                    });
                    celda.append(b);
                }
            }
        } catch (err) {
            this.mensaje(err.message, true);
        }
    },
};

document.addEventListener('DOMContentLoaded', () => History.init());
