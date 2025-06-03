declare module 'mic-recorder-to-mp3' {
    interface Options {
        bitRate?: number;
    }
    export default class MicRecorder {
        constructor(options?: Options);
        start(): Promise<void>;
        stop(): this;
        getMp3(): Promise<[ArrayBuffer, Blob]>;
    }
}
