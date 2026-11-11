// ============================================================
// Monitor de ECG en canvas: barrido como en un electrocardiógrafo.
//  - Se adapta al tamaño de la pantalla y a la densidad de píxeles (nítido en celulares).
//  - Cuadrícula de papel de ECG: cuadro grande = 0.2 s × 0.5 mV, pequeño = 0.04 s × 0.1 mV.
//  - El búfer guarda muestras (no píxeles), así la escala de tiempo es real a cualquier ancho.
// ============================================================
class ECGRenderer {
    constructor(canvasId, { fs = 250 } = {}) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        this.grid = document.createElement('canvas');
        this.fs = fs;
        this.dpr = 1;
        this.windowSec = 5;
        this.buffer = new Float32Array(2).fill(NaN);
        this.index = 0;
        this.colores = {
            fondo: '#050a14',
            menor: 'rgba(125, 220, 255, 0.07)',
            mayor: 'rgba(125, 220, 255, 0.17)',
            base: 'rgba(125, 220, 255, 0.28)',
            texto: 'rgba(190, 215, 240, 0.55)',
            brillo: 'rgba(94, 242, 194, 0.20)',
            trazo: '#5ef2c2',
            cabeza: '#c9fff0',
        };

        this.resize();
        if ('ResizeObserver' in window) {
            new ResizeObserver(() => this.resize()).observe(this.canvas);
        } else {
            window.addEventListener('resize', () => this.resize());
        }
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        // Más de 2× no se nota a simple vista y cuesta batería en celulares
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.round(rect.width * dpr);
        const h = Math.round(rect.height * dpr);
        if (w === this.canvas.width && h === this.canvas.height) return;

        this.canvas.width = w;
        this.canvas.height = h;
        this.dpr = dpr;
        // ≈ 170 px por segundo de señal: 2.5 s en un celular, hasta 6 s en pantallas anchas
        const ventana = Math.min(6, Math.max(2.5, rect.width / 170));
        if (Math.abs(ventana - this.windowSec) > 0.05 || this.buffer.length < 3) {
            this.windowSec = ventana;
            this.reservar();
        }
        this.dibujarCuadricula();
        this.render();
    }

    /** Cambia la frecuencia de muestreo (p. ej. el Arduino pasa a 500 Hz) y vacía el trazo. */
    setSampleRate(fs) {
        if (fs && fs !== this.fs) {
            this.fs = fs;
            this.reservar();
        }
    }

    reservar() {
        this.buffer = new Float32Array(Math.max(3, Math.round(this.fs * this.windowSec))).fill(NaN);
        this.index = 0;
    }

    clear() {
        this.buffer.fill(NaN);
        this.index = 0;
    }

    addSample(valor) {
        this.buffer[this.index] = valor;
        this.index = (this.index + 1) % this.buffer.length;
    }

    get pxPorMv() { return this.canvas.height / 4.2; }        // ±2 mV visibles
    get lineaBase() { return this.canvas.height * 0.56; }      // el QRS es sobre todo positivo

    dibujarCuadricula() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        this.grid.width = w;
        this.grid.height = h;
        const c = this.grid.getContext('2d');
        c.fillStyle = this.colores.fondo;
        c.fillRect(0, 0, w, h);

        const pxSeg = w / this.windowSec;
        const pxMv = this.pxPorMv;
        const base = this.lineaBase;

        const lineas = (paso, color, ancho) => {
            c.beginPath();
            c.strokeStyle = color;
            c.lineWidth = ancho;
            for (let x = 0; x <= w; x += paso.x) { const px = Math.round(x) + 0.5; c.moveTo(px, 0); c.lineTo(px, h); }
            for (let y = base; y <= h; y += paso.y) { const py = Math.round(y) + 0.5; c.moveTo(0, py); c.lineTo(w, py); }
            for (let y = base - paso.y; y >= 0; y -= paso.y) { const py = Math.round(y) + 0.5; c.moveTo(0, py); c.lineTo(w, py); }
            c.stroke();
        };

        // Cuadros pequeños solo si se distinguen (≥ 4 px CSS)
        if (pxSeg * 0.04 >= 4 * this.dpr) lineas({ x: pxSeg * 0.04, y: pxMv * 0.1 }, this.colores.menor, 1);
        lineas({ x: pxSeg * 0.2, y: pxMv * 0.5 }, this.colores.mayor, 1);

        c.beginPath();
        c.strokeStyle = this.colores.base;
        c.setLineDash([4 * this.dpr, 6 * this.dpr]);
        c.moveTo(0, Math.round(base) + 0.5);
        c.lineTo(w, Math.round(base) + 0.5);
        c.stroke();
        c.setLineDash([]);

        c.fillStyle = this.colores.texto;
        c.font = `${11 * this.dpr}px ui-monospace, Consolas, monospace`;
        c.textBaseline = 'bottom';
        c.fillText('0.2 s × 0.5 mV', 8 * this.dpr, h - 6 * this.dpr);
    }

    render() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const n = this.buffer.length;
        const dx = w / (n - 1);
        const base = this.lineaBase;
        const k = this.pxPorMv;
        const hueco = Math.max(3, Math.round(n * 0.02)); // espacio en blanco delante del cursor

        ctx.drawImage(this.grid, 0, 0);

        ctx.beginPath();
        let trazando = false;
        for (let i = 0; i < n; i++) {
            const v = this.buffer[i];
            const delante = (i - this.index + n) % n; // 0 = muestra más antigua, la próxima en borrarse
            if (delante < hueco || !Number.isFinite(v)) { trazando = false; continue; }
            const x = i * dx;
            const y = Math.min(h - 1, Math.max(1, base - v * k));
            if (trazando) ctx.lineTo(x, y);
            else { ctx.moveTo(x, y); trazando = true; }
        }
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        // Dos trazos (ancho y tenue + fino) dan el brillo sin usar shadowBlur, que es lento en celulares
        ctx.strokeStyle = this.colores.brillo;
        ctx.lineWidth = 5 * this.dpr;
        ctx.stroke();
        ctx.strokeStyle = this.colores.trazo;
        ctx.lineWidth = 1.7 * this.dpr;
        ctx.stroke();

        const ultimo = (this.index - 1 + n) % n;
        const v = this.buffer[ultimo];
        if (Number.isFinite(v)) {
            const x = ultimo * dx;
            const y = Math.min(h - 1, Math.max(1, base - v * k));
            ctx.fillStyle = this.colores.brillo;
            ctx.beginPath();
            ctx.arc(x, y, 6 * this.dpr, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = this.colores.cabeza;
            ctx.beginPath();
            ctx.arc(x, y, 2.4 * this.dpr, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}
