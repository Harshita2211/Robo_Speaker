from flask import Flask, request, jsonify
import pyttsx3

app = Flask(__name__)
engine = pyttsx3.init()

@app.route("/speak", methods=["POST"])
def speak():
    data = request.get_json()
    text = data.get("text", "")
    
    if text.strip() == "":
        return jsonify({"message": "No text provided!"})

    engine.say(text)
    engine.runAndWait()

    return jsonify({"message": "Python TTS finished speaking."})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
