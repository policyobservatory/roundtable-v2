export type AudioSource = 'microphone' | 'tab';

export function stopMediaStream(stream: MediaStream) {
	for (const track of stream.getTracks()) track.stop();
}

/** Call directly from the user's click handler so the tab picker has user activation. */
export async function acquireAudio(source: AudioSource): Promise<MediaStream> {
	const devices = navigator.mediaDevices;
	if (!devices || typeof MediaRecorder === 'undefined') {
		throw new Error('Audio recording is unavailable. Use a supported browser over HTTPS.');
	}
	let stream: MediaStream;
	try {
		if (source === 'tab') {
			if (!devices.getDisplayMedia) {
				throw new Error('Tab audio sharing is unavailable in this browser. Try desktop Chrome or Edge.');
			}
			// Browsers require video for display capture. Only audio is passed to the recorder.
			stream = await devices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: true });
		} else {
			stream = await devices.getUserMedia({ audio: true });
		}
	} catch (err) {
		if (err instanceof DOMException && err.name === 'NotAllowedError') {
			throw new Error(source === 'tab'
				? 'Tab sharing was cancelled or denied. Choose a browser tab and enable “Share tab audio”.'
				: 'Microphone permission was denied. Allow access and try again.');
		}
		throw err;
	}
	if (!stream.getAudioTracks().some((track) => track.readyState === 'live')) {
		stopMediaStream(stream);
		throw new Error(source === 'tab'
			? 'No tab audio was shared. Choose a browser tab and enable “Share tab audio”, then try again.'
			: 'No microphone audio is available. Check your microphone and try again.');
	}
	return stream;
}

export interface AudioRecording {
	stop: () => Promise<void>;
	dispose: () => void;
}

/** Independent recordings give every STT chunk its own decodable container header. */
export function recordAudio(
	stream: MediaStream,
	onChunk: (audio: Blob) => Promise<void>,
	onError: (error: Error) => void,
	onEnded: () => void,
	chunkMilliseconds = 5000
): AudioRecording {
	const audioStream = new MediaStream(stream.getAudioTracks());
	const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
		.find((type) => MediaRecorder.isTypeSupported(type));
	let recorder: MediaRecorder;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let finishing = false;
	let disposed = false;
	let queue: Promise<void> = Promise.resolve();
	let failure: Error | undefined;
	let finished: Promise<void>;
	let stopPromise: Promise<void> | undefined;

	function fail(err: unknown) {
		const error = err instanceof Error ? err : new Error(String(err));
		failure ??= error;
		if (!disposed) onError(error);
	}

	function nextChunk() {
		const chunks: Blob[] = [];
		recorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : undefined);
		const current = recorder;
		finished = new Promise<void>((resolve) => {
			current.ondataavailable = (event) => {
				if (event.data.size) chunks.push(event.data);
			};
			current.onerror = () => {
				fail(new Error('Audio recording failed. Please start a new recording.'));
				if (!finishing && !disposed) onEnded();
			};
			current.onstop = () => {
				clearTimeout(timer);
				const blob = new Blob(chunks, { type: current.mimeType || chunks[0]?.type || 'audio/webm' });
				if (!disposed && blob.size) {
					// Serialize transcription + persistence to preserve transcript order.
					queue = queue.then(async () => { if (!disposed) await onChunk(blob); }).catch(fail);
				}
				resolve();
				if (!finishing && !disposed) {
					try { nextChunk(); } catch (err) { fail(err); onEnded(); }
				}
			};
		});
		try {
			current.start();
		} catch (err) {
			finished = Promise.resolve();
			throw err;
		}
		timer = setTimeout(() => {
			if (current.state !== 'inactive') current.stop();
		}, chunkMilliseconds);
	}

	function ended() {
		if (!finishing && !disposed) onEnded();
	}
	function release() {
		clearTimeout(timer);
		for (const track of stream.getTracks()) track.removeEventListener('ended', ended);
		stopMediaStream(stream);
	}

	try {
		nextChunk();
		for (const track of stream.getTracks()) track.addEventListener('ended', ended);
	} catch (err) {
		release();
		throw err;
	}

	return {
		stop() {
			if (stopPromise) return stopPromise;
			finishing = true;
			clearTimeout(timer);
			if (recorder.state !== 'inactive') recorder.stop();
			release();
			stopPromise = (async () => {
				await finished;
				await queue;
				if (failure) throw failure;
			})();
			return stopPromise;
		},
		dispose() {
			disposed = true;
			finishing = true;
			if (recorder.state !== 'inactive') recorder.stop();
			release();
		}
	};
}
