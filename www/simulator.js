const maxSize = 600;
const offPixelBrightness = 30;
const gifWorkers = 4;
const gifQuality = 0; // Lower is better

class GifRecorder {
	constructor() {
		this.btnRecord = document.getElementById('record');

		const self = this;
		this.btnRecord.onclick = function () {
			if (self.active) {
				self.stop();
			} else {
				self.start();
			}
		};

		this.progressText = document.getElementById('progress');

		this.frames = [];
		this.active = false;
	}

	addFrame(canvas) {
		if (!this.active) {
			return;
		}

		const timestamp = new Date().getTime();

		// Clone canvas
		const newCanvas = document.createElement('canvas');
		const context = newCanvas.getContext('2d');
		newCanvas.width = canvas.width;
		newCanvas.height = canvas.height;
		context.drawImage(canvas, 0, 0);
		this.frames.push({
			timestamp: timestamp,
			canvas: newCanvas
		});
	}

	start() {
		this.active = true;
		this.progressText.innerText = 'Recording';
		this.btnRecord.innerText = 'Stop';
	}

	stop() {
		this.btnRecord.disabled = true;
		this.active = false;
		this.btnRecord.innerText = 'Record';
		this.generateGif();
	}

	clear() {
		this.frames = [];
	}

	generateGif() {
		if (this.frames.length === 0) {
			this.progressText.innerText = 'No frames';
			this.btnRecord.disabled = false;
			return;
		}

		const gif = new GIF({
			workers: gifWorkers,
			quality: gifQuality
		});
		const self = this;
		gif.on('start', function () {
			self.progressText.innerText = 'Starting';
		});
		gif.on('progress', function (progress) {
			self.progressText.innerText = Math.round(100 * progress) + '%';
		});
		gif.on('abort', function () {
			self.progressText.innerText = 'Aborted';
			self.btnRecord.disabled = false;
		});
		gif.on('finished', function (blob) {
			self.progressText.innerText = 'Finished';
			const img = document.createElement('img');
			img.src = URL.createObjectURL(blob);
			img.classList.add('gif');
			document.getElementById('results').appendChild(img);
			self.clear();
			self.btnRecord.disabled = false;
		});

		let delay = 1000;
		for (let i = 0; i < this.frames.length; i++) {
			if (i + 1 < this.frames.length) {
				delay = this.frames[i + 1].timestamp - this.frames[i].timestamp;
			}
			gif.addFrame(this.frames[i].canvas, {delay: delay, copy: true});
		}

		gif.render();
	}
}

class StripRenderer {
	constructor() {
		this.canvas = document.getElementById('animation');
		this.ctx = this.canvas.getContext('2d');
		this.image = new Image();

		const self = this;
		this.image.onload = function () {
			self.tintCanvas = document.createElement('canvas');
			self.tintCanvas.width = self.image.width;
			self.tintCanvas.height = self.image.height;
			self.tintCtx = self.tintCanvas.getContext('2d');

			self.resizeCanvas();
		};
		this.image.src = 'pixel.png';

		this.renderCallbacks = [];
		this.pixels = undefined;
		this.map = undefined;
		this.scaling = 1;
		this.xOffset = 0;
		this.yOffset = 0;
	}

	resizeCanvas() {
		if (!this.map || this.map.length === 0 || !this.tintCtx) {
			return;
		}

		let xMin = this.map[0][0];
		let xMax = xMin;
		let yMin = this.map[0][1];
		let yMax = yMin;
		for (let i = 1; i < this.map.length; i++) {
			const v = this.map[i];
			if (v[0] < xMin) xMin = v[0];
			if (v[0] > xMax) xMax = v[0];
			if (v[1] < yMin) yMin = v[1];
			if (v[1] > yMax) yMax = v[1];
		}

		const maxWidth = maxSize - this.image.width;
		const maxHeight = maxSize - this.image.height;
		const xDiff = xMax - xMin;
		const yDiff = yMax - yMin;
		if (xDiff > yDiff) {
			this.scaling = maxWidth / xDiff;
			this.canvas.width = maxSize;
			this.canvas.height = Math.round(yDiff * this.scaling) + this.image.height;
		} else {
			this.scaling = maxHeight / yDiff;
			this.canvas.width = Math.round(xDiff * this.scaling) + this.image.width;
			this.canvas.height = maxSize;
		}
		this.xOffset = -xMin;
		this.yOffset = -yMin;
	}

	render() {
		if (!this.map || !this.pixels) {
			return;
		}

		// this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		this.ctx.globalCompositeOperation = 'source-over';
		this.ctx.fillStyle = 'black';
		this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
		this.ctx.globalCompositeOperation = 'lighten';

		const l = Math.min(this.pixels.length, this.pixels.length);

		for (let i = 0; i < l; i++) {
			let pixel = this.pixels[i];

			// Make off-pixels visible
			pixel = [
				offPixelBrightness + Math.round((255.0 - offPixelBrightness) * pixel[0] / 255.0),
				offPixelBrightness + Math.round((255.0 - offPixelBrightness) * pixel[1] / 255.0),
				offPixelBrightness + Math.round((255.0 - offPixelBrightness) * pixel[2] / 255.0)
			];

			this.tintCtx.clearRect(0, 0, this.image.width, this.image.height);

			this.tintCtx.globalCompositeOperation = 'source-over';
			this.tintCtx.drawImage(this.image, 0, 0);

			this.tintCtx.globalCompositeOperation = 'source-in';
			this.tintCtx.fillStyle = 'rgb(' + pixel[0] + ', ' + pixel[1] + ', ' + pixel[2] + ')';
			this.tintCtx.fillRect(0, 0, this.image.width, this.image.height);

			this.ctx.drawImage(
				this.tintCanvas,
				(this.map[i][0] + this.xOffset) * this.scaling,
				this.canvas.height - (this.map[i][1] + this.yOffset) * this.scaling - this.image.height
			);
		}

		for (let i = 0; i < this.renderCallbacks.length; i++) {
			this.renderCallbacks[i](this.canvas);
		}
	}

	loop() {
		window.requestAnimationFrame(this.loop.bind(this));
		this.render();
	}

	addRenderCallback(callback) {
		this.renderCallbacks.push(callback);
	}

	setPixels(pixels) {
		this.pixels = pixels;
	}

	setMap(map) {
		this.map = map;
		this.resizeCanvas();
	}

	start() {
		window.requestAnimationFrame(this.loop.bind(this));
	}
}

class StatusReporter {
	constructor() {
		this.live = document.getElementById('live');
	}

	setData(data) {
		this.live.innerText =
			'Client: ' + (data.last_client ? data.last_client[0] + ':' + data.last_client[1] : '-') +
			', Updates: ' + data.data_updates;
	}
}

class DataProvider {
	constructor() {
		this.mapCallbacks = [];
		this.pixelDataCallbacks = [];
	}

	acquirePixelData() {
		const self = this;
		const xhr = new XMLHttpRequest();
		xhr.open('GET', '/data');
		xhr.onload = function () {
			if (xhr.status === 200) {
				try {
					const data = JSON.parse(xhr.responseText);

					for (let i = 0; i < self.pixelDataCallbacks.length; i++) {
						self.pixelDataCallbacks[i](data);
					}
				} catch (e) {
					console.log('Error parsing JSON data: ' + e)
				}
			} else {
				console.log('data request failed :(');
			}
		};
		xhr.send();
	}

	acquireMap() {
		const self = this;
		const xhr = new XMLHttpRequest();
		xhr.open('GET', '/map');
		xhr.onload = function () {
			if (xhr.status === 200) {
				try {
					const map = JSON.parse(xhr.responseText).map;

					for (let i = 0; i < self.mapCallbacks.length; i++) {
						self.mapCallbacks[i](map);
					}

					setInterval(self.acquirePixelData.bind(self), 1000 / 60);
				} catch (e) {
					console.log('Error parsing JSON data: ' + e);
				}
			} else {
				console.log('height map request failed :(');
			}
		};
		xhr.send();
	}

	addPixelDataCallback(callback) {
		this.pixelDataCallbacks.push(callback);
	}

	addMapCallback(callback) {
		this.mapCallbacks.push(callback);
	}

	start() {
		this.acquireMap();
	}
}

(function init() {
	const stripRenderer = new StripRenderer();
	const gifRecorder = new GifRecorder();
	const statusReporter = new StatusReporter();
	const dataProvider = new DataProvider();

	stripRenderer.addRenderCallback(gifRecorder.addFrame.bind(gifRecorder));
	dataProvider.addMapCallback(stripRenderer.setMap.bind(stripRenderer));
	dataProvider.addPixelDataCallback(function (data) {
		stripRenderer.setPixels(data.pixels);
		statusReporter.setData(data);
	});

	dataProvider.start();
	stripRenderer.start();
})();