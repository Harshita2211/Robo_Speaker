# Robo Speaker

Robo Speaker is a simple text-to-speech web app. Type any text, click Speak, and it is read aloud instantly. It runs entirely in the browser, so there is nothing to install and no backend to host.

Live demo: https://harshita2211.github.io/Robo_Speaker/

## Features

- Converts typed text to spoken audio with one click
- Runs in the browser using the built-in speech engine, with no server required
- Lightweight: plain HTML, CSS and JavaScript
- Optional Python (Flask + pyttsx3) server for local, offline speech

## Tech Stack

- HTML, CSS, JavaScript (web app)
- Python 3, Flask, pyttsx3 (optional local server)

## Project Structure

```
Robo_Speaker/
  index.html    Page layout and the text box
  style.css     Styling
  script.js     Speech logic for the web app
  server.py     Optional Flask server that speaks using pyttsx3
  README.md
```

## Run Locally

Clone the repository:

```
git clone https://github.com/Harshita2211/Robo_Speaker.git
cd Robo_Speaker
```

Then either open `index.html` directly in your browser, or serve it locally:

```
python -m http.server 8000
```

and visit `http://localhost:8000`.

## Optional: Python Server

`server.py` exposes a `/speak` endpoint that speaks text through the speakers of the machine it runs on. It is intended for local use only.

```
pip install flask pyttsx3
python server.py
```

The server starts on port 5000. Send text to it with a POST request:

```
curl -X POST http://localhost:5000/speak \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello from Robo Speaker"}'
```

Note: because pyttsx3 plays audio on the host machine, this server cannot deliver audio to visitors when deployed to the cloud. The web app does not depend on it.

## Deployment

The app is a static site, so it can be hosted for free:

1. Push the repository to GitHub.
2. Go to Settings, then Pages.
3. Set Source to "Deploy from a branch", choose `main` and `/ (root)`, and save.
4. The site will be available at `https://<your-username>.github.io/Robo_Speaker/`.

Netlify and Vercel also work: import the repository, leave the build command empty, and deploy.

## Browser Notes

Available voices depend on the browser and operating system, so the voice may sound different on Chrome, Edge, Safari or mobile devices.

## Author

Harshita ([@Harshita2211](https://github.com/Harshita2211))
