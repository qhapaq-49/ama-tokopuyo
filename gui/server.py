#!/usr/bin/env python3
import json
import subprocess
import sys
from pathlib import Path
from flask import Flask, send_from_directory, request, jsonify

BASE_DIR = Path(__file__).parent.parent  # /home/shiku/AI/ama
BINARY = BASE_DIR / "bin" / "tokopuyo" / "tokopuyo.exe"
STATIC_DIR = Path(__file__).parent / "static"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path='')


@app.route("/")
def index():
    return send_from_directory(str(STATIC_DIR), "index.html")


@app.route("/api/evaluate", methods=["POST"])
def evaluate():
    data = request.get_json()
    if not data:
        return jsonify({"error": "invalid JSON"}), 400

    try:
        result = subprocess.run(
            [str(BINARY)],
            input=json.dumps(data) + "\n",
            capture_output=True,
            text=True,
            cwd=str(BASE_DIR),
            timeout=10,
        )
        stdout = result.stdout.strip()
        if not stdout:
            return jsonify({"error": f"binary produced no output: {result.stderr}"}), 500

        resp = json.loads(stdout)
        return jsonify(resp)

    except subprocess.TimeoutExpired:
        return jsonify({"error": "timeout"}), 504
    except json.JSONDecodeError as e:
        return jsonify({"error": f"bad JSON from binary: {e}"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    print(f"http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
