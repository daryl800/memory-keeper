import { useState, useRef, useEffect } from 'react';

function App() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [input, setInput] = useState('');
  // const recognitionRef = useRef<SpeechRecognition | null>(null);
  const [category, setCategory] = useState('General');

  type Memory = {
    text: string;
    category: string;
    timestamp: string;
  };

  const [memories, setMemories] = useState<Memory[]>(() => {
    const stored = localStorage.getItem('memories');
    return stored ? JSON.parse(stored) : [];
  });

  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  useEffect(() => {
    loadVoices().then((voices) => {
      console.log('Available voices:', voices.map(v => ({ name: v.name, lang: v.lang })));
    });
  }, []);


  useEffect(() => {
    speak('欢迎使用 Memory Keeper! 请按住按钮开始录音，松开后将自动转录您的语音。');
    wsTest();
  }, [])

  useEffect(() => {
    localStorage.setItem('memories', JSON.stringify(memories));
  }, [memories]);


  const wsTest = async () => {

    const ws = new WebSocket("ws://43.156.32.74:8001/ws");

    ws.onopen = () => {
      console.log("WebSocket connected");
      ws.send("Hello, this is a test");
    };

    ws.onmessage = (msg) => {
      console.log("Server replied:", msg.data);
    }
  }

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


  const playBase64Audio = (base64Audio: string) => {
    if (!base64Audio || !/^[A-Za-z0-9+/=]+$/.test(base64Audio)) {
      console.error("Invalid base64 string:", base64Audio);
      return;
    }
    const byteString = atob(base64Audio);
    const byteArray = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      byteArray[i] = byteString.charCodeAt(i);
    }

    const audioBlob = new Blob([byteArray], { type: "audio/wav" });
    const audioUrl = URL.createObjectURL(audioBlob);

    const audio = new Audio(audioUrl);
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

  // const addMemory = () => {
  //   if (input.trim() !== '') {
  //     const newMemory = {
  //       text: input.trim(),
  //       category,
  //       timestamp: new Date().toISOString(),
  //     };
  //     setMemories([newMemory, ...memories]);
  //     setInput('');
  //   }
  // };

  const filteredMemories =
    selectedCategory === 'All'
      ? memories
      : memories.filter((m) => m.category === selectedCategory);

  const groupedMemories: { [date: string]: typeof memories } = {};
  filteredMemories.forEach((memory) => {
    const date = new Date(memory.timestamp).toISOString().split('T')[0];
    if (!groupedMemories[date]) {
      groupedMemories[date] = [];
    }
    groupedMemories[date].push(memory);
  });

  // Updated type definition
  type TranscribedResponseObject = {
    category: string;
    eventCreatedAt: string;
    isQuestion: boolean;
    isReminder: boolean;
    location: string[];
    mainEvent: string;
    reminderDatetime: string;
    tags: string[];
    transcription: string;
    ttsOutput: string;
  };

  type ResponseObject = {
    success: boolean;
    TranscriptionResponse: TranscribedResponseObject;
  };


  const uploadToTCSTT = async (audio: Blob): Promise<ResponseObject> => {
    const formData = new FormData();
    formData.append('audio', audio, 'audio.webm');  // More explicit filename

    try {
      const res = await fetch('http://43.156.32.74:8001/transcribe/', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      const data: ResponseObject = await res.json();

      return data;
    } catch (err) {
      console.error('❌ TC STT failed:', err);
      return {
        success: false,
        TranscriptionResponse: {
          eventCreatedAt: new Date().toISOString(),
          reminderDatetime: '',
          category: 'General',
          mainEvent: '',
          transcription: '',
          isReminder: false,
          ttsOutput: '',
          isQuestion: false,
          location: [],
          tags: []
        } as TranscribedResponseObject // Ensure this matches the expected type
      };
    }
  };


  const startRecording = async () => {
    if (recording) return; // prevent re-triggering

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    const audioChunks: Blob[] = [];

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

    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
    };


    const speakDateTime = (isoDatetimeStr: string) => {
      const date = new Date(isoDatetimeStr);

      // Example: "6月6号 上午8点30分"
      const spoken = date.toLocaleString("zh-HK", {
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        hour12: true,
      });

      return spoken;
    };
    const handleTranscription = async (audio: Blob) => {
      try {
        console.log('🎤 Starting transcription for audio:', audio);
        const response = await uploadToTCSTT(audio);
        if (response.success && response.TranscriptionResponse) {
          console.log('✅ Transcription successful:', response.TranscriptionResponse);
          console.log('📝 transcribed text:', response.TranscriptionResponse.transcription);
          playBase64Audio(response.TranscriptionResponse.ttsOutput);
          const totalSpeechTime = Math.round((audio.size / 1000) * 0.1);
          console.log('⏱️ Total speech time:', totalSpeechTime, 'seconds');

          // // speak("你头先讲左" + totalSpeechTime + "秒钟既说话！");  // Speak the category
          // speak("你头先话" + response.text);  // Speak the transcribed text
          // // speak("而呢个系一个" + response.category + "类型");  // Speak the category
          // if (response.isReminder) {
          //   const when = response.reminderDatetime ? speakDateTime(response.reminderDatetime) : '';
          //   speak("记住：请你系 " + when + " " + response.mainEvent);
          // }
          // setInput(response.mainEvent);  // ✅ reliably updates input now
          // const newMemory: Memory = {
          //   text: response.mainEvent,
          //   category: response.category || 'General',
          //   timestamp: new Date().toISOString()
          // };
          // setMemories(prev => [newMemory, ...prev]);
        } else {
          speak("唔好意思，刚才听唔清楚，麻烦你再讲一次吖！");
        }
      } catch (err) {
        console.error('❌ Transcription failed:', err);
      }
    };


    mediaRecorder.onstop = () => {
      const audio = new Blob(audioChunks, { type: 'audio/webm' });
      setAudioBlob(audio);

      handleTranscription(audio);  // 👈 call separate async function

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
          {/* <input
            type="text"
            placeholder="Enter a memory..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
          /> */}

          {/* <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-2 py-1 border rounded-lg bg-white text-gray-700"
          >
            <option>General</option>
            <option>Family</option>
            <option>Health</option>
            <option>Shopping</option>
            <option>Reminder</option>
          </select> */}

          {/* <button
            onClick={addMemory}
            className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600"
          >
            Add
          </button> */}
          <button
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onTouchStart={startRecording}
            onTouchEnd={stopRecording}
            className={`ml-2 px-3 py-1 rounded-lg ${recording ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}`}
          >
            {recording ? `Recording ... ${seconds} sec` : 'Hold to Speak 🎤'}
          </button>

        </div>

        {/* <div className="mb-4">
          <label className="mr-2 font-semibold">Filter by category:</label>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 border rounded-lg"
          >
            <option value="All">All</option>
            {[...new Set(memories.map((m) => m.category))].map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div> */}

        <div className="space-y-6">
          {Object.entries(groupedMemories)
            .sort((a, b) => (a[0] < b[0] ? 1 : -1))
            .map(([date, memoriesForDate]) => {
              const categoryGroups: { [cat: string]: typeof memories } = {};
              memoriesForDate.forEach((m) => {
                const cat = m.category || 'Uncategorized';
                if (!categoryGroups[cat]) categoryGroups[cat] = [];
                categoryGroups[cat].push(m);
              });

              return (
                <div key={date}>
                  <h2 className="text-xl font-bold text-blue-700 mb-2">📅 {date}</h2>
                  {Object.entries(categoryGroups).map(([category, mems]) => (
                    <div key={category} className="mb-4">
                      <div className="text-sm text-blue-800 font-semibold mb-1">
                        🏷️ {category}
                      </div>
                      <ul className="space-y-2">
                        {mems.map((memory, index) => (
                          <li
                            key={index}
                            className="bg-white p-3 rounded-lg shadow border-l-4 border-blue-400"
                          >
                            <div className="text-gray-800">{memory.text}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

export default App;
