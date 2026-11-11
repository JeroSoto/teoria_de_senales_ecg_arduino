// Detalles de la interfaz que no tienen que ver con la señal:
//  - relleno de color de los deslizadores (CSS lee la variable --p)
//  - pestaña activa de la barra inferior en celulares
document.addEventListener('DOMContentLoaded', () => {
    const rellenar = (input) => {
        const min = Number(input.min || 0);
        const max = Number(input.max || 100);
        input.style.setProperty('--p', `${((Number(input.value) - min) / (max - min)) * 100}%`);
    };
    for (const r of document.querySelectorAll('input[type="range"]')) {
        rellenar(r);
        r.addEventListener('input', () => rellenar(r));
    }

    const enlaces = [...document.querySelectorAll('.tabbar a')]
        .map((a) => ({ a, destino: document.getElementById(a.dataset.target) }))
        .filter((x) => x.destino);
    if (!enlaces.length) return;

    // Activa la última sección cuyo inicio ya pasó el 35 % superior de la pantalla
    const marcar = () => {
        const linea = window.innerHeight * 0.35;
        let activa = enlaces[0];
        for (const x of enlaces) if (x.destino.getBoundingClientRect().top <= linea) activa = x;
        for (const x of enlaces) x.a.classList.toggle('active', x === activa);
    };
    let pendiente = false;
    window.addEventListener('scroll', () => {
        if (pendiente) return;
        pendiente = true;
        requestAnimationFrame(() => { pendiente = false; marcar(); });
    }, { passive: true });
    window.addEventListener('resize', marcar);
    marcar();
});
