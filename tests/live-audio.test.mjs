import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import { acquireAudio, recordAudio } from '../src/lib/live-audio.ts';

class Track extends EventTarget {
	constructor(kind) { super(); this.kind = kind; this.readyState = 'live'; }
	stop() { this.readyState = 'ended'; }
	endSharing() { this.stop(); this.dispatchEvent(new Event('ended')); }
}
class Stream {
	constructor(tracks) { this.tracks = tracks; }
	getTracks() { return this.tracks; }
	getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio'); }
}
class Recorder {
	static instances = [];
	static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
	constructor(stream, options) {
		this.stream = stream;
		this.mimeType = options?.mimeType || 'audio/webm';
		this.state = 'inactive';
		Recorder.instances.push(this);
	}
	start() { this.state = 'recording'; }
	stop() {
		assert.equal(this.state, 'recording', 'must not stop an inactive recorder');
		this.state = 'inactive';
		queueMicrotask(() => {
			this.ondataavailable?.({ data: new Blob(['chunk'], { type: this.mimeType }) });
			this.onstop?.();
		});
	}
}
const originals = new Map();
function install(name, value) {
	originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
	Object.defineProperty(globalThis, name, { configurable: true, value });
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
beforeEach(() => {
	Recorder.instances = [];
	install('MediaRecorder', Recorder);
	install('MediaStream', Stream);
	install('navigator', { mediaDevices: {} });
});
afterEach(() => {
	for (const [name, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else delete globalThis[name];
	}
	originals.clear();
});

test('tab capture requests display audio and never requests microphone access', async () => {
	const stream = new Stream([new Track('video'), new Track('audio')]);
	let calls = 0;
	navigator.mediaDevices.getDisplayMedia = async (constraints) => {
		calls++;
		assert.equal(constraints.audio, true);
		assert.equal(constraints.video.displaySurface, 'browser');
		return stream;
	};
	navigator.mediaDevices.getUserMedia = () => assert.fail('Tab capture must not use the microphone');
	assert.equal(await acquireAudio('tab'), stream);
	assert.equal(calls, 1);
});

test('missing shared audio stops all display tracks and explains the audio checkbox', async () => {
	const video = new Track('video');
	navigator.mediaDevices.getDisplayMedia = async () => new Stream([video]);
	await assert.rejects(acquireAudio('tab'), /No tab audio.*Share tab audio/);
	assert.equal(video.readyState, 'ended');
});

test('cancelled sharing and unsupported browsers produce useful errors', async () => {
	await assert.rejects(acquireAudio('tab'), /desktop Chrome or Edge/);
	navigator.mediaDevices.getDisplayMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
	await assert.rejects(acquireAudio('tab'), /cancelled or denied/);
});

test('microphone capture requests only audio', async () => {
	const stream = new Stream([new Track('audio')]);
	navigator.mediaDevices.getUserMedia = async (constraints) => {
		assert.deepEqual(constraints, { audio: true });
		return stream;
	};
	assert.equal(await acquireAudio('microphone'), stream);
});

test('recorder excludes video, reuses audio tracks, and drains chunks in order on stop', async () => {
	const audio = new Track('audio');
	const video = new Track('video');
	const stream = new Stream([audio, video]);
	let release;
	const first = new Promise((resolve) => { release = resolve; });
	const events = [];
	const capture = recordAudio(stream, async (blob) => {
		assert.equal(blob.type, 'audio/webm;codecs=opus');
		events.push('start');
		if (events.length === 1) await first;
		events.push('saved');
	}, assert.fail, assert.fail);
	try {
		assert.deepEqual(Recorder.instances[0].stream.getTracks(), [audio]);
		Recorder.instances[0].stop();
		await tick();
		assert.equal(Recorder.instances.length, 2, 'starts a fresh decodable chunk without asking for another stream');
		let finished = false;
		const stopping = capture.stop().then(() => { finished = true; });
		await tick();
		assert.equal(finished, false);
		assert.deepEqual(events, ['start']);
		assert.equal(audio.readyState, 'ended');
		assert.equal(video.readyState, 'ended');
		release();
		await stopping;
		assert.deepEqual(events, ['start', 'saved', 'start', 'saved']);
		assert.equal(Recorder.instances.length, 2, 'no new recorder after stop');
		await capture.stop();
	} finally { release(); capture.dispose(); }
});

test('browser Stop sharing triggers completion once and releases all tracks', async () => {
	const video = new Track('video');
	const audio = new Track('audio');
	let ended = 0;
	let stopping;
	const capture = recordAudio(new Stream([video, audio]), async () => {}, assert.fail, () => {
		ended++;
		stopping = capture.stop();
	});
	video.endSharing();
	await stopping;
	audio.endSharing();
	assert.equal(ended, 1);
	assert.equal(audio.readyState, 'ended');
});

test('disposing on navigation discards the final chunk and releases capture', async () => {
	const video = new Track('video');
	const audio = new Track('audio');
	const capture = recordAudio(new Stream([video, audio]), async () => assert.fail('Must not upload after navigation'), assert.fail, assert.fail);
	capture.dispose();
	await tick();
	assert.equal(video.readyState, 'ended');
	assert.equal(audio.readyState, 'ended');
	assert.equal(Recorder.instances.length, 1);
});

test('transcription failures are reported and prevent silently analyzing an incomplete transcript', async () => {
	const errors = [];
	const capture = recordAudio(new Stream([new Track('audio')]), async () => { throw new Error('STT unavailable'); }, (err) => errors.push(err.message), assert.fail);
	await assert.rejects(capture.stop(), /STT unavailable/);
	assert.deepEqual(errors, ['STT unavailable']);
});

test('recorder setup failure still releases the shared stream', () => {
	const audio = new Track('audio');
	const video = new Track('video');
	const original = Recorder.prototype.start;
	Recorder.prototype.start = () => { throw new Error('Unsupported recording format'); };
	try {
		assert.throws(() => recordAudio(new Stream([audio, video]), async () => {}, assert.fail, assert.fail), /Unsupported recording format/);
		assert.equal(audio.readyState, 'ended');
		assert.equal(video.readyState, 'ended');
	} finally { Recorder.prototype.start = original; }
});
