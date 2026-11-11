// ============================================================
// Monitor de ECG en canvas.
//  - Dos modos: "desplazamiento" (la señal corre de derecha a izquierda, como el Waveform Chart
//    de LabVIEW o el Serial Plotter) y "barrido" (como un electrocardiógrafo de hospital).
//  - Ventana de tiempo elegible (p. ej. 5, 10 o 20 s): más segundos = señal más lenta y extensa.
//  - Amplitud automática (ajusta la escala a la señal) o fija.
//  - Se adapta al tamaño de la pantalla y a la densidad de píxeles (nítido en celulares).
//  - Cuadrícula de papel de ECG: cuadro grande = 0.2 s × 0.5 mV, pequeño = 0.04 s × 0.1 mV.
// ============================================================
class ECGRenderer {
    constructor(canvasId, { fs = 250, ventana = 10, modo = 'desplazamiento', escala = 'auto' } = {}) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        this.grid = document.createElement('canvas');
        this.fs = fs;
        this.dpr = 1;
        this.windowSec = ventana;
        this.modo = modo;
        this.escala = escala;            // 'auto' o un factor (1 = ±2 mV visibles)
        this.mvVisibles = 4.2;           // alto del monitor en mV (cambia con la escala)
        this.centroMv = 0;               // valor (mV) que queda a la altura de la línea base
        this.ultimoAjuste = 0;
        this.buffer = new Float32Array(2).fill(NaN);
        this.index = 0;
        this.llenas = 0;                 // muestras válidas en el búfer (para el modo desplazamiento)
        this.colores = {
            fondo: '#050a14',
            menor: 'rgba(125, 220, 255, 0.07)',
            mayor: 'rgba(125, 220, 255, 0.17)',
            base: 'rgba(125, 220, 255, 0.28)',
            texto: 'rgba(190, 215, 240, 0.6)',
            brillo: 'rgba(94, 242, 194, 0.20)',
            trazo: '#5ef2c2',
            cabeza: '#c9fff0',
        };

        this.reservar();
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
        this.dibujarCuadricula();
        this.render();
    }

    // ---------- Configuración elegida por el usuario ----------
    setVentana(segundos) {
        if (segundos === this.windowSec) return;
        const anteriores = this.ordenadas();          // conserva la señal ya dibujada
        this.windowSec = segundos;
        this.reservar();
        for (const v of anteriores.slice(-this.buffer.length)) this.addSample(v);
        this.dibujarCuadricula();
        this.render();
    }

    setModo(modo) {
        this.modo = modo;
        this.render();
    }

    setEscala(escala) {
        this.escala = escala;
        if (escala !== 'auto') { this.mvVisibles = 4.2 / escala; this.centroMv = 0; }
        this.ultimoAjuste = 0;
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
        this.llenas = 0;
    }

    clear() {
        this.buffer.fill(NaN);
        this.index = 0;
        this.llenas = 0;
    }

    addSample(valor) {
        this.buffer[this.index] = valor;
        this.index = (this.index + 1) % this.buffer.length;
        if (this.llenas < this.buffer.length) this.llenas++;
    }

    /** Muestras en orden cronológico (la más antigua primero). */
    ordenadas() {
        const n = this.buffer.length;
        const out = [];
        for (let k = 0; k < this.llenas; k++) out.push(this.buffer[(this.index - this.llenas + k + n) % n]);
        return out.filter(Number.isFinite);
    }

    get pxPorMv() { return this.canvas.height / this.mvVisibles; }
    get lineaBase() { return this.canvas.height * (this.escala === 'auto' ? 0.5 : 0.56); }

    /** Amplitud automática: la señal ocupa ~75 % del alto (se recalcula 2 veces por segundo, suavizado). */
    ajustarEscala() {
        if (this.escala !== 'auto') return;
        const ahora = performance.now();
        if (ahora - this.ultimoAjuste < 500) return;
        this.ultimoAjuste = ahora;
        const v = this.ordenadas();
        if (v.length < this.fs) return;
        const orden = Float32Array.from(v).sort();
        const lo = orden[Math.floor(0.005 * (orden.length - 1))];   // percentiles: un pico suelto no la aplasta
        const hi = orden[Math.ceil(0.995 * (orden.length - 1))];
        const rango = Math.max(0.4, hi - lo);                        // mínimo 0.4 mV: el ruido no se amplifica de más
        const objetivo = rango / 0.75;
        const centro = (hi + lo) / 2;
        const primera = this.mvVisibles === 4.2 && this.centroMv === 0;
        this.mvVisibles = primera ? objetivo : this.mvVisibles + 0.35 * (objetivo - this.mvVisibles);
        this.centroMv = primera ? centro : this.centroMv + 0.35 * (centro - this.centroMv);
        this.dibujarCuadricula();
    }

    dibujarCuadricula() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        if (!w || !h) return;
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

        // Cuadros pequeños solo si se distinguen (≥ 4 px CSS); los grandes siempre
        if (pxSeg * 0.04 >= 4 * this.dpr && pxMv * 0.1 >= 4 * this.dpr) lineas({ x: pxSeg * 0.04, y: pxMv * 0.1 }, this.colores.menor, 1);
        const pasoMv = pxMv * 0.5 >= 8 * this.dpr ? 0.5 : pxMv * 1 >= 8 * this.dpr ? 1 : 2;
        lineas({ x: pxSeg * (pxSeg * 0.2 >= 6 * this.dpr ? 0.2 : 1), y: pxMv * pasoMv }, this.colores.mayor, 1);

        // marcas de segundos (ayudan a contar latidos: BPM = latidos en 10 s × 6)
        c.fillStyle = this.colores.texto;
        c.font = `${10 * this.dpr}px ui-monospace, Consolas, monospace`;
        c.textBaseline = 'top';
        const pasoEtiqueta = this.windowSec > 12 ? 2 : 1;
        for (let s = pasoEtiqueta; s < this.windowSec; s += pasoEtiqueta) {
            const x = this.modo === 'desplazamiento' ? w - s * pxSeg : s * pxSeg;
            c.fillText(this.modo === 'desplazamiento' ? `-${s}s` : `${s}s`, x + 3 * this.dpr, 4 * this.dpr);
        }

        c.beginPath();
        c.strokeStyle = this.colores.base;
        c.setLineDash([4 * this.dpr, 6 * this.dpr]);
        c.moveTo(0, Math.round(base) + 0.5);
        c.lineTo(w, Math.round(base) + 0.5);
        c.stroke();
        c.setLineDash([]);

        c.textBaseline = 'bottom';
        c.font = `${11 * this.dpr}px ui-monospace, Consolas, monospace`;
        const escala = this.escala === 'auto' ? 'auto' : `×${this.escala}`;
        c.fillText(`${this.windowSec} s · ${pxSeg * 0.2 >= 6 * this.dpr ? '0.2 s' : '1 s'} × ${pasoMv} mV · amplitud ${escala}`, 8 * this.dpr, h - 6 * this.dpr);
    }

    /** y en píxeles para un valor en mV (recortado al alto del monitor). */
    yDe(v) {
        const y = this.lineaBase - (v - this.centroMv) * this.pxPorMv;
        return Math.min(this.canvas.height - 1, Math.max(1, y));
    }

    render() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const n = this.buffer.length;
        if (!w || n < 3) return;
        this.ajustarEscala();
        ctx.drawImage(this.grid, 0, 0);

        const dx = w / (n - 1);
        // Posición en pantalla de cada muestra del búfer circular
        //  desplazamiento: la más nueva en el borde derecho y la señal corre hacia la izquierda
        //  barrido: posición fija; delante del cursor queda un hueco
        const desplazar = this.modo === 'desplazamiento';
        const hueco = desplazar ? 0 : Math.max(3, Math.round(n * 0.02));
        const muestrasPorPx = n / w;

        ctx.beginPath();
        if (muestrasPorPx > 2) {
            // Muchas muestras por píxel (ventanas largas): se dibuja el mínimo y el máximo de cada columna,
            // así no se pierde ningún pico R y el dibujo sigue siendo rápido.
            const columnas = Math.ceil(w);
            let trazando = false;
            for (let col = 0; col < columnas; col++) {
                const k0 = Math.floor(col * muestrasPorPx);
                const k1 = Math.min(n, Math.floor((col + 1) * muestrasPorPx));
                let lo = Infinity, hi = -Infinity, primero = NaN;
                for (let k = k0; k < k1; k++) {
                    const i = desplazar ? (this.index + k) % n : k;
                    if (!desplazar && ((i - this.index + n) % n) < hueco) continue;
                    const v = this.buffer[i];
                    if (!Number.isFinite(v)) continue;
                    if (Number.isNaN(primero)) primero = v;
                    if (v < lo) lo = v;
                    if (v > hi) hi = v;
                }
                if (!Number.isFinite(lo)) { trazando = false; continue; }
                const x = col + 0.5;
                if (trazando) ctx.lineTo(x, this.yDe(primero)); else { ctx.moveTo(x, this.yDe(primero)); trazando = true; }
                ctx.lineTo(x, this.yDe(hi));
                ctx.lineTo(x, this.yDe(lo));
            }
        } else {
            let trazando = false;
            for (let k = 0; k < n; k++) {
                const i = desplazar ? (this.index + k) % n : k;
                const v = this.buffer[i];
                if ((!desplazar && ((i - this.index + n) % n) < hueco) || !Number.isFinite(v)) { trazando = false; continue; }
                const x = k * dx;
                const y = this.yDe(v);
                if (trazando) ctx.lineTo(x, y);
                else { ctx.moveTo(x, y); trazando = true; }
            }
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

        // Cabeza del trazo: la muestra más reciente
        const ultimo = (this.index - 1 + n) % n;
        const v = this.buffer[ultimo];
        if (Number.isFinite(v)) {
            const x = desplazar ? w - 1 : ultimo * dx;
            const y = this.yDe(v);
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
