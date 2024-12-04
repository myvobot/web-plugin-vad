"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioNodeVAD = exports.MicVAD = exports.getDefaultRealTimeVADOptions = exports.ort = exports.DEFAULT_MODEL = void 0;
const ortInstance = __importStar(require("onnxruntime-web"));
const default_model_fetcher_1 = require("./default-model-fetcher");
const frame_processor_1 = require("./frame-processor");
const logging_1 = require("./logging");
const messages_1 = require("./messages");
const models_1 = require("./models");
exports.DEFAULT_MODEL = "legacy";
exports.ort = ortInstance;
const workletFile = "vad.worklet.bundle.min.js";
const sileroV5File = "silero_vad_v5.onnx";
const sileroLegacyFile = "silero_vad_legacy.onnx";
const getDefaultRealTimeVADOptions = (model) => {
    const frameProcessorOptions = model === "v5"
        ? frame_processor_1.defaultV5FrameProcessorOptions
        : frame_processor_1.defaultLegacyFrameProcessorOptions;
    return {
        ...frameProcessorOptions,
        onFrameProcessed: (probabilities) => { },
        onVADMisfire: () => {
            logging_1.log.debug("VAD misfire");
        },
        onSpeechStart: () => {
            logging_1.log.debug("Detected speech start");
        },
        onSpeechEnd: () => {
            logging_1.log.debug("Detected speech end");
        },
        baseAssetPath: "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.20/dist/",
        onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/",
        stream: undefined,
        ortConfig: undefined,
        model: exports.DEFAULT_MODEL,
        workletOptions: {},
    };
};
exports.getDefaultRealTimeVADOptions = getDefaultRealTimeVADOptions;
class MicVAD {
    static async new(options = {}) {
        const fullOptions = {
            ...(0, exports.getDefaultRealTimeVADOptions)(options.model ?? exports.DEFAULT_MODEL),
            ...options,
        };
        (0, frame_processor_1.validateOptions)(fullOptions);
        let stream;
        if (fullOptions.stream === undefined)
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    ...fullOptions.additionalAudioConstraints,
                    channelCount: 1,
                    echoCancellation: true,
                    autoGainControl: true,
                    noiseSuppression: true,
                },
            });
        else
            stream = fullOptions.stream;
        const audioContext = new AudioContext();
        const sourceNode = new MediaStreamAudioSourceNode(audioContext, {
            mediaStream: stream,
        });
        const audioNodeVAD = await AudioNodeVAD.new(audioContext, fullOptions);
        audioNodeVAD.receive(sourceNode);
        return new MicVAD(fullOptions, audioContext, stream, audioNodeVAD, sourceNode);
    }
    constructor(options, audioContext, stream, audioNodeVAD, sourceNode, listening = false) {
        this.options = options;
        this.audioContext = audioContext;
        this.stream = stream;
        this.audioNodeVAD = audioNodeVAD;
        this.sourceNode = sourceNode;
        this.listening = listening;
        this.pause = () => {
            this.audioNodeVAD.pause();
            this.listening = false;
        };
        this.start = () => {
            this.audioNodeVAD.start();
            this.listening = true;
        };
        this.destroy = () => {
            if (this.listening) {
                this.pause();
            }
            if (this.options.stream === undefined) {
                this.stream.getTracks().forEach((track) => track.stop());
            }
            this.sourceNode.disconnect();
            this.audioNodeVAD.destroy();
            this.audioContext.close();
        };
    }
}
exports.MicVAD = MicVAD;
class AudioNodeVAD {
    static async new(ctx, options = {}) {
        const fullOptions = {
            ...(0, exports.getDefaultRealTimeVADOptions)(options.model ?? exports.DEFAULT_MODEL),
            ...options,
        };
        (0, frame_processor_1.validateOptions)(fullOptions);
        exports.ort.env.wasm.wasmPaths = fullOptions.onnxWASMBasePath;
        if (fullOptions.ortConfig !== undefined) {
            fullOptions.ortConfig(exports.ort);
        }
        const workletURL = fullOptions.baseAssetPath + workletFile;
        try {
            await ctx.audioWorklet.addModule(workletURL);
        }
        catch (e) {
            console.error(`Encountered an error while loading worklet ${workletURL}`);
            throw e;
        }
        let workletOptions = fullOptions.workletOptions;
        workletOptions.processorOptions = {
            ...(fullOptions.workletOptions.processorOptions ?? {}),
            frameSamples: fullOptions.frameSamples,
        };
        const vadNode = new AudioWorkletNode(ctx, "vad-helper-worklet", workletOptions);
        const modelFile = fullOptions.model === "v5" ? sileroV5File : sileroLegacyFile;
        const modelURL = fullOptions.baseAssetPath + modelFile;
        const modelFactory = fullOptions.model === "v5" ? models_1.SileroV5.new : models_1.SileroLegacy.new;
        let model;
        try {
            model = await modelFactory(exports.ort, () => (0, default_model_fetcher_1.defaultModelFetcher)(modelURL));
        }
        catch (e) {
            console.error(`Encountered an error while loading model file ${modelURL}`);
            throw e;
        }
        const frameProcessor = new frame_processor_1.FrameProcessor(model.process, model.reset_state, {
            frameSamples: fullOptions.frameSamples,
            positiveSpeechThreshold: fullOptions.positiveSpeechThreshold,
            negativeSpeechThreshold: fullOptions.negativeSpeechThreshold,
            redemptionFrames: fullOptions.redemptionFrames,
            preSpeechPadFrames: fullOptions.preSpeechPadFrames,
            minSpeechFrames: fullOptions.minSpeechFrames,
            submitUserSpeechOnPause: fullOptions.submitUserSpeechOnPause,
        });
        const audioNodeVAD = new AudioNodeVAD(ctx, fullOptions, frameProcessor, vadNode);
        vadNode.port.onmessage = async (ev) => {
            switch (ev.data?.message) {
                case messages_1.Message.AudioFrame:
                    let buffer = ev.data.data;
                    if (!(buffer instanceof ArrayBuffer)) {
                        buffer = new ArrayBuffer(ev.data.data.byteLength);
                        new Uint8Array(buffer).set(new Uint8Array(ev.data.data));
                    }
                    const frame = new Float32Array(buffer);
                    await audioNodeVAD.processFrame(frame);
                    break;
                default:
                    break;
            }
        };
        return audioNodeVAD;
    }
    constructor(ctx, options, frameProcessor, entryNode) {
        this.ctx = ctx;
        this.options = options;
        this.frameProcessor = frameProcessor;
        this.entryNode = entryNode;
        this.pause = () => {
            const ev = this.frameProcessor.pause();
            this.handleFrameProcessorEvent(ev);
        };
        this.start = () => {
            this.frameProcessor.resume();
        };
        this.receive = (node) => {
            node.connect(this.entryNode);
        };
        this.processFrame = async (frame) => {
            const ev = await this.frameProcessor.process(frame);
            this.handleFrameProcessorEvent(ev);
        };
        this.handleFrameProcessorEvent = (ev) => {
            if (ev.probs !== undefined) {
                this.options.onFrameProcessed(ev.probs, ev.frame);
            }
            switch (ev.msg) {
                case messages_1.Message.SpeechStart:
                    this.options.onSpeechStart(ev.audio);
                    break;
                case messages_1.Message.VADMisfire:
                    this.options.onVADMisfire();
                    break;
                case messages_1.Message.SpeechEnd:
                    this.options.onSpeechEnd(ev.audio);
                    break;
                default:
                    break;
            }
        };
        this.destroy = () => {
            this.entryNode.port.postMessage({
                message: messages_1.Message.SpeechStop,
            });
            this.entryNode.disconnect();
        };
    }
}
exports.AudioNodeVAD = AudioNodeVAD;
//# sourceMappingURL=real-time-vad.js.map