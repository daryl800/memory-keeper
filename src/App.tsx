import { useState, useRef, useEffect } from 'react';

function App() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);

  const wsRef = useRef<WebSocket | null>(null)
  const welcomeMsgFlag = useRef(false)
  const [isWsReady, setIsWsReady] = useState(false);

  const getCurrentTimestamp = () => {
    const now = new Date();
    return now.toLocaleTimeString('en-US', { hour12: false }); // e.g. "14:05:09"
  };

  useEffect(() => {
    if (welcomeMsgFlag.current === false) {
      loadVoices().then((voices) => {
        console.log('Available voices:', voices.map(v => ({ name: v.name, lang: v.lang })));
      });
      // speak('欢迎使用 Memory Keeper! 请按住按钮开始录音，松开后将自动转录您的语音。');
      welcomeMsgFlag.current = true;
    }
    if (wsRef.current) return; // already connected

    // const ws = new WebSocket("wss://43.156.32.74:8001/ws");
    const ws = new WebSocket('wss://memorykeeper.duckdns.org/ws');

    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected");
      setIsWsReady(true);
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      console.log(`[${getCurrentTimestamp()}] Server replied:`, data);

      if (data.type === "text") {
        // handle transcription display
      } else if (data.type === "audio") {
        playBase64Audio(data.payload);  // ✅ play the TTS WAV
      }
    };

    ws.onclose = () => {
      console.log("WebSocket closed");
      wsRef.current = null;
    };

    return () => {
      // Only close if it's open or connecting
      if (
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)
      ) {
        return; // already connected or connecting
      }
      wsRef.current = null;
    };
  }, []);

  const loadVoices = (): Promise<SpeechSynthesisVoice[]> => {
    return new Promise((resolve) => {
      let resolved = false;

      const tryResolve = (voices: SpeechSynthesisVoice[]) => {
        if (!resolved) {
          resolved = true;
          resolve(voices);
        }
      };

      let voices = window.speechSynthesis.getVoices();
      if (voices.length) {
        tryResolve(voices);
      } else {
        const tryLoad = () => {
          voices = window.speechSynthesis.getVoices();
          if (voices.length) {
            tryResolve(voices);
          } else {
            setTimeout(tryLoad, 200);
          }
        };

        tryLoad();

        window.speechSynthesis.onvoiceschanged = () => {
          voices = window.speechSynthesis.getVoices();
          tryResolve(voices);
        };
      }
    });
  };


  // Maintain a queue of audio playback
  let audioQueue: string[] = [];
  let isPlaying = false;

  const playBase64Audio = (base64Audio: string) => {
    audioQueue.push(base64Audio);
    if (!isPlaying) {
      playNextAudioInQueue();
    }
  };

  const playNextAudioInQueue = () => {
    if (audioQueue.length === 0) {
      isPlaying = false;
      return;
    }

    isPlaying = true;
    const base64Audio = audioQueue.shift();
    const byteString = atob(base64Audio!);
    const byteArray = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      byteArray[i] = byteString.charCodeAt(i);
    }

    const audioBlob = new Blob([byteArray], { type: "audio/wav" });
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    audio.onended = () => {
      playNextAudioInQueue(); // Play the next item after current finishes
    };

    audio.play();
  };

  const speak = async (text: string) => {
    window.speechSynthesis.cancel(); // Stop previous utterances

    const voices = await loadVoices();

    const cantoneseVoice = voices.find((v) => {
      const lang = v.lang.toLowerCase();
      return v.name.includes('Google 粤語') || lang.includes('yue') || lang.includes('zh-hk');
    });

    const utterance = new SpeechSynthesisUtterance(text);
    if (cantoneseVoice) {
      utterance.voice = cantoneseVoice;
      utterance.lang = cantoneseVoice.lang;
    } else {
      console.warn('⚠️ Cantonese voice not found, falling back to default.');
      utterance.lang = 'zh-HK'; // encourage matching zh-HK voices
    }

    window.speechSynthesis.speak(utterance);
  };


  const sendAudioViaWS = async (audio: Blob) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64Audio = (reader.result as string).split(',')[1]; // remove data: prefix
      if (!isWsReady || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket not ready yet.");
        speak("系统仲未准备好，请稍等一阵再讲一次。");
        return;
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        console.log(`[${getCurrentTimestamp()}] Sending audio to server...`);
        wsRef.current?.send(JSON.stringify({
          type: "audio",
          payload: base64Audio,
        }));
      } else {
        console.warn("WebSocket is not open yet.");
      }
    };
    reader.readAsDataURL(audio);
  };


  const startRecording = async () => {
    if (recording) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    const chunks: Blob[] = [];

    // Audio silence detection
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.fftSize);
    let silenceStart = performance.now();
    const silenceThreshold = 0.01;
    const maxSilenceDuration = 2000;

    const checkSilence = () => {
      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const sample = (dataArray[i] - 128) / 128;
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / dataArray.length);

      if (rms < silenceThreshold) {
        if (performance.now() - silenceStart > maxSilenceDuration) {
          stopRecording();
          return;
        }
      } else {
        silenceStart = performance.now();
      }

      requestAnimationFrame(checkSilence);
    };
    checkSilence();

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const fullBlob = new Blob(chunks, { type: 'audio/webm' });

      sendAudioViaWS(fullBlob);

      stream.getTracks().forEach((track) => track.stop());
      audioContext.close();
    };

    mediaRecorder.start();
    mediaRecorderRef.current = mediaRecorder;
    setRecording(true);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };


  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    let interval: number | undefined;
    if (recording) {
      interval = setInterval(() => {
        setSeconds(prev => prev + 1);
      }, 1000);
    } else {
      setSeconds(0); // Reset counter when not recording
    }

    return () => clearInterval(interval); // Cleanup on unmount or recording stop
  }, [recording]);

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-xl mx-auto bg-white shadow-md rounded-2xl p-6">
        <h1 className="text-2xl font-bold text-center text-blue-600 mb-4">Memory Keeper</h1>
        <div className="flex gap-2 mb-4">
          <button
            onPointerDown={startRecording}
            onPointerUp={stopRecording}
            onPointerLeave={stopRecording} // handle drag-away cancellation
            className={`ml-2 px-3 py-1 rounded-lg ${recording ? 'bg-red-500 text-white' : 'bg-green-500 text-white'
              }`}
          >
            {recording ? `Recording ... ${seconds} sec` : 'Hold to Speak 🎤'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
