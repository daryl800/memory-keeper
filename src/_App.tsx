import { useState, useRef, useEffect } from 'react';
import { format } from 'date-fns';

function _App() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [input, setInput] = useState('');
  const recognitionRef = useRef<SpeechRecognition | null>(null);
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
    localStorage.setItem('memories', JSON.stringify(memories));
  }, [memories]);

  const speak = (text: string) => {
    const voices = window.speechSynthesis.getVoices();
    const cantoneseVoice = voices.find(
      (v) => v.lang.toLowerCase().includes('zh') && v.name.includes('HK')
    );

    const utterance = new SpeechSynthesisUtterance(text);
    if (cantoneseVoice) {
      utterance.voice = cantoneseVoice;
      utterance.lang = cantoneseVoice.lang;
    } else {
      utterance.lang = 'zh-HK';
    }
    window.speechSynthesis.speak(utterance);
  };

  const addMemory = () => {
    if (input.trim() !== '') {
      const newMemory = {
        text: input.trim(),
        category,
        timestamp: new Date().toISOString(),
      };
      setMemories([newMemory, ...memories]);
      setInput('');
      speak(newMemory.text);
    }
  };

  const startVoiceInput = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'yue-HK';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      alert('Speech recognition error: ' + event.error);
    };

    recognition.start();
    recognitionRef.current = recognition;
  };

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

  // const uploadToGoogleSTT = async (audio: Blob) => {
  //   const formData = new FormData();
  //   formData.append('file', audio, 'audio.mp3');

  //   try {
  //     const res = await fetch('https://companion-backend-production-0935.up.railway.app/transcribe', {
  //       method: 'POST',
  //       body: formData,
  //     });

  //     const data = await res.json();
  //     console.log('Google transcription:', data.text);

  //     if (data.text && data.text.trim().length > 2) {
  //       setInput(data.text);
  //     } else {
  //       const fallbackText = await uploadToDeepgramSTT(audio);
  //       if (fallbackText) {
  //         setInput(fallbackText);
  //       } else {
  //         alert('Transcription failed from both Google and Deepgram.');
  //       }
  //     }

  //   } catch (err) {
  //     console.error('Google STT failed:', err);
  //     const fallbackText = await uploadToDeepgramSTT(audio);
  //     if (fallbackText) {
  //       setInput(fallbackText);
  //     } else {
  //       alert('Transcription failed from both Google and Deepgram.');
  //     }
  //   }
  // };

  const uploadToGoogleSTT = async (audio: Blob) => {
    // Skip Google, go straight to Deepgram for testing
    console.log('Skipping Google STT, testing Deepgram fallback...');

    const fallbackText = await uploadToDeepgramSTT(audio);
    if (fallbackText) {
      setInput(fallbackText);
    }
    // else {
    //   alert('Transcription failed from Deepgram.');
    // }
  };


  const uploadToDeepgramSTT = async (audio: Blob): Promise<string> => {
    const formData = new FormData();
    formData.append('file', audio, 'audio.mp3');

    try {
      const res = await fetch('https://deepgram-backend-production-5857.up.railway.app/transcribe-deepgram', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      console.log('🔍 Deepgram full response:', data);

      const text = data.text || '';  // Safely fallback
      return text;
    } catch (err) {
      console.error('❌ Deepgram fallback failed:', err);
      return '';
    }
  };


  const startRecording = async () => {
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
    const maxSilenceDuration = 1000;

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

    mediaRecorder.onstop = () => {
      const audio = new Blob(audioChunks, { type: 'audio/webm' });
      setAudioBlob(audio);
      uploadToGoogleSTT(audio);

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

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-xl mx-auto bg-white shadow-md rounded-2xl p-6">
        <h1 className="text-2xl font-bold text-center text-blue-600 mb-4">Memory Keeper</h1>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Enter a memory..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
          />

          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-2 py-1 border rounded-lg bg-white text-gray-700"
          >
            <option>General</option>
            <option>Family</option>
            <option>Health</option>
            <option>Shopping</option>
            <option>Reminder</option>
          </select>

          <button
            onClick={addMemory}
            className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600"
          >
            Add
          </button>
          <button
            onClick={recording ? stopRecording : startRecording}
            className={`ml-2 px-3 py-1 rounded-lg ${recording ? 'bg-red-500 text-white' : 'bg-green-500 text-white'}`}
          >
            {recording ? 'Stop 🎙️' : 'Speak 🎤'}
          </button>
        </div>

        <div className="mb-4">
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
        </div>

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

export default _App;
