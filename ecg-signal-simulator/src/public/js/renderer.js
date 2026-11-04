class ECGRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        this.buffer = new Array(this.canvas.width).fill(0);
        this.currentIndex = 0;
        this.gridCanvas = document.createElement('canvas');
        this.gridCanvas.width = this.canvas.width;
        this.gridCanvas.height = this.canvas.height;
        this.gridCtx = this.gridCanvas.getContext('2d');
        this.gridCtx.fillStyle = '#050811';
        this.gridCtx.fillRect(0, 0, this.gridCanvas.width, this.gridCanvas.height);
        this.drawGrid(this.gridCanvas.width, this.gridCanvas.height, this.gridCtx);
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

        this.ctx.drawImage(this.gridCanvas, 0, 0);

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

    drawGrid(width, height, ctx = this.ctx) {
        const smallGrid = 10;
        const largeGrid = 50;

        ctx.beginPath();
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.05)';

        for (let x = 0; x < width; x += smallGrid) {
            ctx.moveTo(x, 0); ctx.lineTo(x, height);
        }
        for (let y = 0; y < height; y += smallGrid) {
            ctx.moveTo(0, y); ctx.lineTo(width, y);
        }
        ctx.stroke();

        ctx.beginPath();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.15)';

        for (let x = 0; x < width; x += largeGrid) {
            ctx.moveTo(x, 0); ctx.lineTo(x, height);
        }
        for (let y = 0; y < height; y += largeGrid) {
            ctx.moveTo(0, y); ctx.lineTo(width, y);
        }
        ctx.stroke();
    }
}
