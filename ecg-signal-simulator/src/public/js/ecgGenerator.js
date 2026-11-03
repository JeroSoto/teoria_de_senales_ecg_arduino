class ECGGenerator {
    constructor(sampleRate = 250) {
        this.fs = sampleRate;
        this.bpm = 75;
        this.amplitude = 1.0;
        this.noiseLevel = 10;
        this.enableHum = false;
        this.enableWander = false;
        this.t = 0;
    }

    nextSample() {
        const dt = 1 / this.fs;
        this.t += dt;

        const Tbeat = 60 / this.bpm;
        const phase = (this.t % Tbeat) / Tbeat;

        let ecgClean = this.gaussianWave(phase) * this.amplitude;
        let noise = 0;

        if (this.noiseLevel > 0) {
            const gaussianStd = (this.noiseLevel / 100) * 0.25;
            noise += this.randomGaussian() * gaussianStd;
        }

        if (this.enableHum) {
            noise += 0.15 * Math.sin(2 * Math.PI * 60 * this.t);
        }

        if (this.enableWander) {
            noise += 0.3 * Math.sin(2 * Math.PI * 0.15 * this.t);
        }

        return ecgClean + noise;
    }

    gaussianWave(phase) {
        const waves = {
            P: [0.12, 0.15, 0.025],
            Q: [-0.15, 0.32, 0.010],
            R: [1.20, 0.35, 0.012],
            S: [-0.25, 0.38, 0.012],
            T: [0.25, 0.65, 0.045]
        };

        let val = 0;
        for (const key in waves) {
            const [a, center, sigma] = waves[key];
            const diff = phase - center;
            val += a * Math.exp(-(diff * diff) / (2 * sigma * sigma));
        }

        return val;
    }

    randomGaussian() {
        let u1 = Math.random();
        let u2 = Math.random();
        while (u1 === 0) u1 = Math.random();
        return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    }
}
