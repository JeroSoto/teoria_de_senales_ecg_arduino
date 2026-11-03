class ECGRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        this.buffer = new Array(this.canvas.width).fill(0);
        this.currentIndex = 0;
    }

    addSample(sampleValue) {
        this.buffer[this.currentIndex] = sampleValue;
        this.currentIndex = (this.currentIndex + 1) % this.canvas.width;
    }

    render() {
        const width = this.canvas.width;
        const height = this.canvas.height;
        const centerY = height / 2;
        const scaleY = 60;

        this.ctx.fillStyle = '#050811';
        this.ctx.fillRect(0, 0, width, height);

        this.drawGrid(width, height);

        this.ctx.beginPath();
        this.ctx.lineWidth = 2;
        this.ctx.strokeStyle = '#00ff88';
        this.ctx.shadowBlur = 4;
        this.ctx.shadowColor = '#00ff88';

        for (let x = 0; x < width; x++) {
            const y = centerY - (this.buffer[x] * scaleY);

            if (x === 0) {
                this.ctx.moveTo(x, y);
            } else {
                if (Math.abs(x - this.currentIndex) < 8) {
                    this.ctx.moveTo(x, y);
                } else {
                    this.ctx.lineTo(x, y);
                }
            }
        }
        this.ctx.stroke();
        this.ctx.shadowBlur = 0;

        this.ctx.fillStyle = '#00e5ff';
        this.ctx.fillRect(this.currentIndex, 0, 2, height);
    }

    drawGrid(width, height) {
        const smallGrid = 10;
        const largeGrid = 50;

        this.ctx.beginPath();
        this.ctx.lineWidth = 0.5;
        this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.05)';

        for (let x = 0; x < width; x += smallGrid) {
            this.ctx.moveTo(x, 0); this.ctx.lineTo(x, height);
        }
        for (let y = 0; y < height; y += smallGrid) {
            this.ctx.moveTo(0, y); this.ctx.lineTo(width, y);
        }
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.lineWidth = 1;
        this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.15)';

        for (let x = 0; x < width; x += largeGrid) {
            this.ctx.moveTo(x, 0); this.ctx.lineTo(x, height);
        }
        for (let y = 0; y < height; y += largeGrid) {
            this.ctx.moveTo(0, y); this.ctx.lineTo(width, y);
        }
        this.ctx.stroke();
    }
}
