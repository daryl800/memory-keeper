// utils/transcribeAudio.ts
export const transcribeAudio = async (blob: Blob) => {
    const formData = new FormData();
    formData.append("file", blob, "voice.mp3");

    const response = await fetch("https://companion-backend-production-79ec.up.railway.app/transcribe", {
        method: "POST",
        body: formData,
    });

    const data = await response.json();
    return data.text;
};
