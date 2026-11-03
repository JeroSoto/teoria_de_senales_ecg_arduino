class SignalProcessor {
    constructor(sampleRate = 250) {
        this.fs = sampleRate;

        this.hpEnabled = false;
        this.hpXPrev = 0;
        this.hpYPrev = 0;

        this.lpEnabled = false;
        this.lpYPrev = 0;

        this.notchEnabled = false;
        this.nBuffer = [0, 0];
        this.nYBuffer = [0, 0];

        this.rPeakBuffer = [];
        this.lastPeakTime = 0;
        this.detectedBPM = 75;
        this.lastSamplePrev = 0;
    }

    processSample(sample, currentTime) {
        let output = sample;

        if (this.hpEnabled) {
            const fc = 0.5;
            const rc = 1.0 / (2 * Math.PI * fc);
            const dt = 1.0 / this.fs;
            const alpha = rc / (rc + dt);

            const y = alpha * (this.hpYPrev + output - this.hpXPrev);
            this.hpXPrev = output;
            this.hpYPrev = y;
            output = y;
        }

        if (this.lpEnabled) {
            const fc = 40;
            const dt = 1.0 / this.fs;
            const alpha = (2 * Math.PI * dt * fc) / (2 * Math.PI * dt * fc + 1);

            const y = this.lpYPrev + alpha * (output - this.lpYPrev);
            this.lpYPrev = y;
            output = y;
        }

        if (this.notchEnabled) {
            output = this.applyNotch60Hz(output);
        }

        this.detectRPeak(output, currentTime);

        return output;
    }

    applyNotch60Hz(x) {
        const w0 = 2 * Math.PI * 60 / this.fs;
        const r = 0.95;
        const b0 = 1, b1 = -2 * Math.cos(w0), b2 = 1;
        const a1 = -2 * r * Math.cos(w0), a2 = r * r;

        const y = b0 * x + b1 * this.nBuffer[0] + b2 * this.nBuffer[1]
                       - a1 * this.nYBuffer[0] - a2 * this.nYBuffer[1];

        this.nBuffer[1] = this.nBuffer[0];
        this.nBuffer[0] = x;
        this.nYBuffer[1] = this.nYBuffer[0];
        this.nYBuffer[0] = y;

        return y;
    }

    detectRPeak(sample, currentTime) {
        const derivative = sample - this.lastSamplePrev;
        this.lastSamplePrev = sample;

        const squared = derivative * derivative;

        const threshold = 0.15;
        const minRRInterval = 0.35;

        if (squared > threshold && (currentTime - this.lastPeakTime) > minRRInterval) {
            if (this.lastPeakTime > 0) {
                const rrInterval = currentTime - this.lastPeakTime;
                const instantBPM = Math.round(60 / rrInterval);

                if (instantBPM >= 30 && instantBPM <= 220) {
                    this.rPeakBuffer.push(instantBPM);
                    if (this.rPeakBuffer.length > 5) this.rPeakBuffer.shift();

                    const sum = this.rPeakBuffer.reduce((a, b) => a + b, 0);
                    this.detectedBPM = Math.round(sum / this.rPeakBuffer.length);
                }
            }
            this.lastPeakTime = currentTime;
        }
    }
}
