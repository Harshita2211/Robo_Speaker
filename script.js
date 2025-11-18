// Browser text-to-speech using Web Speech API
function speakNow() {
    let text = document.getElementById("text").value;

    if (!text.trim()) {
        alert("Please enter some text!");
        return;
    }

    let speech = new SpeechSynthesisUtterance(text);
    speech.lang = "en-US";
    speech.rate = 1;
    speech.pitch = 1;

    window.speechSynthesis.speak(speech);
}

// Optional: call Python backend for TTS
function sendToPython() {
    let text = document.getElementById("text").value;

    if (!text.trim()) {
        alert("Please enter some text!");
        return;
    }

    fetch("http://localhost:5000/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text })
    })
    .then(res => res.json())
    .then(data => alert(data.message))
    .catch(err => alert("Python server not running"));
}
